package rpc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/api"
	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/store"
)

// Mira's two persistence checks at 29050e77, adapted to the ledger, plus the falsifiers
// the retry/restart contract names. A dormant hub has NewHub's state without its runner:
// these exercise admission and identity, not inference or a real process crash.

func miraDormantHub(st *store.Store) *Hub {
	return &Hub{engine: &miraEngine{api.Stage1()}, store: st, sinks: map[Sink]struct{}{}, starting: map[string]bool{}, unsaved: map[string]JobInfo{}, inflight: map[string]chan struct{}{}, wake: make(chan struct{}, 1)}
}

func openStudio(t *testing.T, root string) (*store.Store, store.Cut) {
	t.Helper()
	st, err := store.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	tree, err := st.Studio()
	if err != nil {
		t.Fatal(err)
	}
	return st, tree.Projects[0].Scenes[0].Cuts[0]
}

func ledgerPath(root, request string) string {
	sum := sha256.Sum256([]byte(request))
	return filepath.Join(root, "requests", hex.EncodeToString(sum[:])+".json")
}

func cutCount(t *testing.T, st *store.Store) int {
	t.Helper()
	tree, err := st.Studio()
	if err != nil {
		t.Fatal(err)
	}
	return len(tree.Projects[0].Scenes[0].Cuts)
}

func sceneOf(t *testing.T, st *store.Store) string {
	t.Helper()
	tree, err := st.Studio()
	if err != nil {
		t.Fatal(err)
	}
	return tree.Projects[0].Scenes[0].ID
}

func TestMiraUnreadableHistoryMustNotDispatchMutation(t *testing.T) {
	root := t.TempDir()
	st, _ := openStudio(t, root)
	token := "uncertain-history"
	// A directory where the entry should be: a deterministic EISDIR, even as root.
	if err := os.Mkdir(ledgerPath(root, token), 0o700); err != nil {
		t.Fatal(err)
	}
	p, _ := json.Marshal(map[string]string{"scene": sceneOf(t, st), "name": "Must not dispatch"})
	m := miraCall(miraDormantHub(st), "retry", token, "cut.create", string(p))
	if m.Error == nil || m.Error.Code != "storage_error" || cutCount(t, st) != 1 {
		t.Fatalf("unreadable history: reply=%+v cuts=%d; want storage_error and 1 cut", m, cutCount(t, st))
	}
}

func TestMiraPersistedJobReplyMustNotAliasNewHubJob(t *testing.T) {
	root := t.TempDir()
	st, c := openStudio(t, root)
	first := miraCall(miraDormantHub(st), "old", "old-generation", "generate", text(c, 0))
	if first.Error != nil {
		t.Fatal(first.Error)
	}
	original := jobOf(t, first)
	st.Close()

	st2, _ := openStudio(t, root)
	fresh := miraDormantHub(st2)
	newer := miraCall(fresh, "new", "different-generation", "generate", text(c, 0))
	if newer.Error != nil {
		t.Fatal(newer.Error)
	}
	replay := miraCall(fresh, "retry", "old-generation", "generate", text(c, 0))
	if replay.Error != nil {
		t.Fatalf("replay of a complete generate = %+v; want the original reply", replay.Error)
	}
	if got, newID := jobOf(t, replay), jobOf(t, newer); got != original || got == newID {
		t.Fatalf("replay = %s, original %s, new %s; want the original and distinct from the new", got, original, newID)
	}
	// Many later jobs must not push the old one out of reach.
	for i := 0; i < maxPageJobs+5; i++ {
		if m := miraCall(fresh, "fill", "fill-"+stringID(i), "generate", text(c, 0)); m.Error != nil {
			t.Fatal(m.Error)
		}
	}
	info, err := fresh.job(original)
	if err != nil {
		t.Fatal(err)
	}
	if info.State != "ended" || info.Outcome != EndedInterrupted || info.Request != "old-generation" {
		t.Fatalf("old job after restart = %+v; want ended, interrupted", info)
	}
	// And the paged list reaches it.
	found, before := false, ""
	for pages := 0; !found; pages++ {
		page, err := fresh.jobs(before, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, j := range page.Jobs {
			found = found || j.ID == original
		}
		if page.Next == "" || pages > 20 {
			break
		}
		before = page.Next
	}
	if !found {
		t.Fatalf("job %s not reachable by paging jobs", original)
	}
}

// A crash between recording the request and recording its reply leaves it pending. A
// retry must say so, not do the work again.
func TestAPendingRequestAnswersUncertainAndDoesNothing(t *testing.T) {
	root := t.TempDir()
	st, _ := openStudio(t, root)
	p, _ := json.Marshal(map[string]string{"scene": sceneOf(t, st), "name": "Cut 2"})
	h := miraDormantHub(st)
	entry := store.Entry{Request: "crashed", Method: "cut.create", ParamsHash: paramsHash(p), State: store.Pending}
	if err := st.SaveEntry(entry); err != nil {
		t.Fatal(err)
	}
	m := miraCall(h, "retry", "crashed", "cut.create", string(p))
	if m.Error == nil || m.Error.Code != "uncertain" || cutCount(t, st) != 1 {
		t.Fatalf("pending retry: reply=%+v cuts=%d; want uncertain and 1 cut", m, cutCount(t, st))
	}
}

// A request id names one call. Reusing it for a different method or different params
// is refused whether the first call finished or not.
func TestARequestIDReusedForDifferentWorkIsRefused(t *testing.T) {
	root := t.TempDir()
	st, c := openStudio(t, root)
	h := miraDormantHub(st)
	scene := sceneOf(t, st)
	p1, _ := json.Marshal(map[string]string{"scene": scene, "name": "Cut 2"})
	p2, _ := json.Marshal(map[string]string{"scene": scene, "name": "Something else"})
	if m := miraCall(h, "1", "used", "cut.create", string(p1)); m.Error != nil {
		t.Fatal(m.Error)
	}
	if err := st.SaveEntry(store.Entry{Request: "pend", Method: "cut.create", ParamsHash: paramsHash(p1), State: store.Pending}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ request, method, params string }{
		{"used", "cut.create", string(p2)},
		{"used", "generate", text(c, 0)},
		{"pend", "cut.create", string(p2)},
		{"pend", "generate", text(c, 0)},
	} {
		m := miraCall(h, "x", tc.request, tc.method, tc.params)
		if m.Error == nil || m.Error.Code != "request_reused" {
			t.Errorf("%s reused for %s: reply=%+v; want request_reused", tc.request, tc.method, m)
		}
	}
	if n := cutCount(t, st); n != 2 {
		t.Fatalf("cuts = %d, want 2: only the first call took effect", n)
	}
	// The same call again, with different whitespace, is the same call.
	again := miraCall(h, "2", "used", "cut.create", " "+string(p1)+"\n")
	if again.Error != nil {
		t.Fatalf("an identical retry was refused: %+v", again.Error)
	}
}

// If the request can't be recorded before acting, nothing happens.
func TestARequestThatCannotBeRecordedHasNoEffect(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	root := t.TempDir()
	st, _ := openStudio(t, root)
	requests := filepath.Join(root, "requests")
	if err := os.Chmod(requests, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(requests, 0o755) })
	p, _ := json.Marshal(map[string]string{"scene": sceneOf(t, st), "name": "Cut 2"})
	m := miraCall(miraDormantHub(st), "1", "unrecordable", "cut.create", string(p))
	if m.Error == nil || m.Error.Code != "storage_error" || cutCount(t, st) != 1 {
		t.Fatalf("unrecordable request: reply=%+v cuts=%d; want storage_error and 1 cut", m, cutCount(t, st))
	}
}

// Two guests on one studio would mint the same job ids and race the ledger.
func TestASecondGuestCannotOpenTheSameStudio(t *testing.T) {
	root := t.TempDir()
	st, _ := openStudio(t, root)
	if _, err := store.Open(root); err == nil {
		t.Fatal("a second Open of an open studio succeeded")
	}
	st.Close()
	st2, err := store.Open(root)
	if err != nil {
		t.Fatalf("Open after Close: %v", err)
	}
	if st2.Boot() != st.Boot()+1 {
		t.Fatalf("boots %d then %d; want consecutive", st.Boot(), st2.Boot())
	}
	st2.Close()
}

// Mira's check at eef32a82: the cut's rename lands, the directory sync after it fails.
// The reply must say uncertain, and so must every retry.
func TestMiraPostRenameSyncFailureMustReportUncertain(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores the permission boundary")
	}
	root := t.TempDir()
	st, _ := openStudio(t, root)
	p, _ := json.Marshal(map[string]string{"scene": sceneOf(t, st), "name": "Committed but not confirmed durable"})
	// Search and write let the temp file be created and renamed; without read, the
	// directory can't be opened for its sync.
	if err := os.Chmod(root, 0o300); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(root, 0o700) })
	h := miraDormantHub(st)
	m := miraCall(h, "1", "uncertain-cut-write", "cut.create", string(p))
	if n := cutCount(t, st); n != 2 {
		t.Fatalf("fixture did not reach the post-rename state: cuts=%d reply=%+v", n, m)
	}
	if m.Error == nil || m.Error.Code != "uncertain" {
		t.Fatalf("reply = %+v; want uncertain", m)
	}
	entry, err := st.LoadEntry("uncertain-cut-write")
	if err != nil {
		t.Fatal(err)
	}
	if entry.State != store.Pending {
		t.Fatalf("ledger state = %s; want pending, so a retry can't replay a possibly wrong reply", entry.State)
	}
	retry := miraCall(h, "2", "uncertain-cut-write", "cut.create", string(p))
	if retry.Error == nil || retry.Error.Code != "uncertain" || cutCount(t, st) != 2 {
		t.Fatalf("retry = %+v, cuts=%d; want uncertain and still 2 cuts", retry, cutCount(t, st))
	}
}

// A failure before the rename changes nothing: storage_error, final, and a retry
// replays it rather than trying again under the same id.
func TestAStorageFailureBeforeTheRenameChangesNothing(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	root := t.TempDir()
	st, c := openStudio(t, root)
	docDir := filepath.Join(root, "documents", c.Document)
	if err := os.Chmod(docDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(docDir, 0o755) })
	h := miraDormantHub(st)
	p := `{"document": "` + c.Document + `", "base": 0, "body": {"layers": ["x"]}}`
	for i, id := range []string{"1", "2"} {
		m := miraCall(h, id, "unwritable-doc", "document.put", p)
		if m.Error == nil || m.Error.Code != "storage_error" {
			t.Fatalf("attempt %d: reply = %+v; want storage_error", i+1, m)
		}
	}
	if d, err := st.GetDocument(c.Document, -1); err != nil || d.Revision != 0 {
		t.Fatalf("newest revision = %d (%v); want 0", d.Revision, err)
	}
	if entry, err := st.LoadEntry("unwritable-doc"); err != nil || entry.State != store.Complete {
		t.Fatalf("ledger = %+v (%v); want complete", entry, err)
	}
}

// A job record from this boot that never reached the queue reads as never started.
func TestAJobRecordedButNeverQueuedReadsNeverStarted(t *testing.T) {
	st, c := openStudio(t, t.TempDir())
	h := miraDormantHub(st)
	id := st.JobID(7)
	b, _ := json.Marshal(JobInfo{ID: id, State: "queued", Request: "r", Submission: Submission{Cut: c.ID}})
	if err := st.SaveJob(id, b); err != nil {
		t.Fatal(err)
	}
	info, err := h.job(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.State != "ended" || info.Outcome != EndedFailed || !strings.Contains(info.Reason, "never started") {
		t.Fatalf("job = %+v; want ended, failed, never started", info)
	}
}

// An ending the guest couldn't write is still reported truly for the rest of this boot.
func TestAnEndingThatCannotBeRecordedIsStillReported(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	root := t.TempDir()
	st, c := openStudio(t, root)
	h := miraDormantHub(st)
	m := miraCall(h, "1", "will-end", "generate", text(c, 0))
	if m.Error != nil {
		t.Fatal(m.Error)
	}
	id := jobOf(t, m)
	jobs := filepath.Join(root, "jobs")
	if err := os.Chmod(jobs, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(jobs, 0o755) })
	h.mu.Lock()
	j := h.queue[0]
	h.queue = h.queue[1:]
	h.mu.Unlock()
	h.finish(j, EndedSkipped, "", "")
	info, err := h.job(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.State != "ended" || info.Outcome != EndedSkipped {
		t.Fatalf("job = %+v; want the unrecorded ending, skipped", info)
	}
}
