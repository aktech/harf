package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/plugins"
	"github.com/aktech/harf/internal/store"
)

const titleInstruction = "Summarise this conversation in two to four words, as a title."

// titleWords is the most words a title has, so it fits the sidebar.
const titleWords = 4

// sendMessage saves the user's message, streams Pi's reply to the browser
// as server-sent events and saves the reply when it ends.
//
// With "from", the conversation first goes back to just before that message:
// with content it is an edit of that message, without content it asks for a
// new reply (from must then be a reply).
func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Content     string             `json:"content"`
		From        string             `json:"from"`
		Attachments []store.Attachment `json:"attachments"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Content = strings.TrimSpace(in.Content)
	atts, err := s.attachments(id, in.Attachments)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	asks := in.Content != "" || len(atts) > 0 // a new or edited message, not a regenerate
	if in.From == "" && !asks {
		badRequest(w, "message is empty")
		return
	}
	chat, err := s.store.GetChat(id)
	if err != nil {
		fail(w, err)
		return
	}
	// The reply outlives this request: only a stop or the server ending it
	// cancels Pi.
	ctx, stop := context.WithCancel(context.WithoutCancel(r.Context()))
	rep := newReply(stop)
	if !s.claim(id, rep) {
		stop()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "this chat is still replying"})
		return
	}
	started := false
	defer func() {
		if !started {
			s.release(id)
		}
	}()

	ask := store.Message{Role: "user", Content: in.Content, Attachments: atts}
	spec := pi.Spec{Session: chat.Session, Model: chat.Model, Thinking: chat.Thinking}
	if spec.Session == "" {
		spec.Session = chat.ID
	}
	if in.From != "" {
		i := slices.IndexFunc(chat.Messages, func(m store.Message) bool { return m.ID == in.From })
		if i < 0 {
			fail(w, store.ErrNotFound)
			return
		}
		cut := chat.Messages[i].ID // the edited message, or the reply to replace
		if !asks {
			// Regenerate: ask the question before this reply again.
			if chat.Messages[i].Role != "assistant" || i == 0 {
				badRequest(w, "only a reply can be regenerated")
				return
			}
			i--
			ask = chat.Messages[i]
		}
		spec.ForkAt = userCount(chat.Messages[:i+1])
		spec.ForkText = promptFor(chat.Messages[i])
		if _, err := s.store.TruncateFrom(id, cut); err != nil {
			fail(w, err)
			return
		}
	}
	spec.Prompt = promptFor(ask)
	spec.Images = s.images(r.Context(), chat.Model, ask.Attachments)
	if asks {
		if _, err := s.store.AppendMessage(id, ask); err != nil {
			fail(w, err)
			return
		}
	}
	var agent *store.Agent
	if chat.AgentID != "" {
		// A deleted agent leaves its chats as plain chats.
		if a, err := s.store.GetAgent(chat.AgentID); err == nil {
			spec.System, spec.Tools = a.SystemPrompt, a.Tools
			agent = &a
		}
	}
	spec.MCP = s.mcpServers(agent)
	if s.pluginOn(plugins.AgentBuilder) {
		spec.AgentTools = s.agentTool
	}
	spec.System = joinNonEmpty(spec.System, plugins.System(s.plugins(r.Context())))
	if s.isImageModel(r.Context(), chat.Model) {
		spec.ImageModel, spec.ImageOnly = chat.Model, true
	} else if s.pluginOn(plugins.Images) {
		spec.ImageModel = s.imageModel(r.Context())
	}

	started = true
	// A chat is named from its first message at once, so it never shows as
	// "New chat" while it has content; the model's title replaces this name
	// after the first reply, unless the chat was renamed meanwhile.
	if chat.Title == "" {
		if name := nameFrom(ask); name != "" {
			if _, err := s.store.UpdateChat(id, store.ChatPatch{Title: &name}); err == nil {
				rep.send("title", map[string]string{"title": name})
			}
		}
	}
	go s.write(ctx, rep, id, chat, ask, spec)
	rep.follow(w, r)
}

// nameFrom is a chat's name before the model has titled it: the first words
// of the message, or the first attached file's name.
func nameFrom(ask store.Message) string {
	if ask.Content != "" {
		return firstWords(firstLine(ask.Content), titleWords)
	}
	if len(ask.Attachments) > 0 {
		return clip(ask.Attachments[0].Name, 60)
	}
	return ""
}

// nameUntitled names, from their first message, the chats that have
// messages but no title (cut off before a reply finished, or from before
// names were given at once).
func nameUntitled(st *store.Store) {
	for _, c := range st.ListChats() {
		if c.Title != "" {
			continue
		}
		full, err := st.GetChat(c.ID)
		if err != nil {
			continue
		}
		for _, m := range full.Messages {
			if name := nameFrom(m); m.Role == "user" && name != "" {
				st.UpdateChat(c.ID, store.ChatPatch{Title: &name})
				break
			}
		}
	}
}

// write runs Pi for the reply, saves it and names the chat after its first
// reply.
func (s *Server) write(ctx context.Context, rep *reply, id string, chat store.Chat, ask store.Message, spec pi.Spec) {
	defer rep.end()
	defer rep.stop()
	res := s.agent.Run(ctx, spec, func(e pi.Event) { rep.send("part", e) })
	if res.Session != "" && res.Session != spec.Session {
		s.store.UpdateChat(id, store.ChatPatch{Session: &res.Session})
	}
	model := res.Model
	if model == "" {
		model = chat.Model
	}
	saved, err := s.store.AppendMessage(id, store.Message{
		Role: "assistant", Content: res.Text, Parts: res.Parts, Model: model, Error: res.Error, Usage: res.Usage,
	})
	// Saved: the chat can take its next message while the title is made.
	s.release(id)
	if err != nil {
		rep.send("error", map[string]string{"error": err.Error()})
		return
	}
	rep.send("done", saved)

	if chat.Title == "" && res.Error == "" {
		// The title model sees no files, so it gets their names, not paths
		// it would try to open.
		question := ask.Content
		for _, a := range ask.Attachments {
			question += "\n[attached: " + a.Name + "]"
		}
		var title string
		if !spec.ImageOnly { // an image model writes no text
			title = s.makeTitle(ctx, chat.Model, strings.TrimSpace(question), saved.Content)
		}
		// Replace the name given from the message only while it is still
		// that name: a rename during the reply wins.
		now, err := s.store.GetChat(id)
		if title != "" && err == nil && now.Title == nameFrom(ask) {
			if _, err := s.store.UpdateChat(id, store.ChatPatch{Title: &title}); err == nil {
				rep.send("title", map[string]string{"title": title})
			}
		}
	}
}

// claim marks a chat as replying. It fails when a reply is already
// streaming: a Pi session runs one reply at a time.
func (s *Server) claim(id string, r *reply) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.replying[id] != nil {
		return false
	}
	s.replying[id] = r
	return true
}

// followReply streams the chat's reply that is still being written, from
// its start. With none, there is nothing to follow.
func (s *Server) followReply(w http.ResponseWriter, r *http.Request) {
	rep := s.current(r.PathValue("id"))
	if rep == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	rep.follow(w, r)
}

// stopReply stops the chat's reply, if one is being written. What arrived
// so far is saved.
func (s *Server) stopReply(w http.ResponseWriter, r *http.Request) {
	if rep := s.current(r.PathValue("id")); rep != nil {
		rep.stop()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) current(id string) *reply {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.replying[id]
}

func (s *Server) release(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.replying, id)
}

func userCount(ms []store.Message) int {
	n := 0
	for _, m := range ms {
		if m.Role == "user" {
			n++
		}
	}
	return n
}

// makeTitle asks the chat's model for a short title. It returns "" when the
// model fails, so a chat keeps its placeholder name.
func (s *Server) makeTitle(ctx context.Context, model, question, reply string) string {
	// The conversation is quoted inside tags so the model names it rather
	// than replying to it.
	convo := fmt.Sprintf("<conversation>\nuser: %s\nassistant: %s\n</conversation>\n\nDo not reply to the conversation. %s",
		clip(question, 1000), clip(reply, 1000), titleInstruction)
	out, err := s.agent.Complete(ctx, model, titleInstruction+" Reply with the title only, no quotes.", convo)
	if err != nil {
		return ""
	}
	t := strings.Trim(firstLine(out), "\"'`*#. ")
	// More words than that is too long to show, or an answer instead.
	if len(strings.Fields(t)) > titleWords {
		return ""
	}
	return clip(t, 80)
}

func joinNonEmpty(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, "\n\n")
}

func firstWords(s string, n int) string {
	w := strings.Fields(s)
	return clip(strings.Join(w[:min(n, len(w))], " "), 60)
}

func firstLine(s string) string {
	return strings.TrimSpace(strings.SplitN(strings.TrimSpace(s), "\n", 2)[0])
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

type sse struct {
	w http.ResponseWriter
	f http.Flusher
}

func newSSE(w http.ResponseWriter) *sse {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	f, _ := w.(http.Flusher)
	return &sse{w: w, f: f}
}

func (s *sse) send(event string, v any) {
	b, _ := json.Marshal(v)
	fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, b)
	if s.f != nil {
		s.f.Flush()
	}
}
