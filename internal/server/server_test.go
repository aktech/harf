package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os/user"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/plugins"
	"github.com/aktech/harf/internal/store"
)

// fakeAgent stands in for Pi: reply decides each reply's text, which is
// streamed one word per delta.
type fakeAgent struct {
	mu                   sync.Mutex
	specs                []pi.Spec
	reply                func(pi.Spec) pi.Result
	titles               []string // prompts sent to Complete
	title                string
	titleErr             error
	block                chan struct{} // when set, replies wait on it
	modelAsks, imageAsks int           // times Pi was asked for its models
	started              chan struct{}
	images               []pi.Model    // image models Pi has
	imagesSlow           chan struct{} // when set, listing image models waits on it
	modelsSlow           chan struct{} // when set, listing chat models waits on it
	listing              int           // model lists being asked for right now
	checked              []store.MCPServer
	check                pi.MCPCheck
}

func (f *fakeAgent) CheckMCP(_ context.Context, m store.MCPServer) (pi.MCPCheck, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.checked = append(f.checked, m)
	return f.check, nil
}

func (f *fakeAgent) ImageModels(context.Context) ([]pi.Model, error) {
	f.mu.Lock()
	f.imageAsks++
	f.listing++
	slow := f.imagesSlow
	f.mu.Unlock()
	defer f.listed()
	if slow != nil {
		<-slow
	}
	return f.images, nil
}

func (f *fakeAgent) Models(context.Context) ([]pi.Model, error) {
	f.mu.Lock()
	f.modelAsks++
	f.listing++
	slow := f.modelsSlow
	f.mu.Unlock()
	defer f.listed()
	if slow != nil {
		<-slow
	}
	return []pi.Model{{ID: "fake/small", Name: "Small", Provider: "fake"}, {ID: "fake/big", Name: "Big", Provider: "fake", Reasoning: true, Images: true}}, nil
}

func (f *fakeAgent) listed() {
	f.mu.Lock()
	f.listing--
	f.mu.Unlock()
}

func (f *fakeAgent) busyListing() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.listing > 0
}

func (f *fakeAgent) Run(ctx context.Context, s pi.Spec, emit func(pi.Event)) pi.Result {
	f.mu.Lock()
	f.specs = append(f.specs, s)
	f.mu.Unlock()
	if f.block != nil {
		f.started <- struct{}{}
		select {
		case <-f.block:
		case <-ctx.Done():
			return pi.Result{Session: s.Session, Error: "Stopped"}
		}
	}
	res := f.reply(s)
	if res.Session == "" {
		res.Session = s.Session
	}
	if res.Text != "" && res.Parts == nil {
		emit(pi.Event{Index: 0, Part: &store.Part{Type: "text"}})
		for _, w := range strings.SplitAfter(res.Text, " ") {
			emit(pi.Event{Index: 0, Delta: w})
		}
		res.Parts = []store.Part{{Type: "text", Text: res.Text}}
	}
	return res
}

func (f *fakeAgent) Complete(_ context.Context, model, system, prompt string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.titles = append(f.titles, prompt)
	return f.title, f.titleErr
}

func (f *fakeAgent) lastSpec() pi.Spec {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.specs[len(f.specs)-1]
}

type harness struct {
	t         *testing.T
	srv       *httptest.Server
	handler   http.Handler // what srv serves, to call without a connection
	agent     *fakeAgent
	workspace string // the folder Pi works in
}

func newHarness(t *testing.T, reply func(pi.Spec) pi.Result) *harness {
	return newHarnessDefault(t, reply, "fake/small")
}

// newHarnessWithImages starts with Pi already having these image models,
// as real Pi has them before Harf asks.
func newHarnessWithImages(t *testing.T, reply func(pi.Spec) pi.Result, images []pi.Model) *harness {
	return newHarnessFrom(t, &fakeAgent{reply: reply, images: images}, "fake/small")
}

func newHarnessDefault(t *testing.T, reply func(pi.Spec) pi.Result, defaultModel string) *harness {
	return newHarnessFrom(t, &fakeAgent{reply: reply}, defaultModel)
}

func newHarnessFrom(t *testing.T, a *fakeAgent, defaultModel string) *harness {
	return newHarnessIn(t, t.TempDir(), a, defaultModel)
}

// newHarnessIn starts a server on the data folder dir, as a restart does.
func newHarnessIn(t *testing.T, dir string, a *fakeAgent, defaultModel string) *harness {
	ui := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>t</title>")}}
	return serve(t, dir, t.TempDir(), ui, a, defaultModel)
}

// serve starts a server on the data folder dir and the workspace ws, with
// the UI files ui. Every test server goes through here, so none of them
// outlives its folders.
func serve(t *testing.T, dir, ws string, ui fs.FS, a *fakeAgent, defaultModel string) *harness {
	t.Helper()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	handler := New(st, a, defaultModel, ws, ui)
	srv := httptest.NewServer(handler)
	h := &harness{t: t, srv: srv, handler: handler, agent: a, workspace: ws}
	t.Cleanup(srv.Close)
	// The server lists and saves models in the background; let that end
	// before the data folder is removed. A config request waits for any
	// save in progress.
	t.Cleanup(func() {
		for range 2000 {
			if !a.busyListing() {
				break
			}
			time.Sleep(time.Millisecond)
		}
		if resp, err := http.Get(srv.URL + "/api/config"); err == nil {
			resp.Body.Close()
		}
	})
	return h
}

func (h *harness) do(method, path string, body any, out any) *http.Response {
	h.t.Helper()
	var r *strings.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = strings.NewReader(string(b))
	} else {
		r = strings.NewReader("")
	}
	req, _ := http.NewRequest(method, h.srv.URL+path, r)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			h.t.Fatalf("%s %s: decode: %v", method, path, err)
		}
	}
	return resp
}

type event struct {
	Name string
	Data map[string]any
}

// send posts to the messages endpoint and returns the events it streamed.
func (h *harness) send(chatID string, body any) []event {
	h.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", h.srv.URL+"/api/chats/"+chatID+"/messages", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		h.t.Fatalf("send: status %d", resp.StatusCode)
	}
	return readEvents(resp)
}

// follow opens the chat's live reply and returns the events it streamed.
func (h *harness) follow(chatID string) []event {
	h.t.Helper()
	resp, err := http.Get(h.srv.URL + "/api/chats/" + chatID + "/stream")
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	return readEvents(resp)
}

func readEvents(resp *http.Response) []event {
	var evs []event
	var name string
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		line := sc.Text()
		if v, ok := strings.CutPrefix(line, "event: "); ok {
			name = v
		} else if v, ok := strings.CutPrefix(line, "data: "); ok {
			var d map[string]any
			json.Unmarshal([]byte(v), &d)
			evs = append(evs, event{name, d})
		}
	}
	return evs
}

func (h *harness) newChat(body any) store.Chat {
	var c store.Chat
	if resp := h.do("POST", "/api/chats", body, &c); resp.StatusCode != 201 {
		h.t.Fatalf("create chat: status %d", resp.StatusCode)
	}
	return c
}

func (h *harness) chat(id string) store.Chat {
	var c store.Chat
	h.do("GET", "/api/chats/"+id, nil, &c)
	return c
}

// waitReply waits for the chat's reply to be saved and returns it.
func (h *harness) waitReply(id string) store.Message {
	h.t.Helper()
	for range 200 {
		ms := h.chat(id).Messages
		if n := len(ms); n > 0 && ms[n-1].Role == "assistant" {
			return ms[n-1]
		}
		time.Sleep(10 * time.Millisecond)
	}
	h.t.Fatal("no reply saved")
	return store.Message{}
}

func deltas(evs []event) string {
	var b strings.Builder
	for _, e := range evs {
		if e.Name == "part" {
			d, _ := e.Data["delta"].(string)
			b.WriteString(d)
		}
	}
	return b.String()
}

func echo(s pi.Spec) pi.Result {
	return pi.Result{Text: "you said " + s.Prompt, Model: s.Model}
}

func TestSendStreamsReplyAndSavesBothMessages(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})

	evs := h.send(c.ID, map[string]any{"content": "hello there"})

	if got := deltas(evs); got != "you said hello there" {
		t.Fatalf("streamed %q", got)
	}
	got := h.chat(c.ID)
	if len(got.Messages) != 2 || got.Messages[0].Content != "hello there" ||
		got.Messages[1].Content != "you said hello there" || got.Messages[1].Model != "fake/small" ||
		len(got.Messages[1].Parts) != 1 {
		t.Fatalf("saved messages %+v", got.Messages)
	}
	if s := h.agent.lastSpec(); s.Session != c.ID || s.ForkAt != 0 {
		t.Fatalf("a new chat should start Pi session %s, got %+v", c.ID, s)
	}
}

func TestToolCallsAreStreamedAndSaved(t *testing.T) {
	h := newHarness(t, func(s pi.Spec) pi.Result {
		return pi.Result{Text: "done", Parts: []store.Part{
			{Type: "tool", Tool: &store.Tool{ID: "c1", Name: "bash", Status: "done", Output: "ok"}},
			{Type: "text", Text: "done"},
		}}
	})
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "run it"})
	parts := h.chat(c.ID).Messages[1].Parts
	if len(parts) != 2 || parts[0].Tool == nil || parts[0].Tool.Name != "bash" || parts[0].Tool.Output != "ok" {
		t.Fatalf("parts %+v", parts)
	}
}

func TestReplyUsageIsSentWhenDoneAndSaved(t *testing.T) {
	h := newHarness(t, func(s pi.Spec) pi.Result {
		r := echo(s)
		r.Usage = &store.Usage{Input: 1204, Output: 356, Calls: 2, Ms: 8400}
		return r
	})
	c := h.newChat(map[string]any{})
	var done event
	for _, e := range h.send(c.ID, map[string]any{"content": "hi"}) {
		if e.Name == "done" {
			done = e
		}
	}
	if u, _ := done.Data["usage"].(map[string]any); done.Name != "done" || u["input"] != 1204.0 || u["output"] != 356.0 {
		t.Fatalf("done event %+v", done)
	}
	if u := h.chat(c.ID).Messages[1].Usage; u == nil || u.Input != 1204 || u.Ms != 8400 {
		t.Fatalf("saved usage %+v", u)
	}
}

func TestAgentSettingsReachPi(t *testing.T) {
	h := newHarness(t, echo)
	var a store.Agent
	h.do("POST", "/api/agents", store.Agent{
		Name: "Pirate", SystemPrompt: "Talk like a pirate.", Model: "fake/big",
		Thinking: "high", Tools: []string{"read"},
	}, &a)
	c := h.newChat(map[string]any{"agentId": a.ID})

	h.send(c.ID, map[string]any{"content": "ahoy"})

	s := h.agent.lastSpec()
	if !strings.HasPrefix(s.System, "Talk like a pirate.\n\n") || s.Model != "fake/big" || s.Thinking != "high" ||
		strings.Join(s.Tools, ",") != "read" || s.Prompt != "ahoy" {
		t.Fatalf("pi got %+v", s)
	}
}

func TestChatWithoutAgentKeepsPiDefaultTools(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "x"})
	if s := h.agent.lastSpec(); s.Tools != nil {
		t.Fatalf("pi got %+v", s)
	}
}

func TestPiErrorIsStreamedAndSaved(t *testing.T) {
	h := newHarness(t, func(pi.Spec) pi.Result { return pi.Result{Error: "rate limited"} })
	c := h.newChat(map[string]any{})

	evs := h.send(c.ID, map[string]any{"content": "one"})
	last := evs[len(evs)-1]
	if last.Name != "done" || last.Data["error"] != "rate limited" {
		t.Fatalf("last event %+v", last)
	}
	if m := h.chat(c.ID).Messages; len(m) != 2 || m[1].Error != "rate limited" {
		t.Fatalf("messages %+v", m)
	}
}

func TestEditForksPiBeforeThatMessage(t *testing.T) {
	h := newHarness(t, func(s pi.Spec) pi.Result {
		r := echo(s)
		if s.ForkAt > 0 {
			r.Session = "forked"
		}
		return r
	})
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "first"})
	h.send(c.ID, map[string]any{"content": "second"})
	second := h.chat(c.ID).Messages[2]

	h.send(c.ID, map[string]any{"content": "second, edited", "from": second.ID})

	if s := h.agent.lastSpec(); s.ForkAt != 2 || s.ForkText != "second" || s.Prompt != "second, edited" {
		t.Fatalf("pi got %+v", s)
	}
	var got []string
	for _, m := range h.chat(c.ID).Messages {
		got = append(got, m.Content)
	}
	want := []string{"first", "you said first", "second, edited", "you said second, edited"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("messages %q", got)
	}

	h.send(c.ID, map[string]any{"content": "third"})
	if s := h.agent.lastSpec(); s.Session != "forked" {
		t.Fatalf("after a fork the chat should continue in the forked session, got %q", s.Session)
	}
}

func TestRegenerateForksBeforeTheQuestionAndAsksAgain(t *testing.T) {
	n := 0
	h := newHarness(t, func(s pi.Spec) pi.Result {
		n++
		return pi.Result{Text: strings.Repeat("again ", n-1) + "answer"}
	})
	c := h.newChat(map[string]any{"model": "fake/big"})
	h.send(c.ID, map[string]any{"content": "q"})
	reply := h.chat(c.ID).Messages[1]

	h.send(c.ID, map[string]any{"from": reply.ID})

	if s := h.agent.lastSpec(); s.ForkAt != 1 || s.Prompt != "q" {
		t.Fatalf("pi got %+v", s)
	}
	msgs := h.chat(c.ID).Messages
	if len(msgs) != 2 || msgs[0].Content != "q" || msgs[1].Content == reply.Content {
		t.Fatalf("messages %+v", msgs)
	}
}

func TestFirstReplyGivesChatATitle(t *testing.T) {
	h := newHarness(t, func(pi.Spec) pi.Result { return pi.Result{Text: "sure"} })
	h.agent.title = "\"Planning a Lisbon trip.\""
	c := h.newChat(map[string]any{})

	evs := h.send(c.ID, map[string]any{"content": "help me plan lisbon"})

	if got := h.chat(c.ID).Title; got != "Planning a Lisbon trip" {
		t.Fatalf("title %q", got)
	}
	var sawTitle bool
	for _, e := range evs {
		sawTitle = sawTitle || (e.Name == "title" && e.Data["title"] == "Planning a Lisbon trip")
	}
	if !sawTitle {
		t.Fatalf("no title event in %+v", evs)
	}
	if p := h.agent.titles[0]; !strings.Contains(p, "help me plan lisbon") || !strings.Contains(p, "sure") {
		t.Fatalf("title prompt %q", p)
	}
}

func TestChatIsNamedAfterItsFirstMessageWhenNoTitleComesBack(t *testing.T) {
	h := newHarness(t, func(pi.Spec) pi.Result { return pi.Result{Text: "sure"} })
	h.agent.titleErr = errors.New("model refused")
	c := h.newChat(map[string]any{})

	h.send(c.ID, map[string]any{"content": "  Plan a three day trip\nto Lisbon with kids  "})

	// A title is a short summary that fits the sidebar: four words at most.
	if got := h.chat(c.ID).Title; got != "Plan a three day" {
		t.Fatalf("title %q", got)
	}
}

func TestAnAnswerInsteadOfATitleIsNotUsed(t *testing.T) {
	h := newHarness(t, func(pi.Spec) pi.Result { return pi.Result{Text: "sure"} })
	h.agent.title = "I appreciate the constraint, but I am unable to see the image you attached"
	c := h.newChat(map[string]any{})

	h.send(c.ID, map[string]any{"content": "What is in this picture"})

	if got := h.chat(c.ID).Title; got != "What is in this" {
		t.Fatalf("title %q", got)
	}
}

func TestATitleLongerThanFourWordsIsNotUsed(t *testing.T) {
	h := newHarness(t, func(pi.Spec) pi.Result { return pi.Result{Text: "sure"} })
	h.agent.title = "Planning a family trip to Lisbon"
	c := h.newChat(map[string]any{})

	h.send(c.ID, map[string]any{"content": "Lisbon with kids"})

	if got := h.chat(c.ID).Title; got != "Lisbon with kids" {
		t.Fatalf("title %q", got)
	}
}

func TestSecondSendWhileReplyingIsRefused(t *testing.T) {
	h := newHarness(t, echo)
	h.agent.block, h.agent.started = make(chan struct{}), make(chan struct{})
	c := h.newChat(map[string]any{})
	go h.send(c.ID, map[string]any{"content": "one"})
	<-h.agent.started

	resp := h.do("POST", "/api/chats/"+c.ID+"/messages", map[string]any{"content": "two"}, nil)
	close(h.agent.block)
	if resp.StatusCode != 409 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	for range 100 {
		if len(h.chat(c.ID).Messages) == 2 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("messages %+v", h.chat(c.ID).Messages)
}

func TestReplyKeepsGoingWhenTheBrowserLeaves(t *testing.T) {
	h := newHarness(t, echo)
	h.agent.block, h.agent.started = make(chan struct{}), make(chan struct{})
	c := h.newChat(map[string]any{})
	ctx, leave := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "POST", h.srv.URL+"/api/chats/"+c.ID+"/messages", strings.NewReader(`{"content":"one"}`))
	req.Header.Set("Content-Type", "application/json")
	go func() {
		if resp, err := http.DefaultClient.Do(req); err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}()
	<-h.agent.started
	leave()
	time.Sleep(50 * time.Millisecond) // let the server see the browser go
	close(h.agent.block)

	m := h.waitReply(c.ID)
	if m.Error != "" || m.Content != "you said one" {
		t.Fatalf("reply %+v", m)
	}
}

func TestStopEndsTheReply(t *testing.T) {
	h := newHarness(t, echo)
	h.agent.block, h.agent.started = make(chan struct{}), make(chan struct{})
	defer close(h.agent.block)
	c := h.newChat(map[string]any{})
	go h.send(c.ID, map[string]any{"content": "one"})
	<-h.agent.started

	if resp := h.do("POST", "/api/chats/"+c.ID+"/stop", nil, nil); resp.StatusCode != 204 {
		t.Fatalf("stop: status %d", resp.StatusCode)
	}
	if m := h.waitReply(c.ID); m.Error != "Stopped" {
		t.Fatalf("reply %+v", m)
	}
}

func TestReopenedChatFollowsTheReplyStillBeingWritten(t *testing.T) {
	h := newHarness(t, echo)
	h.agent.block, h.agent.started = make(chan struct{}), make(chan struct{})
	c := h.newChat(map[string]any{})
	go h.send(c.ID, map[string]any{"content": "one"})
	<-h.agent.started
	unblock := sync.OnceFunc(func() { close(h.agent.block) })
	defer unblock()

	var open struct{ Replying bool }
	h.do("GET", "/api/chats/"+c.ID, nil, &open)
	if !open.Replying {
		t.Fatal("chat does not say it is replying")
	}
	got := make(chan []event)
	go func() { got <- h.follow(c.ID) }()
	unblock()
	evs := <-got
	if d := deltas(evs); d != "you said one" {
		t.Fatalf("deltas %q", d)
	}
	if evs[len(evs)-1].Name != "title" && evs[len(evs)-1].Name != "done" {
		t.Fatalf("last event %q", evs[len(evs)-1].Name)
	}

	h.do("GET", "/api/chats/"+c.ID, nil, &open)
	if open.Replying {
		t.Fatal("chat still says it is replying")
	}
}

func TestChatListSaysWhichChatsAreReplying(t *testing.T) {
	h := newHarness(t, echo)
	h.agent.block, h.agent.started = make(chan struct{}), make(chan struct{})
	busy := h.newChat(map[string]any{})
	idle := h.newChat(map[string]any{})
	go h.send(busy.ID, map[string]any{"content": "one"})
	<-h.agent.started
	unblock := sync.OnceFunc(func() { close(h.agent.block) })
	defer unblock()

	var list []struct {
		ID       string
		Replying bool
	}
	h.do("GET", "/api/chats", nil, &list)
	got := map[string]bool{}
	for _, c := range list {
		got[c.ID] = c.Replying
	}
	if !got[busy.ID] || got[idle.ID] {
		t.Fatalf("replying %v, want only %s", got, busy.ID)
	}
	unblock()
	h.waitReply(busy.ID)
	h.do("GET", "/api/chats", nil, &list)
	for _, c := range list {
		if c.Replying {
			t.Fatalf("%s still replying after its reply ended", c.ID)
		}
	}
}

func TestEmptyMessageIsRefused(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})
	if resp := h.do("POST", "/api/chats/"+c.ID+"/messages", map[string]any{"content": "  "}, nil); resp.StatusCode != 400 {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestRenamePinListAndDeleteChats(t *testing.T) {
	h := newHarness(t, echo)
	a := h.newChat(map[string]any{})
	b := h.newChat(map[string]any{})

	h.do("PATCH", "/api/chats/"+a.ID, map[string]any{"title": "Renamed", "pinned": true}, nil)
	var list []store.Chat
	h.do("GET", "/api/chats", nil, &list)
	if len(list) != 2 || list[0].ID != a.ID || list[0].Title != "Renamed" || !list[0].Pinned {
		t.Fatalf("list %+v", list)
	}

	if resp := h.do("DELETE", "/api/chats/"+b.ID, nil, nil); resp.StatusCode != 204 {
		t.Fatalf("delete status %d", resp.StatusCode)
	}
	if resp := h.do("GET", "/api/chats/"+b.ID, nil, nil); resp.StatusCode != 404 {
		t.Fatalf("get deleted: status %d", resp.StatusCode)
	}
}

func TestConfigListsModelsAndDefault(t *testing.T) {
	h := newHarness(t, echo)
	var cfg struct {
		Models       []pi.Model `json:"models"`
		DefaultModel string     `json:"defaultModel"`
		Workspace    string     `json:"workspace"`
	}
	h.do("GET", "/api/config", nil, &cfg)
	if cfg.Workspace != h.workspace {
		t.Errorf("workspace %q, want %q: the UI needs it to show images Pi wrote at absolute paths", cfg.Workspace, h.workspace)
	}
	if len(cfg.Models) != 2 || cfg.Models[1] != (pi.Model{ID: "fake/big", Name: "Big", Provider: "fake", Reasoning: true, Images: true}) || cfg.DefaultModel != "fake/small" {
		t.Fatalf("config %+v", cfg)
	}
}

func TestCrossSiteWritesAreRefused(t *testing.T) {
	h := newHarness(t, echo)
	req, _ := http.NewRequest("POST", h.srv.URL+"/api/chats", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("cross-site status %d", resp.StatusCode)
	}

	// A DELETE has no body, so only Sec-Fetch-Site stops it; a sandboxed
	// frame's opaque origin is cross-site to every page.
	c := h.newChat(map[string]any{})
	req, _ = http.NewRequest("DELETE", h.srv.URL+"/api/chats/"+c.ID, nil)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("cross-site delete status %d", resp.StatusCode)
	}
	if resp := h.do("GET", "/api/chats/"+c.ID, nil, nil); resp.StatusCode != 200 {
		t.Fatalf("the chat is gone after a refused delete: %d", resp.StatusCode)
	}

	req, _ = http.NewRequest("POST", h.srv.URL+"/api/chats", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "text/plain")
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 415 {
		t.Fatalf("form-style post status %d", resp.StatusCode)
	}
}

func TestUIIsServedWithSecurityHeaders(t *testing.T) {
	h := newHarness(t, echo)
	resp := h.do("GET", "/", nil, nil)
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Security-Policy"), "script-src 'self'") ||
		!strings.Contains(resp.Header.Get("Content-Security-Policy"), "frame-src 'self';") ||
		resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("status %d headers %v", resp.StatusCode, resp.Header)
	}
}

func TestWithoutDefaultANewChatUsesFirstListedModel(t *testing.T) {
	h := newHarnessDefault(t, echo, "")
	if c := h.newChat(map[string]any{}); c.Model != "fake/small" {
		t.Fatalf("model %q", c.Model)
	}
}

func TestNewChatHasEmptyMessageListNotNull(t *testing.T) {
	h := newHarness(t, echo)
	var raw map[string]json.RawMessage
	h.do("POST", "/api/chats", map[string]any{}, &raw)
	if string(raw["messages"]) != "[]" {
		t.Fatalf("messages = %s", raw["messages"])
	}
}

func TestPluginsAreListedAndATurnedOffPluginAddsNothingToPi(t *testing.T) {
	h := newHarness(t, echo)
	var list []plugins.Plugin
	h.do("GET", "/api/plugins", nil, &list)
	if len(list) != 6 || list[0].ID != "attachments" || list[2].ID != "charts" || !list[2].Enabled {
		t.Fatalf("plugins %+v", list)
	}
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "draw"})
	if s := h.agent.lastSpec().System; !strings.Contains(s, "```chart") || !strings.Contains(s, "![short description]") {
		t.Fatalf("pi was not told about the plugins: %q", s)
	}

	var p plugins.Plugin
	if resp := h.do("PUT", "/api/plugins/charts", map[string]any{"enabled": false}, &p); resp.StatusCode != 200 || p.Enabled {
		t.Fatalf("turn off: status %d, %+v", resp.StatusCode, p)
	}
	h.do("GET", "/api/plugins", nil, &list)
	if list[2].Enabled {
		t.Fatalf("charts still on: %+v", list[2])
	}
	h.send(c.ID, map[string]any{"content": "draw again"})
	if s := h.agent.lastSpec().System; strings.Contains(s, "```chart") || !strings.Contains(s, "![short description]") {
		t.Fatalf("pi got %q", s)
	}
	if resp := h.do("PUT", "/api/plugins/nope", map[string]any{"enabled": false}, nil); resp.StatusCode != 404 {
		t.Fatalf("unknown plugin: status %d", resp.StatusCode)
	}
}

// me asks GET /api/me with the given request headers (name, value, ...).
func (h *harness) me(hdr ...string) (*http.Response, map[string]string) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.srv.URL+"/api/me", nil)
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			h.t.Fatal(err)
		}
	}
	return resp, out
}

func TestMeNamesThePersonTheProxySays(t *testing.T) {
	h := newHarness(t, echo)
	resp, me := h.me("X-Forwarded-User", "bob-1a2b3c4d", "X-Forwarded-Preferred-Username", "bob")
	if resp.StatusCode != 200 || me["username"] != "bob" || me["name"] != "bob" || len(me) != 2 {
		t.Fatalf("status %d body %v", resp.StatusCode, me)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control %q: the answer differs per person", resp.Header.Get("Cache-Control"))
	}
}

func TestMeFallsBackToTheForwardedUser(t *testing.T) {
	h := newHarness(t, echo)
	resp, me := h.me("X-Forwarded-User", "bob-1a2b3c4d")
	if resp.StatusCode != 200 || me["username"] != "bob-1a2b3c4d" || me["name"] != "bob-1a2b3c4d" {
		t.Fatalf("status %d body %v", resp.StatusCode, me)
	}
}

func TestWithNoProxyMeIsTheUserRunningHarf(t *testing.T) {
	h := newHarness(t, echo)
	u, err := user.Current()
	if err != nil {
		t.Skip("no current user here")
	}
	resp, me := h.me()
	if resp.StatusCode != 200 || me["username"] != u.Username {
		t.Fatalf("status %d body %v, want %q", resp.StatusCode, me, u.Username)
	}
}

func TestWebManifestIsServedAsAManifest(t *testing.T) {
	ui := fstest.MapFS{"site.webmanifest": {Data: []byte(`{"name":"x"}`)}}
	h := serve(t, t.TempDir(), t.TempDir(), ui, &fakeAgent{reply: echo}, "fake/small")
	resp, err := http.Get(h.srv.URL + "/site.webmanifest")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if got := resp.Header.Get("Content-Type"); got != "application/manifest+json" {
		t.Fatalf("Content-Type = %q, want application/manifest+json", got)
	}
}

func TestModelsAreListedWhenTheServerStartsNotWhenThePageAsks(t *testing.T) {
	h := newHarness(t, echo)
	for range 200 {
		h.agent.mu.Lock()
		asked := h.agent.modelAsks == 1 && h.agent.imageAsks == 1
		h.agent.mu.Unlock()
		if asked {
			var cfg struct{ Models []pi.Model }
			h.do("GET", "/api/config", nil, &cfg)
			h.agent.mu.Lock()
			defer h.agent.mu.Unlock()
			if len(cfg.Models) != 2 || h.agent.modelAsks != 1 {
				t.Fatalf("models %v, asked %d times", cfg.Models, h.agent.modelAsks)
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("Pi was not asked for its models at start")
}

func TestChatModelsAndPluginsDoNotWaitForSlowImageModels(t *testing.T) {
	slow := make(chan struct{})
	h := newHarnessFrom(t, &fakeAgent{reply: echo, images: imageModels, imagesSlow: slow}, "fake/small")
	defer h.release(slow)
	done := make(chan struct{})
	var cfg struct {
		Models        []pi.Model `json:"models"`
		ImagesLoading bool       `json:"imagesLoading"`
	}
	var ps []plugins.Plugin
	go func() {
		h.do("GET", "/api/config", nil, &cfg)
		h.do("GET", "/api/plugins", nil, &ps)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("config or plugins waited for the image models")
	}
	if len(cfg.Models) != 2 || !cfg.ImagesLoading {
		t.Fatalf("config %+v", cfg)
	}
	if len(ps) == 0 {
		t.Fatal("no plugins")
	}
}

func TestARestartAnswersWithTheModelsListedLastTimeWhilePiIsSlow(t *testing.T) {
	dir := t.TempDir()
	first := newHarnessIn(t, dir, &fakeAgent{reply: echo, images: imageModels}, "fake/small")
	var cfg struct {
		Models        []pi.Model `json:"models"`
		ImageModels   []pi.Model `json:"imageModels"`
		ImagesLoading bool       `json:"imagesLoading"`
	}
	for range 200 { // until the first run has listed both
		first.do("GET", "/api/config", nil, &cfg)
		if len(cfg.ImageModels) > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	slow := make(chan struct{})
	again := newHarnessIn(t, dir, &fakeAgent{reply: echo, modelsSlow: slow, imagesSlow: slow}, "fake/small")
	defer again.release(slow)
	done := make(chan struct{})
	cfg.Models, cfg.ImageModels = nil, nil
	go func() { again.do("GET", "/api/config", nil, &cfg); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the restarted server waited for Pi")
	}
	if len(cfg.Models) != 2 || len(cfg.ImageModels) != len(imageModels) || cfg.ImagesLoading {
		t.Fatalf("config %+v", cfg)
	}
}

// release lets a slow fake Pi answer, then waits until the server has
// stored its image models, so no write outlives the test's folder.
func (h *harness) release(slow chan struct{}) {
	close(slow)
	for range 400 {
		var cfg struct{ ImagesLoading bool }
		h.do("GET", "/api/config", nil, &cfg)
		if !cfg.ImagesLoading {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}
