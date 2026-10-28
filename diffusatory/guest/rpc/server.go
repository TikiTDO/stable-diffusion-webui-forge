package rpc

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"regexp"
	"sync"

	"github.com/TikiTDO/stable-diffusion-webui-forge/diffusatory/guest/ws"
)

// MaxCallBytes bounds one incoming call. An img2img call carries a source image and a
// mask as base64, so it allows for two large PNGs.
const MaxCallBytes = 64 << 20

// sendQueue is how many messages may wait for one slow tab. A tab that falls this far
// behind is disconnected rather than allowed to hold up every other tab.
const sendQueue = 256

// conn is one tab: a hub sink with its own writer goroutine. A broadcast can still be
// on its way to a tab that has just closed, so Send checks done under the lock rather
// than sending on a closed channel.
type conn struct {
	ws   *ws.Conn
	out  chan Message
	mu   sync.Mutex
	done bool
}

func (c *conn) finish() {
	c.mu.Lock()
	c.done = true
	close(c.out)
	c.mu.Unlock()
}

func (c *conn) Send(m Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return
	}
	select {
	case c.out <- m:
	default:
		log.Printf("diffusatory: a tab fell %d messages behind; disconnecting it", sendQueue)
		c.ws.Close()
	}
}

func (c *conn) writer() {
	for m := range c.out {
		b, err := json.Marshal(m)
		if err != nil {
			log.Printf("diffusatory: encode message: %v", err)
			continue
		}
		if err := c.ws.Write(b); err != nil {
			return
		}
	}
}

// ServeHTTP upgrades one request to a socket and serves calls on it until it closes.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sock, err := ws.Upgrade(w, r, MaxCallBytes)
	if err != nil {
		return
	}
	c := &conn{ws: sock, out: make(chan Message, sendQueue)}
	go c.writer()
	h.Attach(c)
	defer func() {
		h.Detach(c)
		c.finish()
		sock.Close()
	}()
	for {
		raw, err := sock.Read()
		if err != nil {
			return
		}
		c.Send(h.Handle(raw))
	}
}

var takeFile = regexp.MustCompile(`^/takes/(t[0-9a-f]{12})\.(png|mp4)$`)

// TakeFiles serves finished takes by id, so results travel as a take id in the ended
// event and the page fetches the file itself instead of every tab receiving the bytes.
func TakeFiles(studio string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m := takeFile.FindStringSubmatch(r.URL.Path)
		if m == nil || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(studio, "takes", m[1]+"."+m[2]))
	})
}
