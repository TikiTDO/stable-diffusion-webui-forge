// Mira's focused review checks of a2fc9391 (Desk c29571), kept as regression tests.
package rpc

import (
	"context"
	"encoding/json"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/store"
	"strings"
	"testing"
)

type miraEngine struct{ caps api.Capabilities }

func (e *miraEngine) Capabilities() api.Capabilities { return e.caps }
func (e *miraEngine) Generate(context.Context, *api.GenerateRequest, func(Progress)) (*Result, error) {
	return &Result{PNG: []byte("fixture"), Receipt: map[string]any{}}, nil
}
func miraHub(t *testing.T, caps api.Capabilities) (*Hub, store.Cut) {
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
	t.Cleanup(cancel)
	return NewHub(ctx, &miraEngine{caps}, st), tree.Projects[0].Scenes[0].Cuts[0]
}
func miraCall(h *Hub, id, token, method, params string) Message {
	b, err := json.Marshal(Call{ID: id, Request: token, Method: method, Params: json.RawMessage(params)})
	if err != nil {
		panic(err)
	}
	return h.Handle(b)
}
func TestMiraSubmissionMustPinANumberedRevision(t *testing.T) {
	h, c := miraHub(t, api.Stage1())
	p := strings.Replace(text(c, 0), `"revision": 0`, `"revision": -1`, 1)
	m := miraCall(h, "1", "negative-revision", "generate", p)
	if m.Error != nil {
		return
	} // explicit refusal is a valid admission policy
	page, err := h.jobs("", maxPageJobs)
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range page.Jobs {
		if j.Submission.Revision < 0 {
			t.Fatalf("accepted job %s with mutable revision alias %d, not a pinned numbered revision", j.ID, j.Submission.Revision)
		}
	}
}
func TestMiraTextOperationMustRefuseIndependentImageAndMask(t *testing.T) {
	caps := api.Stage1()
	caps.Img2Img = true
	caps.Mask = true
	h, c := miraHub(t, caps)
	var p map[string]any
	if err := json.Unmarshal([]byte(text(c, 0)), &p); err != nil {
		t.Fatal(err)
	}
	r := p["request"].(map[string]any)
	// A real, valid 1x1 PNG; no external files or engine invocation is required for admission.
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII="
	r["initImage"] = png
	r["mask"] = png
	b, _ := json.Marshal(p)
	m := miraCall(h, "1", "text-with-mask", "generate", string(b))
	if m.Error == nil {
		t.Fatal("operation=text accepted independent request.initImage+mask, bypassing explicit source/mask layer intent")
	}
}
func TestMiraEditMustResolveOrRefuseMissingReferenceLayers(t *testing.T) {
	caps := api.Stage1()
	caps.Img2Img = true
	h, c := miraHub(t, caps)
	var p map[string]any
	_ = json.Unmarshal([]byte(text(c, 0)), &p)
	p["operation"] = "edit"
	p["reference"] = []string{"not-in-the-empty-document"}
	b, _ := json.Marshal(p)
	m := miraCall(h, "1", "missing-reference", "generate", string(b))
	if m.Error == nil {
		t.Fatal("edit accepted a nonexistent reference in empty revision0; engine receives no resolved source at all")
	}
}
func TestMiraRetryMustNotBecomeNewWorkAfterReplyEviction(t *testing.T) {
	h, c := miraHub(t, api.Stage1())
	p := text(c, 0)
	m := miraCall(h, "original", "original-request", "generate", p)
	if m.Error != nil {
		t.Fatal(m.Error)
	}
	original := m.Result.(map[string]string)["job"]
	for i := 0; i < 4096; i++ { // the size of the reply cache this check was written against
		miraCall(h, "fill", "fill-"+stringID(i), "cancel", `{"job":"does-not-exist"}`)
	}
	retry := miraCall(h, "retry", "original-request", "generate", p)
	if retry.Error != nil {
		return
	} // explicit expiry/refusal is better than duplicate generation
	// A retry answered from disk carries the decoded JSON reply, so compare via JSON.
	if got := jobOf(t, retry); got != original {
		t.Fatalf("retry became new work after %d intervening mutations: old=%s new=%s", 4096, original, got)
	}
}
func jobOf(t *testing.T, m Message) string {
	t.Helper()
	b, err := json.Marshal(m.Result)
	if err != nil {
		t.Fatal(err)
	}
	var r struct {
		Job string `json:"job"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	return r.Job
}

func stringID(i int) string { b, _ := json.Marshal(i); return string(b) }
