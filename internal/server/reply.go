package server

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// pingEvery is how often a quiet reply stream gets a comment line, so a
// proxy that cuts idle connections keeps it open.
var pingEvery = 15 * time.Second

// reply is a chat's reply while Pi writes it. It runs on its own, apart from
// the request that started it, so leaving the page does not stop it. Every
// event is kept until the reply ends, so a page that opens the chat later
// replays what it missed and then follows along.
type reply struct {
	stop context.CancelFunc

	mu      sync.Mutex
	events  []sseEvent
	changed chan struct{} // closed and replaced on each new event
	ended   bool
}

type sseEvent struct {
	name string
	data any
}

func newReply(stop context.CancelFunc) *reply {
	return &reply{stop: stop, changed: make(chan struct{})}
}

func (r *reply) send(name string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, sseEvent{name, data})
	close(r.changed)
	r.changed = make(chan struct{})
}

func (r *reply) end() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ended = true
	close(r.changed)
}

// follow streams every event of the reply to w, from the first, until the
// reply ends or the page goes away. A quiet stream is pinged every pingEvery.
func (r *reply) follow(w http.ResponseWriter, req *http.Request) {
	out := newSSE(w)
	out.ping() // sends the headers now, before the first event
	tick := time.NewTicker(pingEvery)
	defer tick.Stop()
	for next := 0; ; {
		r.mu.Lock()
		evs, changed, ended := r.events[next:], r.changed, r.ended
		r.mu.Unlock()
		for _, e := range evs {
			out.send(e.name, e.data)
		}
		next += len(evs)
		if ended {
			return
		}
		select {
		case <-changed:
		case <-tick.C:
			out.ping()
		case <-req.Context().Done():
			return
		}
	}
}
