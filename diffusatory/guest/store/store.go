// Package store keeps the studio on disk: projects, scenes and cuts with stable ids,
// versioned layer documents, and takes (finished images and clips) with the manifest
// of exactly what produced them.
//
// Nothing is overwritten. A document save writes a new revision file, and a take is a
// new asset; choosing a take only records which one the cut uses. That's what lets a
// late result land without replacing a newer choice, and an old take be found again
// after a retake.
package store

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

// ErrStale is returned when a document save was based on a revision that is no longer
// the newest: someone else saved in between. The caller reloads and decides.
var ErrStale = errors.New("document changed since that revision")

// ErrNotFound is returned for an id the studio doesn't have.
var ErrNotFound = errors.New("not found")

var idPattern = regexp.MustCompile(`^[a-z][0-9a-f]{12}$`)

// Studio is the tree of everything in the guest's output root.
type Studio struct {
	Projects []Project `json:"projects"`
}

type Project struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Scenes []Scene `json:"scenes"`
}

type Scene struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Cuts []Cut  `json:"cuts"`
}

// Cut is one shot. Its choices are explicit and separate from its newest takes.
type Cut struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Document     string   `json:"document"`
	ChosenImages []string `json:"chosenImages"`
	ChosenClip   string   `json:"chosenClip,omitempty"`
}

// Document is one revision of a cut's layer document. Body is the client's layer
// structure, stored as given.
type Document struct {
	ID       string          `json:"id"`
	Revision int             `json:"revision"`
	Body     json.RawMessage `json:"body"`
}

// Take is one finished result. Manifest records the exact inputs the job used.
type Take struct {
	ID       string          `json:"id"`
	Cut      string          `json:"cut"`
	Kind     string          `json:"kind"` // "image" or "clip"
	Job      string          `json:"job"`
	Created  time.Time       `json:"created"`
	Manifest json.RawMessage `json:"manifest"`
	Receipt  json.RawMessage `json:"receipt"`
}

// Store is the studio rooted at one directory. All methods are safe for concurrent use.
type Store struct {
	root string
	mu   sync.Mutex
}

// Open opens or creates a studio at root. A new studio gets a default project, scene
// and cut, so every generation has somewhere to land from the first call.
func Open(root string) (*Store, error) {
	s := &Store{root: root}
	if err := os.MkdirAll(filepath.Join(root, "documents"), 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(root, "takes"), 0o755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(s.studioPath()); errors.Is(err, os.ErrNotExist) {
		doc := newID("d")
		if err := s.writeRevision(doc, 0, json.RawMessage(`{"layers":[]}`)); err != nil {
			return nil, err
		}
		studio := Studio{Projects: []Project{{ID: newID("p"), Name: "Untitled", Scenes: []Scene{{
			ID: newID("s"), Name: "Scene 1",
			Cuts: []Cut{{ID: newID("c"), Name: "Cut 1", Document: doc, ChosenImages: []string{}}},
		}}}}}
		if err := s.writeStudio(studio); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	return s, nil
}

func newID(prefix string) string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand does not fail on supported platforms
	}
	return prefix + hex.EncodeToString(b[:])
}

func (s *Store) studioPath() string { return filepath.Join(s.root, "studio.json") }

// Studio returns the whole tree.
func (s *Store) Studio() (Studio, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readStudio()
}

func (s *Store) readStudio() (Studio, error) {
	var st Studio
	b, err := os.ReadFile(s.studioPath())
	if err != nil {
		return st, err
	}
	return st, json.Unmarshal(b, &st)
}

func (s *Store) writeStudio(st Studio) error {
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(s.studioPath(), b)
}

// writeAtomic replaces path in one rename, so a crash mid-write never leaves a torn
// file behind.
func writeAtomic(path string, b []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// FindCut returns a cut by id.
func (s *Store) FindCut(id string) (Cut, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.readStudio()
	if err != nil {
		return Cut{}, err
	}
	if c := findCut(&st, id); c != nil {
		return *c, nil
	}
	return Cut{}, fmt.Errorf("cut %q: %w", id, ErrNotFound)
}

func findCut(st *Studio, id string) *Cut {
	for pi := range st.Projects {
		for si := range st.Projects[pi].Scenes {
			for ci := range st.Projects[pi].Scenes[si].Cuts {
				if c := &st.Projects[pi].Scenes[si].Cuts[ci]; c.ID == id {
					return c
				}
			}
		}
	}
	return nil
}

func (s *Store) docDir(id string) string { return filepath.Join(s.root, "documents", id) }

func (s *Store) writeRevision(id string, rev int, body json.RawMessage) error {
	if err := os.MkdirAll(s.docDir(id), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(Document{ID: id, Revision: rev, Body: body})
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.docDir(id), fmt.Sprintf("%08d.json", rev)), b)
}

func (s *Store) newestRevision(id string) (int, error) {
	if !idPattern.MatchString(id) {
		return 0, fmt.Errorf("document %q: %w", id, ErrNotFound)
	}
	names, err := filepath.Glob(filepath.Join(s.docDir(id), "*.json"))
	if err != nil || len(names) == 0 {
		return 0, fmt.Errorf("document %q: %w", id, ErrNotFound)
	}
	sort.Strings(names)
	var rev int
	if _, err := fmt.Sscanf(filepath.Base(names[len(names)-1]), "%08d.json", &rev); err != nil {
		return 0, err
	}
	return rev, nil
}

// GetDocument returns one revision of a document; rev < 0 means the newest.
func (s *Store) GetDocument(id string, rev int) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if rev < 0 {
		newest, err := s.newestRevision(id)
		if err != nil {
			return Document{}, err
		}
		rev = newest
	} else if !idPattern.MatchString(id) {
		return Document{}, fmt.Errorf("document %q: %w", id, ErrNotFound)
	}
	b, err := os.ReadFile(filepath.Join(s.docDir(id), fmt.Sprintf("%08d.json", rev)))
	if errors.Is(err, os.ErrNotExist) {
		return Document{}, fmt.Errorf("document %q revision %d: %w", id, rev, ErrNotFound)
	}
	if err != nil {
		return Document{}, err
	}
	var d Document
	return d, json.Unmarshal(b, &d)
}

// PutDocument saves a new revision on top of base. If base is not the newest revision,
// nothing is written and ErrStale is returned.
func (s *Store) PutDocument(id string, base int, body json.RawMessage) (int, error) {
	if !json.Valid(body) {
		return 0, errors.New("document body is not valid JSON")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	newest, err := s.newestRevision(id)
	if err != nil {
		return 0, err
	}
	if base != newest {
		return newest, fmt.Errorf("based on revision %d, newest is %d: %w", base, newest, ErrStale)
	}
	return newest + 1, s.writeRevision(id, newest+1, body)
}

// AddTake stores a finished result in the cut it was submitted from. It never changes
// what the cut has chosen.
func (s *Store) AddTake(cut, kind, job string, asset []byte, manifest, receipt json.RawMessage) (Take, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.readStudio()
	if err != nil {
		return Take{}, err
	}
	if findCut(&st, cut) == nil {
		return Take{}, fmt.Errorf("cut %q: %w", cut, ErrNotFound)
	}
	t := Take{ID: newID("t"), Cut: cut, Kind: kind, Job: job, Created: time.Now().UTC(), Manifest: manifest, Receipt: receipt}
	ext := map[string]string{"image": ".png", "clip": ".mp4"}[kind]
	if ext == "" {
		return Take{}, fmt.Errorf("unknown take kind %q", kind)
	}
	if err := writeAtomic(filepath.Join(s.root, "takes", t.ID+ext), asset); err != nil {
		return Take{}, err
	}
	b, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return Take{}, err
	}
	return t, writeAtomic(filepath.Join(s.root, "takes", t.ID+".json"), b)
}

// GetTake returns a take's record.
func (s *Store) GetTake(id string) (Take, error) {
	var t Take
	if !idPattern.MatchString(id) {
		return t, fmt.Errorf("take %q: %w", id, ErrNotFound)
	}
	b, err := os.ReadFile(filepath.Join(s.root, "takes", id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return t, fmt.Errorf("take %q: %w", id, ErrNotFound)
	}
	if err != nil {
		return t, err
	}
	return t, json.Unmarshal(b, &t)
}

// Choose makes a take the cut's chosen clip, or adds it to the cut's chosen images.
// A take from another cut is refused.
func (s *Store) Choose(cut, take string) error {
	t, err := s.GetTake(take)
	if err != nil {
		return err
	}
	if t.Cut != cut {
		return fmt.Errorf("take %q belongs to cut %q, not %q", take, t.Cut, cut)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.readStudio()
	if err != nil {
		return err
	}
	c := findCut(&st, cut)
	if c == nil {
		return fmt.Errorf("cut %q: %w", cut, ErrNotFound)
	}
	if t.Kind == "clip" {
		c.ChosenClip = take
	} else {
		for _, id := range c.ChosenImages {
			if id == take {
				return nil
			}
		}
		c.ChosenImages = append(c.ChosenImages, take)
	}
	return s.writeStudio(st)
}

// AddCut appends a new cut, with its own empty document, to a scene.
func (s *Store) AddCut(scene, name string) (Cut, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.readStudio()
	if err != nil {
		return Cut{}, err
	}
	for pi := range st.Projects {
		for si := range st.Projects[pi].Scenes {
			sc := &st.Projects[pi].Scenes[si]
			if sc.ID != scene {
				continue
			}
			doc := newID("d")
			if err := s.writeRevision(doc, 0, json.RawMessage(`{"layers":[]}`)); err != nil {
				return Cut{}, err
			}
			c := Cut{ID: newID("c"), Name: name, Document: doc, ChosenImages: []string{}}
			sc.Cuts = append(sc.Cuts, c)
			return c, s.writeStudio(st)
		}
	}
	return Cut{}, fmt.Errorf("scene %q: %w", scene, ErrNotFound)
}

// requestFile names the stored reply for one request id. The id is hashed so any client
// string is a safe file name.
func (s *Store) requestFile(request string) string {
	sum := sha256.Sum256([]byte(request))
	return filepath.Join(s.root, "requests", hex.EncodeToString(sum[:])+".json")
}

// SaveReply records the reply to a mutating request, so a retry of the same request id
// gets that reply back however long afterwards, instead of doing the work again.
func (s *Store) SaveReply(request string, reply json.RawMessage) error {
	if err := os.MkdirAll(filepath.Join(s.root, "requests"), 0o755); err != nil {
		return err
	}
	return writeAtomic(s.requestFile(request), reply)
}

// LoadReply returns the recorded reply for a request id, or ErrNotFound.
func (s *Store) LoadReply(request string) (json.RawMessage, error) {
	b, err := os.ReadFile(s.requestFile(request))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}
