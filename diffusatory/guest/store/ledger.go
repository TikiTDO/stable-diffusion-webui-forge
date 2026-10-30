package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
)

// Ledger states. An entry is written pending before its call takes effect and complete
// with the reply afterwards, so a crash in between leaves pending: the effect may or
// may not have happened, and the guest says so rather than doing it again.
const (
	Pending  = "pending"
	Complete = "complete"
)

// Entry is the ledger record for one request id: the call it named and, once known,
// the reply it got. A request id names one attempt at one effect, forever.
type Entry struct {
	Request    string          `json:"request"`
	Method     string          `json:"method"`
	ParamsHash string          `json:"paramsHash"`
	State      string          `json:"state"`
	Reply      json.RawMessage `json:"reply,omitempty"`
}

// requestFile names the ledger entry for one request id. The id is hashed so any client
// string is a safe file name.
func (s *Store) requestFile(request string) string {
	sum := sha256.Sum256([]byte(request))
	return filepath.Join(s.root, "requests", hex.EncodeToString(sum[:])+".json")
}

// LoadEntry returns the ledger entry for a request id. ErrNotFound means the guest has
// never recorded that id. Any other error means the guest can't tell, which is not the
// same thing: the caller must not treat it as a new request.
func (s *Store) LoadEntry(request string) (Entry, error) {
	var e Entry
	b, err := os.ReadFile(s.requestFile(request))
	if errors.Is(err, os.ErrNotExist) {
		return e, ErrNotFound
	}
	if err != nil {
		return e, err
	}
	if err := json.Unmarshal(b, &e); err != nil {
		return e, fmt.Errorf("ledger entry for request %q is unreadable: %w", request, err)
	}
	if e.Request != request || (e.State != Pending && e.State != Complete) {
		return e, fmt.Errorf("ledger entry for request %q is not a valid entry for it", request)
	}
	return e, nil
}

// SaveEntry writes a ledger entry durably. When it returns an error the entry on disk
// may be the old one or the new one.
func (s *Store) SaveEntry(e Entry) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return writeAtomic(s.requestFile(e.Request), b)
}

// Job ids are "j<boot>.<n>": the boot that minted them and a count within it.
var jobPattern = regexp.MustCompile(`^j([0-9]+)\.([0-9]+)$`)

// JobID mints the n-th job id of this boot.
func (s *Store) JobID(n int) string { return "j" + strconv.Itoa(s.boot) + "." + strconv.Itoa(n) }

// JobBoot returns the boot a job id was minted in, or false if it isn't a job id.
func JobBoot(id string) (int, bool) {
	m := jobPattern.FindStringSubmatch(id)
	if m == nil {
		return 0, false
	}
	b, err := strconv.Atoi(m[1])
	return b, err == nil
}

func (s *Store) jobFile(id string) string { return filepath.Join(s.root, "jobs", id+".json") }

// SaveJob writes one job's record durably. The record's shape belongs to the caller.
func (s *Store) SaveJob(id string, record json.RawMessage) error {
	if _, ok := JobBoot(id); !ok {
		return fmt.Errorf("%q is not a job id", id)
	}
	return writeAtomic(s.jobFile(id), record)
}

// LoadJob returns one job's record, or ErrNotFound.
func (s *Store) LoadJob(id string) (json.RawMessage, error) {
	if _, ok := JobBoot(id); !ok {
		return nil, ErrNotFound
	}
	b, err := os.ReadFile(s.jobFile(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

// JobIDs lists every recorded job id, newest first: by boot, then by count.
func (s *Store) JobIDs() ([]string, error) {
	names, err := os.ReadDir(filepath.Join(s.root, "jobs"))
	if err != nil {
		return nil, err
	}
	type key struct {
		id      string
		boot, n int
	}
	var keys []key
	for _, f := range names {
		id := f.Name()
		if filepath.Ext(id) != ".json" {
			continue
		}
		id = id[:len(id)-len(".json")]
		m := jobPattern.FindStringSubmatch(id)
		if m == nil {
			continue
		}
		b, _ := strconv.Atoi(m[1])
		n, _ := strconv.Atoi(m[2])
		keys = append(keys, key{id, b, n})
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].boot != keys[j].boot {
			return keys[i].boot > keys[j].boot
		}
		return keys[i].n > keys[j].n
	})
	ids := make([]string, len(keys))
	for i, k := range keys {
		ids[i] = k.id
	}
	return ids, nil
}
