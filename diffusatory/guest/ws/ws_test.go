package ws

import (
	"bufio"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// echo upgrades and echoes text messages until the client goes.
func echo(t *testing.T, maxMessage int64) (string, chan error) {
	t.Helper()
	errs := make(chan error, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := Upgrade(w, r, maxMessage)
		if err != nil {
			errs <- err
			return
		}
		for {
			msg, err := c.Read()
			if err != nil {
				errs <- err
				return
			}
			if err := c.Write(msg); err != nil {
				errs <- err
				return
			}
		}
	}))
	t.Cleanup(srv.Close)
	return strings.TrimPrefix(srv.URL, "http://"), errs
}

func TestEchoesSmallMediumAndLargeMessages(t *testing.T) {
	host, _ := echo(t, 1<<20)
	c, err := Dial("ws://"+host+"/", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	// One size for each of the three length encodings: 7-bit, 16-bit and 64-bit.
	for _, n := range []int{5, 300, 70000} {
		msg := strings.Repeat("x", n)
		if err := c.Write([]byte(msg)); err != nil {
			t.Fatal(err)
		}
		got, err := c.Read()
		if err != nil || string(got) != msg {
			t.Fatalf("size %d: got %d bytes, err %v", n, len(got), err)
		}
	}
}

func TestATooBigMessageClosesTheConnection(t *testing.T) {
	host, errs := echo(t, 100)
	c, err := Dial("ws://"+host+"/", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := c.Write([]byte(strings.Repeat("x", 101))); err != nil {
		t.Fatal(err)
	}
	if err := <-errs; err == nil || !strings.Contains(err.Error(), "too big") {
		t.Fatalf("server error = %v, want too big", err)
	}
	if _, err := c.Read(); !errors.Is(err, ErrClosed) {
		t.Fatalf("client read after close = %v", err)
	}
}

// rawClient handshakes by hand so a test can send frames Dial would never produce.
func rawClient(t *testing.T, host string) (net.Conn, *bufio.Reader) {
	t.Helper()
	c, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef"))
	_, _ = c.Write([]byte("GET / HTTP/1.1\r\nHost: " + host + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: " + key + "\r\n\r\n"))
	r := bufio.NewReader(c)
	resp, err := http.ReadResponse(r, nil)
	if err != nil || resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("handshake: %v %v", resp, err)
	}
	return c, r
}

func TestAnUnmaskedClientFrameIsRefused(t *testing.T) {
	host, errs := echo(t, 1<<20)
	c, _ := rawClient(t, host)
	_, _ = c.Write([]byte{0x81, 0x02, 'h', 'i'}) // FIN text, length 2, no mask bit
	if err := <-errs; err == nil || !strings.Contains(err.Error(), "masking") {
		t.Fatalf("server error = %v, want a masking error", err)
	}
}

func TestPingIsAnsweredWithPong(t *testing.T) {
	host, _ := echo(t, 1<<20)
	c, r := rawClient(t, host)
	_, _ = c.Write([]byte{0x89, 0x82, 0, 0, 0, 0, 'o', 'k'}) // FIN ping, masked with a zero key
	head := make([]byte, 4)
	if _, err := r.Read(head); err != nil {
		t.Fatal(err)
	}
	if head[0] != 0x8A || head[1] != 2 || string(head[2:]) != "ok" {
		t.Fatalf("pong frame = % x", head)
	}
}

func TestANonUpgradeRequestIsRefused(t *testing.T) {
	host, _ := echo(t, 1<<20)
	resp, err := http.Get("http://" + host + "/")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}
