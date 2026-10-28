// Package ws is the small part of RFC 6455 the guest needs: text messages, ping and
// pong, and close, on the server side, plus a client side for tests and tools. It uses
// only the standard library, so the guest carries no WebSocket dependency. It does not
// do extensions, compression or binary messages; images travel as base64 inside JSON
// text messages.
package ws

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// handshakeGUID is the fixed key suffix from RFC 6455 §1.3.
const handshakeGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA
)

// ErrClosed is returned by Read once the peer has closed the connection.
var ErrClosed = errors.New("ws: connection closed")

// Conn is one upgraded connection. Read must be called from one goroutine; Write is
// safe from many, so job progress and replies can be sent concurrently.
type Conn struct {
	c        net.Conn
	r        *bufio.Reader
	maxBytes int64
	client   bool // a client masks what it sends and expects unmasked frames back

	wmu    sync.Mutex
	closed bool
}

// Upgrade completes the handshake for one HTTP request. maxMessage bounds a single
// incoming message; a larger one closes the connection with status 1009.
func Upgrade(w http.ResponseWriter, r *http.Request, maxMessage int64) (*Conn, error) {
	if r.Method != http.MethodGet ||
		!headerHas(r.Header, "Connection", "upgrade") ||
		!headerHas(r.Header, "Upgrade", "websocket") ||
		r.Header.Get("Sec-WebSocket-Version") != "13" {
		http.Error(w, "websocket upgrade required", http.StatusBadRequest)
		return nil, errors.New("ws: not a websocket upgrade")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if decoded, err := base64.StdEncoding.DecodeString(key); err != nil || len(decoded) != 16 {
		http.Error(w, "bad Sec-WebSocket-Key", http.StatusBadRequest)
		return nil, errors.New("ws: bad Sec-WebSocket-Key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "upgrade not supported", http.StatusInternalServerError)
		return nil, errors.New("ws: response writer cannot hijack")
	}
	c, rw, err := hj.Hijack()
	if err != nil {
		return nil, fmt.Errorf("ws: hijack: %w", err)
	}
	sum := sha1.Sum([]byte(key + handshakeGUID))
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + base64.StdEncoding.EncodeToString(sum[:]) + "\r\n\r\n"
	if _, err := c.Write([]byte(resp)); err != nil {
		c.Close()
		return nil, fmt.Errorf("ws: write handshake: %w", err)
	}
	return &Conn{c: c, r: rw.Reader, maxBytes: maxMessage}, nil
}

func headerHas(h http.Header, name, token string) bool {
	for _, v := range h.Values(name) {
		for _, part := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

// Read returns the next text message, answering pings and assembling fragments on the
// way. It returns ErrClosed after a close frame, and an error for a binary message or
// any protocol violation, closing the connection with the matching status.
func (c *Conn) Read() ([]byte, error) {
	var msg []byte
	inMessage := false
	for {
		fin, op, payload, err := c.readFrame()
		if err != nil {
			return nil, err
		}
		switch op {
		case opPing:
			if err := c.writeFrame(opPong, payload); err != nil {
				return nil, err
			}
			continue
		case opPong:
			continue
		case opClose:
			c.closeWith(1000, "")
			return nil, ErrClosed
		case opBinary:
			c.closeWith(1003, "text messages only")
			return nil, errors.New("ws: binary message refused")
		case opText:
			if inMessage {
				c.closeWith(1002, "new message inside a fragmented one")
				return nil, errors.New("ws: protocol error")
			}
			inMessage = true
			msg = append(msg[:0], payload...)
		case opContinuation:
			if !inMessage {
				c.closeWith(1002, "continuation without a message")
				return nil, errors.New("ws: protocol error")
			}
			msg = append(msg, payload...)
		default:
			c.closeWith(1002, "unknown opcode")
			return nil, fmt.Errorf("ws: unknown opcode %d", op)
		}
		if int64(len(msg)) > c.maxBytes {
			c.closeWith(1009, "message too big")
			return nil, errors.New("ws: message too big")
		}
		if fin {
			return msg, nil
		}
	}
}

func (c *Conn) readFrame() (fin bool, op byte, payload []byte, err error) {
	var head [2]byte
	if _, err = io.ReadFull(c.r, head[:]); err != nil {
		return false, 0, nil, closedOr(err)
	}
	fin = head[0]&0x80 != 0
	if head[0]&0x70 != 0 {
		c.closeWith(1002, "reserved bits set")
		return false, 0, nil, errors.New("ws: reserved bits set")
	}
	op = head[0] & 0x0F
	masked := head[1]&0x80 != 0
	if masked == c.client {
		// RFC 6455 §5.1: clients mask every frame and servers mask none.
		c.closeWith(1002, "wrong frame masking")
		return false, 0, nil, errors.New("ws: wrong frame masking")
	}
	n := uint64(head[1] & 0x7F)
	switch n {
	case 126:
		var ext [2]byte
		if _, err = io.ReadFull(c.r, ext[:]); err != nil {
			return false, 0, nil, closedOr(err)
		}
		n = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err = io.ReadFull(c.r, ext[:]); err != nil {
			return false, 0, nil, closedOr(err)
		}
		n = binary.BigEndian.Uint64(ext[:])
	}
	if op >= opClose && (n > 125 || !fin) {
		c.closeWith(1002, "bad control frame")
		return false, 0, nil, errors.New("ws: bad control frame")
	}
	if n > uint64(c.maxBytes) {
		c.closeWith(1009, "message too big")
		return false, 0, nil, errors.New("ws: message too big")
	}
	var mask [4]byte
	if masked {
		if _, err = io.ReadFull(c.r, mask[:]); err != nil {
			return false, 0, nil, closedOr(err)
		}
	}
	payload = make([]byte, n)
	if _, err = io.ReadFull(c.r, payload); err != nil {
		return false, 0, nil, closedOr(err)
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return fin, op, payload, nil
}

func closedOr(err error) error {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, net.ErrClosed) {
		return ErrClosed
	}
	return err
}

// SetReadDeadline bounds the next Read, so a caller waiting for a message that never
// comes gets an error instead of blocking forever.
func (c *Conn) SetReadDeadline(t time.Time) error { return c.c.SetReadDeadline(t) }

// Write sends one text message. It is safe to call from several goroutines.
func (c *Conn) Write(msg []byte) error { return c.writeFrame(opText, msg) }

func (c *Conn) writeFrame(op byte, payload []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.closed {
		return ErrClosed
	}
	var maskBit byte
	if c.client {
		maskBit = 0x80
	}
	head := make([]byte, 0, 14)
	head = append(head, 0x80|op)
	switch n := len(payload); {
	case n <= 125:
		head = append(head, maskBit|byte(n))
	case n <= 0xFFFF:
		head = append(head, maskBit|126, byte(n>>8), byte(n))
	default:
		head = append(head, maskBit|127)
		head = binary.BigEndian.AppendUint64(head, uint64(n))
	}
	if c.client {
		var mask [4]byte
		if _, err := rand.Read(mask[:]); err != nil {
			return fmt.Errorf("ws: mask: %w", err)
		}
		head = append(head, mask[:]...)
		masked := make([]byte, len(payload))
		for i, b := range payload {
			masked[i] = b ^ mask[i%4]
		}
		payload = masked
	}
	_ = c.c.SetWriteDeadline(time.Now().Add(30 * time.Second))
	if _, err := c.c.Write(append(head, payload...)); err != nil {
		return closedOr(err)
	}
	return nil
}

// Close sends a normal close frame and releases the connection.
func (c *Conn) Close() error {
	c.closeWith(1000, "")
	return nil
}

func (c *Conn) closeWith(code uint16, reason string) {
	payload := binary.BigEndian.AppendUint16(nil, code)
	payload = append(payload, reason...)
	_ = c.writeFrame(opClose, payload)
	c.wmu.Lock()
	if !c.closed {
		c.closed = true
		c.c.Close()
	}
	c.wmu.Unlock()
}

// Dial opens a client connection to a ws:// URL. The guest itself never dials; this
// is for tests and command-line tools that speak the same protocol as the page.
func Dial(url string, maxMessage int64) (*Conn, error) {
	host, path, ok := strings.Cut(strings.TrimPrefix(url, "ws://"), "/")
	if !ok || !strings.HasPrefix(url, "ws://") {
		return nil, fmt.Errorf("ws: dial needs a ws://host/path URL, got %q", url)
	}
	c, err := net.DialTimeout("tcp", host, 10*time.Second)
	if err != nil {
		return nil, fmt.Errorf("ws: dial: %w", err)
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		c.Close()
		return nil, fmt.Errorf("ws: key: %w", err)
	}
	key := base64.StdEncoding.EncodeToString(nonce[:])
	req := "GET /" + path + " HTTP/1.1\r\nHost: " + host +
		"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13" +
		"\r\nSec-WebSocket-Key: " + key + "\r\n\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		c.Close()
		return nil, fmt.Errorf("ws: write handshake: %w", err)
	}
	r := bufio.NewReader(c)
	resp, err := http.ReadResponse(r, nil)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("ws: read handshake: %w", err)
	}
	sum := sha1.Sum([]byte(key + handshakeGUID))
	if resp.StatusCode != http.StatusSwitchingProtocols ||
		resp.Header.Get("Sec-WebSocket-Accept") != base64.StdEncoding.EncodeToString(sum[:]) {
		c.Close()
		return nil, fmt.Errorf("ws: handshake refused: %s", resp.Status)
	}
	return &Conn{c: c, r: r, maxBytes: maxMessage, client: true}, nil
}
