package rpc

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/ws"
)

// reference is a request stage 1 accepts.
const reference = `{"prompt": "a lamplit corridor", "checkpoint": "fluxFusionV24StepsGGUFNF4_V2NF4AIO_full_nf4",
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

func start(t *testing.T, e Engine) string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(NewHub(ctx, e))
	t.Cleanup(func() { cancel(); srv.Close() })
	return "ws://" + strings.TrimPrefix(srv.URL, "http://") + "/socket"
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

func (tb *tab) call(id, method, params string) {
	tb.t.Helper()
	msg := `{"id": "` + id + `", "method": "` + method + `"`
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

func reply(id string) func(map[string]any) bool {
	return func(m map[string]any) bool { return m["type"] == "reply" && m["id"] == id }
}

func event(name string) func(map[string]any) bool {
	return func(m map[string]any) bool { return m["type"] == "event" && m["event"] == name }
}

func data(m map[string]any) map[string]any { d, _ := m["data"].(map[string]any); return d }

func TestHelloReturnsCapabilities(t *testing.T) {
	tb := open(t, start(t, &fakeEngine{caps: api.Stage1()}))
	tb.call("1", "hello", "")
	r := tb.next(reply("1"))
	caps := r["result"].(map[string]any)["capabilities"].(map[string]any)
	if caps["contractVersion"] != float64(api.ContractVersion) || len(caps["checkpoints"].([]any)) != 1 {
		t.Fatalf("capabilities = %v", caps)
	}
}

func TestGenerateIsRefusedByNameWithoutAnEngine(t *testing.T) {
	tb := open(t, start(t, &fakeEngine{caps: api.Capabilities{ContractVersion: api.ContractVersion}}))
	tb.call("1", "generate", reference)
	e := tb.next(reply("1"))["error"].(map[string]any)
	if e["code"] != "refused" || !strings.Contains(e["message"].(string), "checkpoint") {
		t.Fatalf("error = %v", e)
	}
}

func TestAJobStepsThenEndsDoneAndEveryTabSeesIt(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
	url := start(t, eng)
	a, b := open(t, url), open(t, url)
	b.call("hi", "hello", "")
	b.next(reply("hi")) // b is attached before the job starts
	a.call("1", "generate", reference)
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
	res := b.next(event("result"))
	if res["job"] != job || data(res)["receipt"].(map[string]any)["seed"] != float64(19) {
		t.Fatalf("result = %v", res)
	}
	for _, tb := range []*tab{a, b} {
		if out := data(tb.next(event("ended")))["outcome"]; out != EndedDone {
			t.Fatalf("ended %v, want done", out)
		}
	}
}

func TestCancelAndSkipEndARunningJobDifferently(t *testing.T) {
	for _, method := range []string{"cancel", "skip"} {
		eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
		tb := open(t, start(t, eng))
		tb.call("1", "generate", reference)
		job := tb.next(reply("1"))["result"].(map[string]any)["job"].(string)
		eng.tick <- struct{}{}
		tb.next(func(m map[string]any) bool { return event("progress")(m) && data(m)["step"] == float64(1) })
		tb.call("2", method, `{"job": "`+job+`"}`)
		tb.next(reply("2"))
		want := map[string]string{"cancel": EndedCancelled, "skip": EndedSkipped}[method]
		if out := data(tb.next(event("ended")))["outcome"]; out != want {
			t.Fatalf("%s: ended %v, want %s", method, out, want)
		}
	}
}

func TestAQueuedJobCanBeCancelledBeforeItStarts(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{})}
	tb := open(t, start(t, eng))
	tb.call("1", "generate", reference)
	tb.next(reply("1"))
	tb.call("2", "generate", reference)
	second := tb.next(reply("2"))["result"].(map[string]any)["job"].(string)
	tb.call("3", "cancel", `{"job": "`+second+`"}`)
	// A queued job ends at once, so its ended event may arrive before the cancel
	// reply; the client must accept either order.
	var gotReply, gotEnded bool
	for !gotReply || !gotEnded {
		m := tb.next(func(m map[string]any) bool { return reply("3")(m) || event("ended")(m) })
		if m["type"] == "reply" {
			gotReply = true
			continue
		}
		if m["job"] != second || data(m)["outcome"] != EndedCancelled {
			t.Fatalf("ended = %v", m)
		}
		gotEnded = true
	}
}

func TestOutOfMemoryFailsTheJobByName(t *testing.T) {
	eng := &fakeEngine{caps: api.Stage1(), tick: make(chan struct{}), fail: ErrOutOfMemory}
	tb := open(t, start(t, eng))
	tb.call("1", "generate", reference)
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
	tb := open(t, start(t, &fakeEngine{caps: api.Stage1()}))
	for _, c := range []struct{ id, method, params, code string }{
		{"1", "paint", "", "unknown_method"},
		{"2", "cancel", `{"job": "j99"}`, "no_such_job"},
		{"3", "cancel", `{}`, "bad_request"},
		{"4", "generate", `{"prompt": "x", "hiresFix": true}`, "bad_request"},
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
