// Package rpc is the protocol the page speaks to the guest over one WebSocket per tab.
//
// The client sends calls; the guest answers each with one reply and pushes events that
// every connected tab sees. Events are a live feed, not a record: a tab that reconnects
// asks for the truth with "jobs", "studio" and "document.get" instead of trusting events
// it may have missed.
//
// A job (one generate call) is bound to exactly what was submitted: a cut, a saved
// document revision, an explicit operation and the layers it reads. It always ends with
// exactly one "ended" event: done, cancelled, skipped or failed with a named reason. A
// job the guest was restarted under ends "interrupted"; work doesn't survive a restart.
// Its result becomes a take in the cut it came from and never changes what that cut has
// chosen. Jobs run one at a time because one GPU serves them all.
package rpc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/store"
)

// Call is one client request. ID is chosen by the client and echoed in the reply.
// Request is required on calls that change something, and names one attempt at one
// effect forever: a retry with the same Request gets the original reply, or "uncertain"
// if the guest can't tell whether the first attempt took effect, but never a second
// effect. So a reply lost in a disconnect or a restart can't start a second generation.
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
	// EndedInterrupted is a job that was queued or running when the guest stopped.
	EndedInterrupted = "interrupted"
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

// A "jobs" page holds pageJobs jobs unless the call asks for fewer, and never more than
// maxPageJobs.
const (
	pageJobs    = 50
	maxPageJobs = 200
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

// JobInfo is one job as "jobs" and "job.get" report it, and as its record on disk keeps
// it. Request is the request id of the generate call that made it.
type JobInfo struct {
	ID         string     `json:"id"`
	State      string     `json:"state"` // "queued", "running" or "ended"
	Request    string     `json:"request,omitempty"`
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
	nextJob  int
	starting map[string]bool    // job ids being recorded, not yet queued
	unsaved  map[string]JobInfo // endings this boot couldn't record on disk
	inflight map[string]chan struct{}
	wake     chan struct{}
}

type job struct {
	id      string
	request string
	sub     Submission
	req     *api.GenerateRequest
	ctx     context.Context
	cancel  context.CancelCauseFunc
}

// NewHub starts the job runner. Cancel ctx to stop it.
func NewHub(ctx context.Context, engine Engine, st *store.Store) *Hub {
	h := &Hub{engine: engine, store: st, sinks: map[Sink]struct{}{}, starting: map[string]bool{}, unsaved: map[string]JobInfo{}, inflight: map[string]chan struct{}{}, wake: make(chan struct{}, 1)}
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
	// The first one does the work; the other waits for it, then reads its outcome.
	for {
		h.mu.Lock()
		wait, busy := h.inflight[c.Request]
		if !busy {
			h.inflight[c.Request] = make(chan struct{})
			h.mu.Unlock()
			break
		}
		h.mu.Unlock()
		<-wait
	}
	defer h.release(c.Request)

	hash := paramsHash(c.Params)
	prev, err := h.store.LoadEntry(c.Request)
	switch {
	case err == nil:
		if prev.Method != c.Method || prev.ParamsHash != hash {
			return failure(c.ID, "request_reused", "request id "+c.Request+" was already used for a different call; use a new one")
		}
		if prev.State == store.Pending {
			return failure(c.ID, "uncertain", "an earlier attempt with this request id may or may not have taken effect; "+
				"read studio, jobs or job.get to see, and use a new request id to try again")
		}
		var m Message
		if err := json.Unmarshal(prev.Reply, &m); err != nil {
			return failure(c.ID, "storage_error", "the recorded reply for this request id is unreadable: "+err.Error())
		}
		m.ID = c.ID
		return m
	case !errors.Is(err, store.ErrNotFound):
		return failure(c.ID, "storage_error", "can't tell whether this request id was used before: "+err.Error())
	}

	entry := store.Entry{Request: c.Request, Method: c.Method, ParamsHash: hash, State: store.Pending}
	if err := h.store.SaveEntry(entry); err != nil {
		return failure(c.ID, "storage_error", "can't record the request before acting on it: "+err.Error())
	}
	m := h.dispatch(c)
	if m.Error != nil && m.Error.Code == "uncertain" {
		// The effect may have landed. Leaving the entry pending makes every retry
		// answer uncertain too, rather than replaying a reply that might be wrong.
		return m
	}
	reply, err := json.Marshal(m)
	if err == nil {
		entry.State, entry.Reply = store.Complete, reply
		err = h.store.SaveEntry(entry)
	}
	if err != nil {
		// The caller still gets its reply. A later retry finds pending or complete,
		// whichever reached the disk, and gets uncertain or this reply: never a re-run.
		log.Printf("diffusatory: record reply for request %q: %v", c.Request, err)
	}
	return m
}

func (h *Hub) release(request string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	close(h.inflight[request])
	delete(h.inflight, request)
}

// paramsHash identifies a call's parameters, so a reused request id with different
// work is caught. Whitespace doesn't count; key order does.
func paramsHash(params json.RawMessage) string {
	var b bytes.Buffer
	if err := json.Compact(&b, params); err != nil {
		b.Reset()
		b.Write(params)
	}
	sum := sha256.Sum256(b.Bytes())
	return hex.EncodeToString(sum[:])
}

func success(id string, result any) Message { return Message{Type: "reply", ID: id, Result: result} }

func failure(id, code, msg string) Message {
	return Message{Type: "reply", ID: id, Error: &Error{Code: code, Message: msg}}
}

// storeFailure turns a store error into a reply. Refusals name what was wrong. A
// storage failure means nothing visible changed, so the client may try again with a new
// request id; uncertain means the change may have landed, and the client must look.
func storeFailure(id string, err error) Message {
	switch {
	case errors.Is(err, store.ErrStale):
		return failure(id, "stale", err.Error())
	case errors.Is(err, store.ErrNotFound):
		return failure(id, "not_found", err.Error())
	case errors.Is(err, store.ErrInvalid):
		return failure(id, "bad_request", err.Error())
	case errors.Is(err, store.ErrUncertain):
		return failure(id, "uncertain", err.Error()+"; read the studio to see whether it did")
	default:
		return failure(id, "storage_error", err.Error())
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
		var p struct {
			Before string `json:"before"`
			Limit  int    `json:"limit"`
		}
		if len(c.Params) > 0 {
			if err := json.Unmarshal(c.Params, &p); err != nil || p.Limit < 0 {
				return failure(c.ID, "bad_request", "jobs takes an optional before job id and a limit")
			}
		}
		page, err := h.jobs(p.Before, p.Limit)
		if err != nil {
			return storeFailure(c.ID, err)
		}
		return success(c.ID, page)
	case "job.get":
		var p struct {
			Job string `json:"job"`
		}
		if err := json.Unmarshal(c.Params, &p); err != nil || p.Job == "" {
			return failure(c.ID, "bad_request", "job.get needs a job id")
		}
		info, err := h.job(p.Job)
		if err != nil {
			return storeFailure(c.ID, err)
		}
		return success(c.ID, info)
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
		if errors.Is(err, store.ErrUncertain) {
			h.event("document", "", map[string]any{"document": p.Document, "revision": rev})
		}
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
			if errors.Is(err, store.ErrUncertain) {
				h.event("chosen", "", map[string]string{"cut": p.Cut, "take": p.Take})
			}
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
		if errors.Is(err, store.ErrUncertain) {
			h.event("studio", "", map[string]string{"cut": cut.ID})
		}
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
	// Edit, inpaint and infill read their source and mask from the document's layers.
	// Until the layer resolver exists nothing would reach the engine, so refuse them
	// rather than accept a job with no source (Mira's review of a2fc9391).
	if p.Operation == OpEdit || p.Operation == OpInpaint || p.Operation == OpInfill {
		refuse("operation", p.Operation+" needs the layer resolver, which isn't built yet")
	}
	// A revision pins the content a job reads; "newest" would let it change later.
	if p.Revision < 0 {
		refuse("revision", "must be a saved revision number, not a moving alias")
	}
	cut, err := h.store.FindCut(p.Cut)
	if err != nil {
		refuse("cut", err.Error())
	} else if cut.Document != p.Document {
		refuse("document", fmt.Sprintf("cut %s uses document %s", p.Cut, cut.Document))
	} else if p.Revision >= 0 {
		if _, err := h.store.GetDocument(p.Document, p.Revision); err != nil {
			refuse("revision", err.Error())
		}
	}

	req, err := api.Decode(bytes.NewReader(p.Request))
	if err != nil {
		return failure(c.ID, "bad_request", err.Error())
	}
	// The source and mask come from the document's layers, named by the submission, so
	// an image or mask carried inside the request would bypass that explicit choice.
	for field, set := range map[string]bool{
		"initImage": req.InitImage != "", "mask": req.Mask != "", "denoisingStrength": req.DenoisingStrength != nil,
		"maskBlur": req.MaskBlur != nil, "inpaintOnlyMasked": req.InpaintOnlyMasked != nil,
		"inpaintPadding": req.InpaintPadding != nil, "resizeMode": req.ResizeMode != nil,
	} {
		if set {
			refuse("request."+field, "the source and mask come from the document's layers, not the request")
		}
	}
	slices.SortStableFunc(refused, func(a, b api.FieldError) int { return strings.Compare(a.Field, b.Field) })
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
	id, err := h.enqueue(c.Request, p.Submission, req)
	if err != nil {
		// Not queued either way. If the record may have landed, job.get reports that
		// job as never started.
		return storeFailure(c.ID, fmt.Errorf("can't record the job: %w", err))
	}
	return success(c.ID, map[string]string{"job": id})
}

// enqueue records the job on disk, then queues it. Its id names this boot, so it can't
// collide with a job a saved reply from an earlier boot names.
func (h *Hub) enqueue(request string, sub Submission, req *api.GenerateRequest) (string, error) {
	h.mu.Lock()
	h.nextJob++
	id := h.store.JobID(h.nextJob)
	h.starting[id] = true // so job() doesn't call it never-started while it's recorded
	h.mu.Unlock()
	err := h.saveJob(JobInfo{ID: id, State: "queued", Request: request, Submission: sub})
	ctx, cancel := context.WithCancelCause(context.Background())
	h.mu.Lock()
	delete(h.starting, id)
	if err != nil {
		h.mu.Unlock()
		cancel(nil)
		return "", err
	}
	h.queue = append(h.queue, &job{id: id, request: request, sub: sub, req: req, ctx: ctx, cancel: cancel})
	queued := len(h.queue)
	h.mu.Unlock()
	h.event("status", "", map[string]int{"queued": queued})
	select {
	case h.wake <- struct{}{}:
	default:
	}
	return id, nil
}

func (h *Hub) saveJob(info JobInfo) error {
	b, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return h.store.SaveJob(info.ID, b)
}

// job reports one job by exact id, from any boot. Its ending on disk wins, then an
// ending this guest couldn't write; otherwise it's queued or running here. A record left
// unfinished by an earlier boot was interrupted; one from this boot that isn't live was
// never queued, because recording it failed.
func (h *Hub) job(id string) (JobInfo, error) {
	var info JobInfo
	rec, err := h.store.LoadJob(id)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return info, err
	}
	if err == nil {
		if err := json.Unmarshal(rec, &info); err != nil {
			return info, fmt.Errorf("job %s record is unreadable: %w", id, err)
		}
		if info.State == "ended" {
			return info, nil
		}
	}
	h.mu.Lock()
	if unsaved, ok := h.unsaved[id]; ok {
		h.mu.Unlock()
		return unsaved, nil
	}
	if h.starting[id] {
		h.mu.Unlock()
		return JobInfo{ID: id, State: "queued", Request: info.Request, Submission: info.Submission}, nil
	}
	live := h.running
	if live == nil || live.id != id {
		live = nil
		for _, j := range h.queue {
			if j.id == id {
				live = j
				break
			}
		}
	}
	running := live != nil && live == h.running
	h.mu.Unlock()
	if live != nil {
		state := "queued"
		if running {
			state = "running"
		}
		return JobInfo{ID: id, State: state, Request: live.request, Submission: live.sub}, nil
	}
	if errors.Is(err, store.ErrNotFound) {
		return info, store.ErrNotFound
	}
	info.State = "ended"
	if boot, _ := store.JobBoot(id); boot < h.store.Boot() {
		info.Outcome, info.Reason = EndedInterrupted, "guest restarted"
	} else {
		info.Outcome, info.Reason = EndedFailed, "never started: recording the job failed"
	}
	return info, nil
}

// jobPage is one page of "jobs", newest first. Next, when set, is the before value for
// the following page.
type jobPage struct {
	Jobs []JobInfo `json:"jobs"`
	Next string    `json:"next,omitempty"`
}

func (h *Hub) jobs(before string, limit int) (jobPage, error) {
	if limit == 0 {
		limit = pageJobs
	}
	limit = min(limit, maxPageJobs)
	ids, err := h.store.JobIDs()
	if err != nil {
		return jobPage{}, err
	}
	if before != "" {
		i := slices.Index(ids, before)
		if i < 0 {
			return jobPage{}, store.ErrNotFound
		}
		ids = ids[i+1:]
	}
	page := jobPage{Jobs: []JobInfo{}}
	for _, id := range ids {
		if len(page.Jobs) == limit {
			page.Next = page.Jobs[len(page.Jobs)-1].ID
			break
		}
		info, err := h.job(id)
		if err != nil {
			return jobPage{}, err
		}
		page.Jobs = append(page.Jobs, info)
	}
	return page, nil
}

// finish records a job's ending on disk and broadcasts it.
func (h *Hub) finish(j *job, outcome, reason, take string) {
	info := JobInfo{ID: j.id, State: "ended", Request: j.request, Submission: j.sub, Outcome: outcome, Reason: reason, Take: take}
	if err := h.saveJob(info); err != nil {
		// Keep the true ending for this boot. After a restart the job reads
		// interrupted, even if its take exists.
		log.Printf("diffusatory: record the ending of job %s: %v", j.id, err)
		h.mu.Lock()
		h.unsaved[j.id] = info
		h.mu.Unlock()
	}
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
			reason := "store_error: "
			if errors.Is(err, store.ErrUncertain) {
				reason = "store_uncertain: the take may exist: "
			}
			h.finish(j, EndedFailed, reason+err.Error(), "")
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
