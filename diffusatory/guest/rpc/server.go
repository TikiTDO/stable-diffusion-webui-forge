package rpc

import (
	"encoding/json"
	"log"
	"net/http"
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
