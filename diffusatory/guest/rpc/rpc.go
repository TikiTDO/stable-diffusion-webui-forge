// Package rpc is the protocol the page speaks to the guest over one WebSocket per tab.
//
// The client sends calls; the guest answers each with one reply and pushes events that
// every connected tab sees. Events are a live feed, not a record: a tab that reconnects
// asks for the truth with "jobs", "studio" and "document.get" instead of trusting events
// it may have missed.
//
// A job (one generate call) is bound to exactly what was submitted: a cut, a saved
// document revision, an explicit operation and the layers it reads. It always ends with
// exactly one "ended" event: done, cancelled, skipped or failed with a named reason.
// Its result becomes a take in the cut it came from and never changes what that cut has
// chosen. Jobs run one at a time because one GPU serves them all.
package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"sync"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/store"
)

// Call is one client request. ID is chosen by the client and echoed in the reply.
// Request is required on calls that change something: a retry with the same Request
// gets the original reply instead of doing the work again, so a reply lost in a
// disconnect can't start a second generation or save twice.
type Call struct {
	ID      string          `json:"id"`
	Method  string          `json:"method"`
	Request string          `json:"request,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Message is everything the guest sends: a reply to one call, or an event.
type Message struct {
	Type   string `json:"type"` // "reply" or "event"
	ID     string `json:"id,omitempty"`
	Result any    `json:"result,omitempty"`
	Error  *Error `json:"error,omitempty"`
	Event  string `json:"event,omitempty"`
	Job    string `json:"job,omitempty"`
	Data   any    `json:"data,omitempty"`
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

// Result is a finished image and the engine's receipt for it.
type Result struct {
	PNG     []byte
	Receipt map[string]any
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

// Ending outcomes, as sent in the "ended" event and kept in the job list.
const (
	EndedDone      = "done"
	EndedCancelled = "cancelled"
	EndedSkipped   = "skipped"
	EndedFailed    = "failed"
)

// Operations a generate call can ask for. The canvas never infers one from which
// layers happen to exist: a mask left on the canvas doesn't turn an edit into an inpaint.
const (
	OpText    = "text"    // no source image
	OpEdit    = "edit"    // the flattened reference layers are the source; no mask
	OpInpaint = "inpaint" // the source plus a mask over the whole image
	OpInfill  = "infill"  // the source plus a mask from a selected box, into a new layer
)

var (
	errCancelled = errors.New("cancelled by the client")
	errSkipped   = errors.New("skipped by the client")
)

// keepEnded and keepReplies bound the memory the hub uses for reconnects and retries.
const (
	keepEnded   = 200
	keepReplies = 4096
)

// Sink receives every message the hub broadcasts. A connection is a sink.
type Sink interface {
	Send(Message)
}

// Submission is what generate binds a job to. Revision pins the document content, so
// the layers a job reads can't change after it is submitted.
type Submission struct {
	Cut       string   `json:"cut"`
	Document  string   `json:"document"`
	Revision  int      `json:"revision"`
	Operation string   `json:"operation"`
	Reference []string `json:"reference,omitempty"`
	Mask      string   `json:"mask,omitempty"`
	Target    string   `json:"target"`
}

// generateParams is the generate call: the submission plus the typed request.
type generateParams struct {
	Submission
	Request json.RawMessage `json:"request"`
}

// JobInfo is one job as "jobs" reports it.
type JobInfo struct {
	ID         string     `json:"id"`
	State      string     `json:"state"` // "queued", "running" or "ended"
	Submission Submission `json:"submission"`
	Outcome    string     `json:"outcome,omitempty"`
	Reason     string     `json:"reason,omitempty"`
	Take       string     `json:"take,omitempty"`
}

// Hub owns the job queue, the set of connected tabs and the studio store.
type Hub struct {
	engine Engine
	store  *store.Store

	mu       sync.Mutex
	sinks    map[Sink]struct{}
	queue    []*job
	running  *job
	ended    []JobInfo
	nextJob  int
	replies  map[string]Message
	replyLog []string
	inflight map[string]chan struct{}
	wake     chan struct{}
}

type job struct {
	id     string
	sub    Submission
	req    *api.GenerateRequest
	ctx    context.Context
	cancel context.CancelCauseFunc
}

// NewHub starts the job runner. Cancel ctx to stop it.
func NewHub(ctx context.Context, engine Engine, st *store.Store) *Hub {
	h := &Hub{engine: engine, store: st, sinks: map[Sink]struct{}{}, replies: map[string]Message{}, inflight: map[string]chan struct{}{}, wake: make(chan struct{}, 1)}
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

// mutating lists the calls that change state and therefore need a request id.
var mutating = map[string]bool{"generate": true, "cancel": true, "skip": true, "document.put": true, "choose": true, "cut.create": true}

// Handle answers one call. The reply goes only to the caller; events go to everyone.
func (h *Hub) Handle(raw []byte) Message {
	var c Call
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil || c.ID == "" || c.Method == "" {
		return Message{Type: "reply", ID: c.ID, Error: &Error{Code: "bad_call", Message: "a call needs an id and a method"}}
	}
	if !mutating[c.Method] {
		return h.dispatch(c)
	}
	if c.Request == "" {
		return failure(c.ID, "bad_call", c.Method+" needs a request id, so a retry can't do the work twice")
	}
	// The same request may arrive twice at once, from a tab and its reconnected self.
	// The first one does the work; the other waits for it and gets the same reply.
	for {
		h.mu.Lock()
		if prev, seen := h.replies[c.Request]; seen {
			h.mu.Unlock()
			prev.ID = c.ID
			return prev
		}
		wait, busy := h.inflight[c.Request]
		if !busy {
			h.inflight[c.Request] = make(chan struct{})
			h.mu.Unlock()
			break
		}
		h.mu.Unlock()
		<-wait
	}
	m := h.dispatch(c)
	h.remember(c.Request, m)
	return m
}

func (h *Hub) remember(request string, m Message) {
	h.mu.Lock()
	defer h.mu.Unlock()
	close(h.inflight[request])
	delete(h.inflight, request)
	h.replies[request] = m
	h.replyLog = append(h.replyLog, request)
	if len(h.replyLog) > keepReplies {
		delete(h.replies, h.replyLog[0])
		h.replyLog = h.replyLog[1:]
	}
}

func success(id string, result any) Message { return Message{Type: "reply", ID: id, Result: result} }

func failure(id, code, msg string) Message {
	return Message{Type: "reply", ID: id, Error: &Error{Code: code, Message: msg}}
}

func storeFailure(id string, err error) Message {
	switch {
	case errors.Is(err, store.ErrStale):
		return failure(id, "stale", err.Error())
	case errors.Is(err, store.ErrNotFound):
		return failure(id, "not_found", err.Error())
	default:
		return failure(id, "bad_request", err.Error())
	}
}

func (h *Hub) dispatch(c Call) Message {
	switch c.Method {
	case "hello":
		return success(c.ID, map[string]any{"capabilities": h.engine.Capabilities()})
	case "studio":
		st, err := h.store.Studio()
		if err != nil {
			return storeFailure(c.ID, err)
		}
		return success(c.ID, st)
	case "jobs":
		return success(c.ID, h.jobs())
	case "document.get":
		var p struct {
			Document string `json:"document"`
			Revision *int   `json:"revision"`
		}
		if err := json.Unmarshal(c.Params, &p); err != nil || p.Document == "" {
			return failure(c.ID, "bad_request", "document.get needs a document id")
		}
		rev := -1
		if p.Revision != nil {
			rev = *p.Revision
		}
		d, err := h.store.GetDocument(p.Document, rev)
		if err != nil {
			return storeFailure(c.ID, err)
		}
		return success(c.ID, d)
	case "document.put":
		var p struct {
			Document string          `json:"document"`
			Base     *int            `json:"base"`
			Body     json.RawMessage `json:"body"`
		}
		if err := json.Unmarshal(c.Params, &p); err != nil || p.Document == "" || p.Base == nil || len(p.Body) == 0 {
			return failure(c.ID, "bad_request", "document.put needs a document id, the base revision and a body")
		}
		rev, err := h.store.PutDocument(p.Document, *p.Base, p.Body)
		if err != nil {
			return storeFailure(c.ID, err)
		}
		h.event("document", "", map[string]any{"document": p.Document, "revision": rev})
		return success(c.ID, map[string]int{"revision": rev})
	case "choose":
		var p struct {
			Cut  string `json:"cut"`
			Take string `json:"take"`
		}
		if err := json.Unmarshal(c.Params, &p); err != nil || p.Cut == "" || p.Take == "" {
			return failure(c.ID, "bad_request", "choose needs a cut and a take")
		}
		if err := h.store.Choose(p.Cut, p.Take); err != nil {
			return storeFailure(c.ID, err)
		}
		h.event("chosen", "", map[string]string{"cut": p.Cut, "take": p.Take})
		return success(c.ID, map[string]string{"cut": p.Cut, "take": p.Take})
	case "cut.create":
		var p struct {
			Scene string `json:"scene"`
			Name  string `json:"name"`
		}
		if err := json.Unmarshal(c.Params, &p); err != nil || p.Scene == "" || p.Name == "" {
			return failure(c.ID, "bad_request", "cut.create needs a scene and a name")
		}
		cut, err := h.store.AddCut(p.Scene, p.Name)
		if err != nil {
			return storeFailure(c.ID, err)
		}
		h.event("studio", "", map[string]string{"cut": cut.ID})
		return success(c.ID, cut)
	case "generate":
		return h.generate(c)
	case "cancel", "skip":
		var p struct {
			Job string `json:"job"`
		}
		if err := json.Unmarshal(c.Params, &p); err != nil || p.Job == "" {
			return failure(c.ID, "bad_request", c.Method+" needs a job id")
		}
		cause := errCancelled
		if c.Method == "skip" {
			cause = errSkipped
		}
		if !h.stop(p.Job, cause) {
			return failure(c.ID, "no_such_job", "job "+p.Job+" is not queued or running")
		}
		return success(c.ID, map[string]string{"job": p.Job})
	default:
		return failure(c.ID, "unknown_method", fmt.Sprintf("unknown method %q", c.Method))
	}
}

func (h *Hub) generate(c Call) Message {
	var p generateParams
	dec := json.NewDecoder(bytes.NewReader(c.Params))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		return failure(c.ID, "bad_request", "generate: "+err.Error())
	}
	var refused []api.FieldError
	refuse := func(field, reason string) { refused = append(refused, api.FieldError{Field: field, Reason: reason}) }

	switch p.Operation {
	case OpText, OpEdit:
		if p.Mask != "" {
			refuse("mask", p.Operation+" uses no mask; ask for inpaint or infill to use one")
		}
	case OpInpaint, OpInfill:
		if p.Mask == "" {
			refuse("mask", p.Operation+" needs a mask layer")
		}
	default:
		refuse("operation", "must be one of text, edit, inpaint or infill")
	}
	if p.Operation == OpText && len(p.Reference) > 0 {
		refuse("reference", "text uses no reference layers")
	}
	if (p.Operation == OpEdit || p.Operation == OpInpaint || p.Operation == OpInfill) && len(p.Reference) == 0 {
		refuse("reference", p.Operation+" needs at least one reference layer")
	}
	if p.Target == "" {
		refuse("target", "required: the layer the result lands on")
	}
	cut, err := h.store.FindCut(p.Cut)
	if err != nil {
		refuse("cut", err.Error())
	} else if cut.Document != p.Document {
		refuse("document", fmt.Sprintf("cut %s uses document %s", p.Cut, cut.Document))
	} else if _, err := h.store.GetDocument(p.Document, p.Revision); err != nil {
		refuse("revision", err.Error())
	}
	// A source image is built from the document's layers, not sent in the request; the
	// engine stages that accept one say so in their capabilities.
	if p.Operation != OpText && p.Operation != "" && !h.engine.Capabilities().Img2Img {
		refuse("operation", p.Operation+" is not supported by this engine stage")
	}

	req, err := api.Decode(bytes.NewReader(p.Request))
	if err != nil {
		return failure(c.ID, "bad_request", err.Error())
	}
	if err := api.Validate(req, h.engine.Capabilities()); err != nil {
		var r *api.RefusalError
		if !errors.As(err, &r) {
			return failure(c.ID, "refused", err.Error())
		}
		for _, f := range r.Fields {
			refuse("request."+f.Field, f.Reason)
		}
	}
	if len(refused) > 0 {
		return Message{Type: "reply", ID: c.ID, Error: &Error{Code: "refused", Message: "generate refused", Fields: refused}}
	}
	if p.Reference == nil {
		p.Reference = []string{}
	}
	return success(c.ID, map[string]string{"job": h.enqueue(p.Submission, req)})
}

func (h *Hub) enqueue(sub Submission, req *api.GenerateRequest) string {
	h.mu.Lock()
	h.nextJob++
	id := "j" + strconv.Itoa(h.nextJob)
	ctx, cancel := context.WithCancelCause(context.Background())
	h.queue = append(h.queue, &job{id: id, sub: sub, req: req, ctx: ctx, cancel: cancel})
	queued := len(h.queue)
	h.mu.Unlock()
	h.event("status", "", map[string]int{"queued": queued})
	select {
	case h.wake <- struct{}{}:
	default:
	}
	return id
}

func (h *Hub) jobs() []JobInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]JobInfo, 0, len(h.queue)+1+len(h.ended))
	if h.running != nil {
		out = append(out, JobInfo{ID: h.running.id, State: "running", Submission: h.running.sub})
	}
	for _, j := range h.queue {
		out = append(out, JobInfo{ID: j.id, State: "queued", Submission: j.sub})
	}
	return append(out, slices.Clone(h.ended)...)
}

// finish records a job's ending for reconnecting tabs and broadcasts it.
func (h *Hub) finish(j *job, outcome, reason, take string) {
	info := JobInfo{ID: j.id, State: "ended", Submission: j.sub, Outcome: outcome, Reason: reason, Take: take}
	h.mu.Lock()
	h.ended = append(h.ended, info)
	if len(h.ended) > keepEnded {
		h.ended = h.ended[len(h.ended)-keepEnded:]
	}
	h.mu.Unlock()
	data := map[string]string{"outcome": outcome, "cut": j.sub.Cut}
	if reason != "" {
		data["reason"] = reason
	}
	if take != "" {
		data["take"] = take
	}
	h.event("ended", j.id, data)
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
			h.finish(j, outcomeOf(cause), "", "")
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
	defer j.cancel(nil)
	h.event("progress", j.id, Progress{Phase: "starting", Step: 0, Steps: j.req.Steps})
	res, err := h.engine.Generate(j.ctx, j.req, func(p Progress) {
		h.event("progress", j.id, p)
	})
	switch {
	case err == nil:
		manifest, _ := json.Marshal(map[string]any{"job": j.id, "submission": j.sub, "request": j.req})
		receipt, _ := json.Marshal(res.Receipt)
		take, err := h.store.AddTake(j.sub.Cut, "image", j.id, res.PNG, manifest, receipt)
		if err != nil {
			h.finish(j, EndedFailed, "store_error: "+err.Error(), "")
			return
		}
		h.finish(j, EndedDone, "", take.ID)
	case errors.Is(context.Cause(j.ctx), errCancelled), errors.Is(context.Cause(j.ctx), errSkipped):
		h.finish(j, outcomeOf(context.Cause(j.ctx)), "", "")
	case errors.Is(err, ErrOutOfMemory):
		h.finish(j, EndedFailed, "out_of_memory", "")
	default:
		h.finish(j, EndedFailed, "engine_error: "+err.Error(), "")
	}
}

func outcomeOf(cause error) string {
	if errors.Is(cause, errSkipped) {
		return EndedSkipped
	}
	return EndedCancelled
}
