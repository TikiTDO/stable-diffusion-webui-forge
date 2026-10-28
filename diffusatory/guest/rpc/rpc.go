// Package rpc is the protocol the page speaks to the guest over one WebSocket per tab.
//
// The client sends calls; the guest answers each with one reply and pushes events that
// every connected tab sees. A job (one generate call) always ends with exactly one
// "ended" event saying how: done, cancelled, skipped or failed with a named reason.
// Jobs run one at a time because one GPU serves them all.
package rpc

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
)

// Call is one client request. ID is chosen by the client and echoed in the reply.
type Call struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

// Message is everything the guest sends: a reply to one call, or an event.
type Message struct {
	Type   string      `json:"type"` // "reply" or "event"
	ID     string      `json:"id,omitempty"`
	Result any         `json:"result,omitempty"`
	Error  *Error      `json:"error,omitempty"`
	Event  string      `json:"event,omitempty"`
	Job    string      `json:"job,omitempty"`
	Data   interface{} `json:"data,omitempty"`
}

// Error is a reply failure. Code is stable for the client to branch on; Fields lists
// each refused request field when Code is "refused".
type Error struct {
	Code    string           `json:"code"`
	Message string           `json:"message"`
	Fields  []api.FieldError `json:"fields,omitempty"`
}

// Progress is one sampler step, reported between steps.
type Progress struct {
	Phase string `json:"phase"`
	Step  int    `json:"step"`
	Steps int    `json:"steps"`
}

// Result is a finished image and the receipt that lets it be reproduced.
type Result struct {
	PNG     []byte         `json:"-"`
	Receipt map[string]any `json:"receipt"`
}

// ErrOutOfMemory is what an engine returns when the GPU memory it needs is not there.
// The memory manager can't always promise memory, so this is an expected outcome:
// the job fails with reason "out_of_memory" and the guest carries on.
var ErrOutOfMemory = errors.New("out of GPU memory")

// Engine is one model runtime. Generate must check ctx between sampler steps and call
// step after each one; it must not modify req.
type Engine interface {
	Capabilities() api.Capabilities
	Generate(ctx context.Context, req *api.GenerateRequest, step func(Progress)) (*Result, error)
}

// Ending outcomes, as sent in the "ended" event and recorded in receipts.
const (
	EndedDone      = "done"
	EndedCancelled = "cancelled"
	EndedSkipped   = "skipped"
	EndedFailed    = "failed"
)

var (
	errCancelled = errors.New("cancelled by the client")
	errSkipped   = errors.New("skipped by the client")
)

// Sink receives every message the hub broadcasts. A connection is a sink.
type Sink interface {
	Send(Message)
}

// Hub owns the job queue and the set of connected tabs.
type Hub struct {
	engine Engine

	mu      sync.Mutex
	sinks   map[Sink]struct{}
	queue   []*job
	running *job
	nextJob int
	wake    chan struct{}
}

type job struct {
	id     string
	req    *api.GenerateRequest
	ctx    context.Context
	cancel context.CancelCauseFunc
}

// NewHub starts the job runner. Cancel ctx to stop it.
func NewHub(ctx context.Context, engine Engine) *Hub {
	h := &Hub{engine: engine, sinks: map[Sink]struct{}{}, wake: make(chan struct{}, 1)}
	go h.run(ctx)
	return h
}

// Attach adds a tab. Detach removes it; its jobs keep running, because another tab or
// hand may be watching them.
func (h *Hub) Attach(s Sink) {
	h.mu.Lock()
	h.sinks[s] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) Detach(s Sink) {
	h.mu.Lock()
	delete(h.sinks, s)
	h.mu.Unlock()
}

func (h *Hub) broadcast(m Message) {
	h.mu.Lock()
	sinks := make([]Sink, 0, len(h.sinks))
	for s := range h.sinks {
		sinks = append(sinks, s)
	}
	h.mu.Unlock()
	for _, s := range sinks {
		s.Send(m)
	}
}

func (h *Hub) event(name, jobID string, data any) {
	h.broadcast(Message{Type: "event", Event: name, Job: jobID, Data: data})
}

// Handle answers one call. The reply goes only to the caller; events go to everyone.
func (h *Hub) Handle(raw []byte) Message {
	var c Call
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil || c.ID == "" || c.Method == "" {
		return Message{Type: "reply", ID: c.ID, Error: &Error{Code: "bad_call", Message: "a call needs an id and a method"}}
	}
	reply := func(result any, err *Error) Message {
		return Message{Type: "reply", ID: c.ID, Result: result, Error: err}
	}
	switch c.Method {
	case "hello":
		return reply(map[string]any{"capabilities": h.engine.Capabilities()}, nil)
	case "generate":
		req, err := api.Decode(bytes.NewReader(c.Params))
		if err != nil {
			return reply(nil, &Error{Code: "bad_request", Message: err.Error()})
		}
		if err := api.Validate(req, h.engine.Capabilities()); err != nil {
			var r *api.RefusalError
			if errors.As(err, &r) {
				return reply(nil, &Error{Code: "refused", Message: err.Error(), Fields: r.Fields})
			}
			return reply(nil, &Error{Code: "refused", Message: err.Error()})
		}
		return reply(map[string]string{"job": h.enqueue(req)}, nil)
	case "cancel", "skip":
		var p struct {
			Job string `json:"job"`
		}
		if err := json.Unmarshal(c.Params, &p); err != nil || p.Job == "" {
			return reply(nil, &Error{Code: "bad_request", Message: c.Method + " needs a job id"})
		}
		cause := errCancelled
		if c.Method == "skip" {
			cause = errSkipped
		}
		if !h.stop(p.Job, cause) {
			return reply(nil, &Error{Code: "no_such_job", Message: "job " + p.Job + " is not queued or running"})
		}
		return reply(map[string]string{"job": p.Job}, nil)
	default:
		return reply(nil, &Error{Code: "unknown_method", Message: fmt.Sprintf("unknown method %q", c.Method)})
	}
}

func (h *Hub) enqueue(req *api.GenerateRequest) string {
	h.mu.Lock()
	h.nextJob++
	id := "j" + strconv.Itoa(h.nextJob)
	ctx, cancel := context.WithCancelCause(context.Background())
	h.queue = append(h.queue, &job{id: id, req: req, ctx: ctx, cancel: cancel})
	queued := len(h.queue)
	h.mu.Unlock()
	h.event("status", "", map[string]int{"queued": queued})
	select {
	case h.wake <- struct{}{}:
	default:
	}
	return id
}

// stop cancels a queued or running job with cause. A queued job ends at once; a
// running one ends when the engine next checks its context.
func (h *Hub) stop(id string, cause error) bool {
	h.mu.Lock()
	if h.running != nil && h.running.id == id {
		h.running.cancel(cause)
		h.mu.Unlock()
		return true
	}
	for i, j := range h.queue {
		if j.id == id {
			h.queue = append(h.queue[:i], h.queue[i+1:]...)
			h.mu.Unlock()
			j.cancel(cause)
			h.event("ended", id, map[string]string{"outcome": outcomeOf(cause)})
			return true
		}
	}
	h.mu.Unlock()
	return false
}

func (h *Hub) run(ctx context.Context) {
	for {
		h.mu.Lock()
		if len(h.queue) == 0 {
			h.running = nil
			h.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-h.wake:
				continue
			}
		}
		j := h.queue[0]
		h.queue = h.queue[1:]
		h.running = j
		h.mu.Unlock()
		h.runJob(j)
	}
}

func (h *Hub) runJob(j *job) {
	steps := j.req.Steps
	h.event("progress", j.id, Progress{Phase: "starting", Step: 0, Steps: steps})
	res, err := h.engine.Generate(j.ctx, j.req, func(p Progress) {
		h.event("progress", j.id, p)
	})
	switch {
	case err == nil:
		h.event("result", j.id, map[string]any{
			"png":     base64.StdEncoding.EncodeToString(res.PNG),
			"receipt": res.Receipt,
		})
		h.event("ended", j.id, map[string]string{"outcome": EndedDone})
	case errors.Is(context.Cause(j.ctx), errCancelled), errors.Is(context.Cause(j.ctx), errSkipped):
		h.event("ended", j.id, map[string]string{"outcome": outcomeOf(context.Cause(j.ctx))})
	case errors.Is(err, ErrOutOfMemory):
		h.event("ended", j.id, map[string]string{"outcome": EndedFailed, "reason": "out_of_memory"})
	default:
		h.event("ended", j.id, map[string]string{"outcome": EndedFailed, "reason": "engine_error", "detail": err.Error()})
	}
	j.cancel(nil)
}

func outcomeOf(cause error) string {
	if errors.Is(cause, errSkipped) {
		return EndedSkipped
	}
	return EndedCancelled
}
