package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/store"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/ws"
)

// request is a typed request stage 1 accepts.
const request = `{"prompt": "a lamplit corridor", "checkpoint": "fluxFusionV24StepsGGUFNF4_V2NF4AIO_full_nf4",
  "width": 1344, "height": 768, "steps": 8, "sampler": "Euler", "scheduler": "Simple", "cfgScale": 1, "seed": 19}`

// fakeEngine steps once per tick from the test, so a test decides exactly when each
// sampler step happens and can cancel in between.
type fakeEngine struct {
	caps api.Capabilities
	tick chan struct{}
	fail error
}

func (e *fakeEngine) Capabilities() api.Capabilities { return e.caps }

func (e *fakeEngine) Generate(ctx context.Context, req *api.GenerateRequest, step func(Progress)) (*Result, error) {
	for i := 1; i <= req.Steps; i++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-e.tick:
		}
		if e.fail != nil {
			return nil, e.fail
		}
		step(Progress{Phase: "sampling", Step: i, Steps: req.Steps})
	}
	return &Result{PNG: []byte("png"), Receipt: map[string]any{"seed": *req.Seed}}, nil
}

// studio is one test guest: its socket URL, its store and the default cut.
type studio struct {
	url string
	st  *store.Store
	cut store.Cut
}

func start(t *testing.T, e Engine) studio {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tree, err := st.Studio()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(NewHub(ctx, e, st))
	t.Cleanup(func() { cancel(); srv.Close() })
	return studio{
		url: "ws://" + strings.TrimPrefix(srv.URL, "http://") + "/socket",
		st:  st,
		cut: tree.Projects[0].Scenes[0].Cuts[0],
	}
}

// text is a text-to-image generate call for cut c at document revision rev.
func text(c store.Cut, rev int) string {
	return `{"cut": "` + c.ID + `", "document": "` + c.Document + `", "revision": ` + strconv.Itoa(rev) +
		`, "operation": "text", "target": "layer-1", "request": ` + request + `}`
}

type tab struct {
	t *testing.T
	c *ws.Conn
}

func open(t *testing.T, url string) *tab {
	t.Helper()
	c, err := ws.Dial(url, MaxCallBytes)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { c.Close() })
	return &tab{t: t, c: c}
}

// call sends one call. Calls that change something get the request id "r-"+id.
func (tb *tab) call(id, method, params string) {
	tb.t.Helper()
	msg := `{"id": "` + id + `", "method": "` + method + `"`
	if mutating[method] {
		msg += `, "request": "r-` + id + `"`
	}
	if params != "" {
		msg += `, "params": ` + params
	}
	if err := tb.c.Write([]byte(msg + `}`)); err != nil {
		tb.t.Fatalf("write: %v", err)
	}
}

// next reads messages until one matches keep, failing after a few seconds. The read
// deadline makes a missing message fail the test instead of hanging it.
func (tb *tab) next(keep func(map[string]any) bool) map[string]any {
	tb.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	if err := tb.c.SetReadDeadline(deadline); err != nil {
		tb.t.Fatal(err)
	}
	for time.Now().Before(deadline) {
		raw, err := tb.c.Read()
		if err != nil {
			tb.t.Fatalf("read: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			tb.t.Fatalf("decode %s: %v", raw, err)
		}
		if keep(m) {
			return m
		}
	}
	tb.t.Fatal("no matching message within 5 s")
	return nil
}

// replyAndEnded waits for both the reply to call id and the ended event of job, in
// either order: a job can end, and its event go out, before the reply to the call that
// ended it has been written.
func (tb *tab) replyAndEnded(id, job string) (r, ended map[string]any) {
	tb.t.Helper()
	for r == nil || ended == nil {
		m := tb.next(func(m map[string]any) bool { return reply(id)(m) || (event("ended")(m) && m["job"] == job) })
		if m["type"] == "reply" {
			r = m
		} else {
			ended = m
		}
	}
	return r, ended
}

func reply(id string) func(map[string]any) bool {
	return func(m map[string]any) bool { return m["type"] == "reply" && m["id"] == id }
}

func event(name string) func(map[string]any) bool {
	return func(m map[string]any) bool { return m["type"] == "event" && m["event"] == name }
}

func data(m map[string]any) map[string]any { d, _ := m["data"].(map[string]any); return d }

func TestHelloReturnsCapabilities(t *testing.T) {
	tb := open(t, start(t, &fakeEngine{caps: api.Stage1()}).url)
	tb.call("1", "hello", "")
	r := tb.next(reply("1"))
	caps := r["result"].(map[string]any)["capabilities"].(map[string]any)
	if caps["contractVersion"] != float64(api.ContractVersion) || len(caps["checkpoints"].([]any)) != 1 {
		t.Fatalf("capabilities = %v", caps)
	}
}

func TestGenerateIsRefusedByNameWithoutAnEngine(t *testing.T) {
	g := start(t, &fakeEngine{caps: api.Capabilities{ContractVersion: api.ContractVersion}})
	tb := open(t, g.url)
	tb.call("1", "generate", text(g.cut, 0))
	e := tb.next(reply("1"))["error"].(map[string]any)
	if e["code"] != "refused" || !strings.Contains(fmt.Sprint(e["fields"]), "request.checkpoint") {
		t.Fatalf("error = %v", e)
	}
}

func TestAJobStepsThenEndsDoneAndEveryTabSeesIt(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
	g := start(t, eng)
	a, b := open(t, g.url), open(t, g.url)
	b.call("hi", "hello", "")
	b.next(reply("hi")) // b is attached before the job starts
	a.call("1", "generate", text(g.cut, 0))
	job := a.next(reply("1"))["result"].(map[string]any)["job"]
	for i := 1; i <= 8; i++ {
		eng.tick <- struct{}{}
		p := data(b.next(event("progress")))
		for p["step"] == float64(0) {
			p = data(b.next(event("progress")))
		}
		if p["step"] != float64(i) || p["steps"] != float64(8) {
			t.Fatalf("progress %v, want step %d of 8", p, i)
		}
	}
	for _, tb := range []*tab{a, b} {
		ended := tb.next(event("ended"))
		if ended["job"] != job || data(ended)["outcome"] != EndedDone || data(ended)["take"] == nil {
			t.Fatalf("ended = %v, want done with a take", ended)
		}
	}
}

func TestCancelAndSkipEndARunningJobDifferently(t *testing.T) {
	for _, method := range []string{"cancel", "skip"} {
		eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
		g := start(t, eng)
		tb := open(t, g.url)
		tb.call("1", "generate", text(g.cut, 0))
		job := tb.next(reply("1"))["result"].(map[string]any)["job"].(string)
		eng.tick <- struct{}{}
		tb.next(func(m map[string]any) bool { return event("progress")(m) && data(m)["step"] == float64(1) })
		tb.call("2", method, `{"job": "`+job+`"}`)
		_, ended := tb.replyAndEnded("2", job)
		want := map[string]string{"cancel": EndedCancelled, "skip": EndedSkipped}[method]
		if out := data(ended)["outcome"]; out != want {
			t.Fatalf("%s: ended %v, want %s", method, out, want)
		}
	}
}

func TestAQueuedJobCanBeCancelledBeforeItStarts(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
	g := start(t, eng)
	tb := open(t, g.url)
	tb.call("1", "generate", text(g.cut, 0))
	tb.next(reply("1"))
	tb.call("2", "generate", text(g.cut, 0))
	second := tb.next(reply("2"))["result"].(map[string]any)["job"].(string)
	tb.call("3", "cancel", `{"job": "`+second+`"}`)
	if _, ended := tb.replyAndEnded("3", second); data(ended)["outcome"] != EndedCancelled {
		t.Fatalf("ended = %v", ended)
	}
}

func TestOutOfMemoryFailsTheJobByName(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{}), fail: ErrOutOfMemory}
	g := start(t, eng)
	tb := open(t, g.url)
	tb.call("1", "generate", text(g.cut, 0))
	tb.next(reply("1"))
	eng.tick <- struct{}{}
	d := data(tb.next(event("ended")))
	if d["outcome"] != EndedFailed || d["reason"] != "out_of_memory" {
		t.Fatalf("ended = %v", d)
	}
	tb.call("2", "hello", "") // the guest carries on after a failed job
	tb.next(reply("2"))
}

func TestBadCallsGetNamedErrors(t *testing.T) {
	tb := open(t, start(t, &fakeEngine{caps: api.Stage1()}).url)
	for _, c := range []struct{ id, method, params, code string }{
		{"1", "paint", "", "unknown_method"},
		{"2", "cancel", `{"job": "j99"}`, "no_such_job"},
		{"3", "cancel", `{}`, "bad_request"},
		{"4", "generate", `{"cut": "c1", "request": {}, "hiresFix": true}`, "bad_request"},
	} {
		tb.call(c.id, c.method, c.params)
		if code := tb.next(reply(c.id))["error"].(map[string]any)["code"]; code != c.code {
			t.Fatalf("%s %s: code %v, want %s", c.method, c.params, code, c.code)
		}
	}
	if err := tb.c.Write([]byte(`{"method": "hello"}`)); err != nil {
		t.Fatal(err)
	}
	if code := tb.next(func(m map[string]any) bool { return m["type"] == "reply" })["error"].(map[string]any)["code"]; code != "bad_call" {
		t.Fatalf("call without id: code %v", code)
	}
}

// A mask left on the canvas must not turn an edit into an inpaint, and an inpaint
// without a mask is refused: the operation is always the client's explicit choice.
func TestTheOperationIsExplicitNotInferredFromLayers(t *testing.T) {
	caps := api.Stage1()
	caps.Img2Img = true
	g := start(t, &fakeEngine{caps: caps})
	tb := open(t, g.url)
	sub := func(op, extra string) string {
		return `{"cut": "` + g.cut.ID + `", "document": "` + g.cut.Document + `", "revision": 0, "operation": "` + op +
			`", "target": "layer-2"` + extra + `, "request": ` + request + `}`
	}
	for i, c := range []struct{ params, field string }{
		{sub("edit", `, "reference": ["layer-1"], "mask": "mask-1"`), "mask"},
		{sub("inpaint", `, "reference": ["layer-1"]`), "mask"},
		{sub("text", `, "reference": ["layer-1"]`), "reference"},
		{sub("paint", ``), "operation"},
	} {
		id := "o" + strconv.Itoa(i)
		tb.call(id, "generate", c.params)
		e := tb.next(reply(id))["error"].(map[string]any)
		if e["code"] != "refused" || !strings.Contains(fmt.Sprint(e["fields"]), "field:"+c.field+" ") {
			t.Fatalf("case %d: error = %v, want %s refused", i, e, c.field)
		}
	}
	// A well-formed edit is still refused until the layer resolver exists: accepting it
	// now would send the engine no source at all.
	tb.call("ok", "generate", sub("edit", `, "reference": ["layer-1"]`))
	e := tb.next(reply("ok"))["error"].(map[string]any)
	if !strings.Contains(fmt.Sprint(e["fields"]), "field:operation reason:edit needs the layer resolver") {
		t.Fatalf("well-formed edit: %v, want refused for the missing resolver", e)
	}
}

func TestAStaleDocumentSaveIsRefused(t *testing.T) {
	g := start(t, &fakeEngine{caps: api.Stage1()})
	a, b := open(t, g.url), open(t, g.url)
	put := func(tb *tab, id, body string) map[string]any {
		tb.call(id, "document.put", `{"document": "`+g.cut.Document+`", "base": 0, "body": `+body+`}`)
		return tb.next(reply(id))
	}
	if r := put(a, "1", `{"layers": ["a"]}`); r["error"] != nil || r["result"].(map[string]any)["revision"] != float64(1) {
		t.Fatalf("first save = %v", r)
	}
	if e := put(b, "2", `{"layers": ["b"]}`)["error"]; e == nil || e.(map[string]any)["code"] != "stale" {
		t.Fatalf("second save on the same base = %v, want stale", e)
	}
	b.call("3", "document.get", `{"document": "`+g.cut.Document+`"}`)
	d := b.next(reply("3"))["result"].(map[string]any)
	if d["revision"] != float64(1) || !strings.Contains(fmt.Sprint(d["body"]), "a") {
		t.Fatalf("newest document = %v, want a's save at revision 1", d)
	}
}

// Mira's falsifier (b): a tab submits a generation and loses its connection before the
// reply. On reconnect it retries with the same request id and asks for the job list.
// There must be exactly one job, and its ending must be recoverable.
func TestAReconnectedRetryDoesNotDuplicateAndRecoversTheResult(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
	g := start(t, eng)
	first := open(t, g.url)
	_ = first.c.Write([]byte(`{"id": "1", "method": "generate", "request": "lost-reply", "params": ` + text(g.cut, 0) + `}`))
	first.c.Close() // gone before reading the reply

	again := open(t, g.url)
	_ = again.c.Write([]byte(`{"id": "9", "method": "generate", "request": "lost-reply", "params": ` + text(g.cut, 0) + `}`))
	job := again.next(reply("9"))["result"].(map[string]any)["job"]
	for i := 0; i < 8; i++ {
		eng.tick <- struct{}{}
	}
	again.next(event("ended"))
	again.call("j", "jobs", "")
	var mine []any
	for _, j := range again.next(reply("j"))["result"].([]any) {
		if j.(map[string]any)["id"] == job {
			mine = append(mine, j)
		}
	}
	all := again
	all.call("k", "jobs", "")
	if n := len(all.next(reply("k"))["result"].([]any)); n != 1 || len(mine) != 1 {
		t.Fatalf("jobs: %d in total, %d for this request; want exactly one", n, len(mine))
	}
	if j := mine[0].(map[string]any); j["state"] != "ended" || j["outcome"] != EndedDone || j["take"] == nil {
		t.Fatalf("recovered job = %v", j)
	}
}

// Mira's falsifier (a), for images: start a job from revision 0, then save a new
// revision, choose a different take and create another cut while the job runs. When
// the job lands, its take belongs to the original cut, records revision 0, and has not
// replaced the explicit choice.
func TestALateResultLandsWhereItCameFromAndChoosesNothing(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
	g := start(t, eng)
	tb := open(t, g.url)

	// Take B: a finished result the user explicitly chooses.
	tb.call("1", "generate", text(g.cut, 0))
	tb.next(reply("1"))
	for i := 0; i < 8; i++ {
		eng.tick <- struct{}{}
	}
	takeB := data(tb.next(event("ended")))["take"].(string)

	// Take A starts from revision 0 ...
	tb.call("2", "generate", text(g.cut, 0))
	jobA := tb.next(reply("2"))["result"].(map[string]any)["job"]
	eng.tick <- struct{}{}
	// ... and while it runs the document moves on, B is chosen and another cut is made.
	tb.call("3", "document.put", `{"document": "`+g.cut.Document+`", "base": 0, "body": {"layers": ["moved on"]}}`)
	tb.next(reply("3"))
	tb.call("4", "choose", `{"cut": "`+g.cut.ID+`", "take": "`+takeB+`"}`)
	tb.next(reply("4"))
	tree, _ := g.st.Studio()
	tb.call("5", "cut.create", `{"scene": "`+tree.Projects[0].Scenes[0].ID+`", "name": "Cut 2"}`)
	tb.next(reply("5"))
	for i := 1; i < 8; i++ {
		eng.tick <- struct{}{}
	}
	ended := tb.next(func(m map[string]any) bool { return event("ended")(m) && m["job"] == jobA })
	takeA := data(ended)["take"].(string)

	// Reopen from disk, as a fresh guest would.
	reopened, err := g.st.FindCut(g.cut.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.ChosenImages) != 1 || reopened.ChosenImages[0] != takeB {
		t.Fatalf("chosen images = %v, want only B (%s)", reopened.ChosenImages, takeB)
	}
	a, err := g.st.GetTake(takeA)
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Submission Submission `json:"submission"`
	}
	if err := json.Unmarshal(a.Manifest, &manifest); err != nil {
		t.Fatal(err)
	}
	if a.Cut != g.cut.ID || manifest.Submission.Revision != 0 || manifest.Submission.Cut != g.cut.ID {
		t.Fatalf("take A = cut %s, manifest %+v; want the original cut at revision 0", a.Cut, manifest.Submission)
	}
	if _, err := g.st.GetDocument(g.cut.Document, 0); err != nil {
		t.Fatalf("revision 0, which A was made from, is gone: %v", err)
	}
}
