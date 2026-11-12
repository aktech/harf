// Package server serves the chat API and the embedded web UI.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os/user"
	"strings"
	"sync"
	"time"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/plugins"
	"github.com/aktech/harf/internal/store"
)

// Agent produces replies. *pi.Runner is the real one.
type Agent interface {
	Run(ctx context.Context, s pi.Spec, emit func(pi.Event)) pi.Result
	Models(ctx context.Context) ([]pi.Model, error)
	Complete(ctx context.Context, model, system, prompt string) (string, error)
	// ImageModels lists the image models Pi can make images with.
	ImageModels(ctx context.Context) ([]pi.Model, error)
	// CheckMCP connects to an MCP server and reports its tools.
	CheckMCP(ctx context.Context, m store.MCPServer) (pi.MCPCheck, error)
}

type Server struct {
	store        *store.Store
	agent        Agent
	defaultModel string
	workspace    string // the folder Pi's tools work in
	mux          *http.ServeMux

	mu       sync.Mutex
	replying map[string]*reply // chats with a reply being written

	models, imageModels modelList
}

// New serves the API under /api/ and the files of ui everywhere else.
// workspace is the folder Pi's tools work in.
func New(st *store.Store, agent Agent, defaultModel, workspace string, ui fs.FS) http.Handler {
	s := &Server{store: st, agent: agent, defaultModel: defaultModel, workspace: workspace, mux: http.NewServeMux(), replying: map[string]*reply{}}
	s.models.keep(st, "models")
	removeHalfUploads(workspace)
	nameUntitled(st)
	s.imageModels.keep(st, "image-models")
	// Asking Pi for its models takes from a fraction of a second to tens of
	// seconds; ask now so the first page load does not wait for it.
	go func() {
		ctx := context.Background()
		s.listModels(ctx)
		s.listImageModels(ctx)
	}()
	s.mux.HandleFunc("GET /api/config", s.config)
	s.mux.HandleFunc("GET /api/me", me)
	s.mux.HandleFunc("GET /api/chats", s.listChats)
	s.mux.HandleFunc("POST /api/chats", s.createChat)
	s.mux.HandleFunc("GET /api/chats/{id}", s.getChat)
	s.mux.HandleFunc("PATCH /api/chats/{id}", s.updateChat)
	s.mux.HandleFunc("DELETE /api/chats/{id}", s.deleteChat)
	s.mux.HandleFunc("POST /api/chats/{id}/messages", s.sendMessage)
	s.mux.HandleFunc("GET /api/chats/{id}/stream", s.followReply)
	s.mux.HandleFunc("POST /api/chats/{id}/stop", s.stopReply)
	s.mux.HandleFunc("POST /api/chats/{id}/files", s.upload)
	s.mux.HandleFunc("GET /api/agents", s.listAgents)
	s.mux.HandleFunc("POST /api/agents", s.saveAgent)
	s.mux.HandleFunc("PUT /api/agents/{id}", s.saveAgent)
	s.mux.HandleFunc("DELETE /api/agents/{id}", s.deleteAgent)
	s.mux.HandleFunc("GET /api/mcp", s.listMCP)
	s.mux.HandleFunc("POST /api/mcp", s.addMCP)
	s.mux.HandleFunc("POST /api/mcp/test", s.testMCP)
	s.mux.HandleFunc("PUT /api/mcp/{name}", s.updateMCP)
	s.mux.HandleFunc("DELETE /api/mcp/{name}", s.deleteMCP)
	s.mux.HandleFunc("GET /api/files/{path...}", s.file)
	s.mux.HandleFunc("GET /api/frame", s.frame)
	s.mux.HandleFunc("GET /api/plugins", s.listPlugins)
	s.mux.HandleFunc("PUT /api/plugins/{id}", s.setPlugin)
	s.mux.HandleFunc("PUT /api/image-model", s.setImageModel)
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	files := http.FileServerFS(ui)
	s.mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Files are small and built into the binary: always revalidate so a
		// new version is picked up on the next load.
		w.Header().Set("Cache-Control", "no-cache")
		// Go does not know this extension; browsers want the manifest type.
		if strings.HasSuffix(r.URL.Path, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		files.ServeHTTP(w, r)
	}))
	return securityHeaders(sameOriginWrites(s.mux))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// sameOriginWrites refuses requests that change data unless they come from
// this app's own pages. Browsers set Sec-Fetch-Site and a page cannot change
// it; a JSON content type cannot be sent cross-site without a CORS preflight,
// which this server never grants. Requests from other apps on the same site
// (other subdomains of one domain) are refused too. The one other body
// allowed is an uploaded file: raw bytes with the file's name in the
// X-Harf-Name header, which also cannot be sent cross-site without a
// preflight, and which no HTML form can send.
func sameOriginWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		switch r.Header.Get("Sec-Fetch-Site") {
		case "", "same-origin", "none":
		default:
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-site request refused"})
			return
		}
		if r.Method != http.MethodDelete && !jsonBody(r) && !fileBody(r) {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "send JSON, or a file as application/octet-stream"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonBody(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("Content-Type"), "application/json")
}

// fileBody is an upload's request: raw bytes and the file's name.
func fileBody(r *http.Request) bool {
	return r.Header.Get("Content-Type") == "application/octet-stream" && r.Header.Get(nameHeader) != ""
}

func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	models, err := s.listModels(r.Context())
	out := map[string]any{"models": models, "defaultModel": s.defaultModel, "workspace": s.workspace,
		"maxUpload": maxUpload, "maxModelImage": maxModelImage}
	// Pi sometimes takes tens of seconds to list image models; the chat
	// models do not wait for them. imagesLoading tells the page to ask again.
	if images, ok := s.imageModels.peek(); ok {
		out["imageModels"], out["imageModel"] = images, s.imageModel(r.Context())
	} else {
		out["imageModels"], out["imagesLoading"] = []pi.Model{}, true
	}
	if err != nil {
		out["warning"] = err.Error()
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) listModels(ctx context.Context) ([]pi.Model, error) {
	return s.models.get(ctx, s.agent.Models)
}

// modelList keeps a list of models from Pi for a minute: each ask starts a
// Pi process.
type modelList struct {
	mu         sync.Mutex
	models     []pi.Model
	listed     time.Time
	refreshing bool
	st         *store.Store
	name       string
}

// keep remembers the list in st under name, and starts from what was
// remembered last time: Pi can take tens of seconds to answer, so a
// restart answers with the old list while it asks Pi again.
func (l *modelList) keep(st *store.Store, name string) {
	l.st, l.name = st, name
	var ms []pi.Model
	if st.Remembered(name, &ms) && ms != nil {
		l.models = ms // listed stays zero: stale, so the next get refreshes
	}
}

// peek returns the list Pi last gave without asking it again; ok is false
// before Pi has answered once.
func (l *modelList) peek() (ms []pi.Model, ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.models, l.models != nil
}

// get returns the list, asking Pi only when there is none yet. A list over
// a minute old is returned as it is while Pi is asked again in the
// background.
func (l *modelList) get(ctx context.Context, ask func(context.Context) ([]pi.Model, error)) ([]pi.Model, error) {
	l.mu.Lock()
	if l.models != nil {
		if time.Since(l.listed) >= time.Minute && !l.refreshing {
			l.refreshing = true
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				defer cancel()
				l.fetch(ctx, ask)
				l.mu.Lock()
				l.refreshing = false
				l.mu.Unlock()
			}()
		}
		defer l.mu.Unlock()
		return l.models, nil
	}
	l.mu.Unlock()
	return l.fetch(ctx, ask)
}

func (l *modelList) fetch(ctx context.Context, ask func(context.Context) ([]pi.Model, error)) ([]pi.Model, error) {
	ms, err := ask(ctx)
	l.mu.Lock()
	defer l.mu.Unlock()
	if err != nil {
		return l.models, err
	}
	if ms == nil {
		ms = []pi.Model{}
	}
	l.models, l.listed = ms, time.Now()
	if l.st != nil {
		l.st.Remember(l.name, ms) // a lost cache only costs the next restart a wait
	}
	return ms, nil
}

// me answers who is signed in, as the proxy in front names them in the
// headers oauth2-proxy sends, or else the user running Harf. These headers are
// believed only because that proxy removes any copies the client sent, so
// this server must not be reachable any other way.
func me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	name := r.Header.Get("X-Forwarded-Preferred-Username")
	if name == "" {
		name = r.Header.Get("X-Forwarded-User")
	}
	if name == "" {
		// With no proxy in front, Harf is someone's own: show the user
		// running it.
		if u, err := user.Current(); err == nil {
			name = u.Username
		}
	}
	if name == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": name, "name": name})
}

// listChats lists the chats without their messages, each saying whether
// a reply is being written for it right now.
func (s *Server) listChats(w http.ResponseWriter, r *http.Request) {
	type summary struct {
		store.Chat
		Replying bool `json:"replying"`
	}
	chats := s.store.ListChats()
	out := make([]summary, len(chats))
	for i, c := range chats {
		out[i] = summary{c, s.current(c.ID) != nil}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) updateChat(w http.ResponseWriter, r *http.Request) {
	var p store.ChatPatch
	if !decode(w, r, &p) {
		return
	}
	c, err := s.store.UpdateChat(r.PathValue("id"), p)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) deleteChat(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteChat(r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createChat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Model   string `json:"model"`
		AgentID string `json:"agentId"`
	}
	if !decode(w, r, &in) {
		return
	}
	var thinking string
	if in.AgentID != "" {
		a, err := s.store.GetAgent(in.AgentID)
		if err != nil {
			fail(w, err)
			return
		}
		if in.Model == "" {
			in.Model = a.Model
		}
		thinking = a.Thinking
	}
	if in.Model == "" {
		in.Model = s.defaultModel
	}
	if in.Model == "" {
		if ms, _ := s.listModels(r.Context()); len(ms) > 0 {
			in.Model = ms[0].ID
		}
	}
	if in.Model == "" {
		badRequest(w, "Pi has no models: sign in to a provider with `pi`, or set a provider's API key")
		return
	}
	c, err := s.store.CreateChat(store.Chat{Model: in.Model, Thinking: thinking, AgentID: in.AgentID})
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) getChat(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.GetChat(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	// Replying tells the page to follow the reply that is still being
	// written, which is not in the saved messages yet.
	writeJSON(w, http.StatusOK, struct {
		store.Chat
		Replying bool `json:"replying"`
	}{c, s.current(c.ID) != nil})
}

func (s *Server) listAgents(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.store.ListAgents())
}

// saveAgent creates an agent (POST) or replaces one (PUT).
func (s *Server) saveAgent(w http.ResponseWriter, r *http.Request) {
	var a store.Agent
	if !decode(w, r, &a) {
		return
	}
	a.ID = r.PathValue("id")
	if err := s.checkAgent(r.Context(), a); err != nil {
		fail(w, err)
		return
	}
	saved, err := s.store.SaveAgent(a)
	if err != nil {
		fail(w, err)
		return
	}
	status := http.StatusOK
	if a.ID == "" {
		status = http.StatusCreated
	}
	writeJSON(w, status, saved)
}

func (s *Server) deleteAgent(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteAgent(r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// plugins lists the plugins, with image generation off while Pi has no
// image model.
func (s *Server) plugins(ctx context.Context) []plugins.Plugin {
	ps := plugins.List(s.store.PluginOff)
	_, listed := s.imageModels.peek()
	for i := range ps {
		switch {
		case ps[i].ID != plugins.Images:
		case !listed:
			ps[i].Enabled = false
			ps[i].Unavailable = "Looking for image models in Pi."
		case s.imageModel(ctx) == "":
			ps[i].Enabled = false
			ps[i].Unavailable = noImageModel
		}
	}
	return ps
}

func (s *Server) pluginOn(id string) bool { return !s.store.PluginOff(id) }

func (s *Server) listPlugins(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.plugins(r.Context()))
}

func (s *Server) setPlugin(w http.ResponseWriter, r *http.Request) {
	p, ok := plugins.Find(r.PathValue("id"))
	if !ok {
		fail(w, store.ErrNotFound)
		return
	}
	var in struct {
		Enabled bool `json:"enabled"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.store.SetPluginOff(p.ID, !in.Enabled); err != nil {
		fail(w, err)
		return
	}
	p.Enabled = in.Enabled
	writeJSON(w, http.StatusOK, p)
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		badRequest(w, "invalid JSON body")
		return false
	}
	return true
}

func badRequest(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		badRequest(w, err.Error())
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}
