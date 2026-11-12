// Package store keeps chats and agents as JSON files in one directory.
// Each chat is its own file, so one bad write cannot lose the others.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

var ErrNotFound = errors.New("not found")

type Message struct {
	ID      string `json:"id"`
	Role    string `json:"role"` // user | assistant
	Content string `json:"content"`
	// Parts is what an agent did for a reply, in order: text, thinking and
	// tool calls. Content is the reply's text alone.
	Parts []Part `json:"parts,omitempty"`
	// Attachments are the files sent with a user message.
	Attachments []Attachment `json:"attachments,omitempty"`
	Model       string       `json:"model,omitempty"`
	Error       string       `json:"error,omitempty"`
	// Usage is what a reply cost in tokens and time; nil when the model
	// reported none, as for messages saved before it was kept.
	Usage     *Usage    `json:"usage,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Usage sums what the model reported for every call a reply made (a reply
// that runs tools calls the model again after each round), plus how long
// the reply took.
type Usage struct {
	Input      int64   `json:"input"`
	Output     int64   `json:"output"` // includes Reasoning
	CacheRead  int64   `json:"cacheRead,omitempty"`
	CacheWrite int64   `json:"cacheWrite,omitempty"`
	Reasoning  int64   `json:"reasoning,omitempty"`
	Cost       float64 `json:"cost,omitempty"`    // US dollars, as Pi prices the model
	Calls      int     `json:"calls"`             // model calls the reply made
	FirstMs    int64   `json:"firstMs,omitempty"` // prompt sent to first text or thinking
	Ms         int64   `json:"ms,omitempty"`      // prompt sent to reply finished
	// StreamMs is the time the model spent streaming its calls, from each
	// call's first token to its end; Output over it is the output speed.
	StreamMs int64 `json:"streamMs,omitempty"`
}

type Chat struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Model    string `json:"model"`
	Thinking string `json:"thinking,omitempty"` // Pi thinking level; empty uses Pi's default
	AgentID  string `json:"agentId,omitempty"`
	// Session is the Pi session holding the chat's context. It starts as
	// the chat's id and changes when an edit forks the conversation.
	Session   string    `json:"session,omitempty"`
	Pinned    bool      `json:"pinned,omitempty"`
	Messages  []Message `json:"messages"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Agent is a reusable persona: instructions added to Pi's system prompt,
// the tools Pi may use, and default model settings for its chats.
type Agent struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Icon         string `json:"icon,omitempty"`
	Description  string `json:"description,omitempty"`
	SystemPrompt string `json:"systemPrompt"`
	Model        string `json:"model,omitempty"`
	Thinking     string `json:"thinking,omitempty"`
	// Tools lists the Pi tools the agent may use: nil keeps Pi's defaults,
	// an empty list allows none.
	Tools []string `json:"tools"`
	// MCP names the MCP servers the agent may use: nil uses every enabled
	// server, an empty list none.
	MCP       []string  `json:"mcp"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Store struct {
	dir    string
	mu     sync.Mutex
	chats  map[string]*Chat
	agents map[string]Agent
	off    map[string]bool // plugins turned off; every other plugin is on
	image  string          // the image model chosen for image generation
	mcp    []MCPServer     // sorted by name
}

// settings is what settings.json holds. Plugins are listed when turned
// off, so a plugin added later starts on.
type settings struct {
	PluginsOff []string `json:"pluginsOff"`
	// ImageModel is the image model (provider/id) that makes images; empty
	// uses the first one Pi has.
	ImageModel string `json:"imageModel,omitempty"`
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "chats"), 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, chats: map[string]*Chat{}, agents: map[string]Agent{}, off: map[string]bool{}}
	var set settings
	if err := readJSON(s.settingsPath(), &set); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read settings: %w", err)
	}
	for _, id := range set.PluginsOff {
		s.off[id] = true
	}
	s.image = set.ImageModel
	var agents []Agent
	if err := readJSON(s.agentsPath(), &agents); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read agents: %w", err)
	}
	for _, a := range agents {
		s.agents[a.ID] = a
	}
	if err := readJSON(s.mcpPath(), &s.mcp); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read MCP servers: %w", err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "chats", "*.json"))
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		var c Chat
		if err := readJSON(f, &c); err != nil {
			return nil, fmt.Errorf("read %s: %w", f, err)
		}
		s.chats[c.ID] = &c
	}
	return s, nil
}

func (s *Store) CreateChat(c Chat) (Chat, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	c.ID = newID()
	c.CreatedAt, c.UpdatedAt = now, now
	if c.Messages == nil {
		c.Messages = []Message{}
	}
	if err := s.saveChat(&c); err != nil {
		return Chat{}, err
	}
	s.chats[c.ID] = &c
	return clone(&c), nil
}

func (s *Store) GetChat(id string) (Chat, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.chats[id]
	if !ok {
		return Chat{}, ErrNotFound
	}
	return clone(c), nil
}

// ListChats returns every chat without its messages: pinned chats first,
// then the most recently updated.
func (s *Store) ListChats() []Chat {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Chat, 0, len(s.chats))
	for _, c := range s.chats {
		x := *c
		x.Messages = nil
		out = append(out, x)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

// ChatPatch changes only the fields that are set.
type ChatPatch struct {
	Title    *string `json:"title"`
	Model    *string `json:"model"`
	AgentID  *string `json:"agentId"`
	Pinned   *bool   `json:"pinned"`
	Thinking *string `json:"thinking"`
	// Session is set by the server after a fork, never by a request.
	Session *string `json:"-"`
}

func (s *Store) UpdateChat(id string, p ChatPatch) (Chat, error) {
	return s.mutate(id, func(c *Chat) error {
		if p.Title != nil {
			c.Title = *p.Title
		}
		if p.Model != nil {
			c.Model = *p.Model
		}
		if p.AgentID != nil {
			c.AgentID = *p.AgentID
		}
		if p.Pinned != nil {
			c.Pinned = *p.Pinned
		}
		if p.Thinking != nil {
			c.Thinking = *p.Thinking
		}
		if p.Session != nil {
			c.Session = *p.Session
		}
		return nil
	})
}

// mutate applies fn to a copy of the chat and keeps the copy only once it
// is on disk.
func (s *Store) mutate(id string, fn func(*Chat) error) (Chat, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.chats[id]
	if !ok {
		return Chat{}, ErrNotFound
	}
	next := clone(c)
	if err := fn(&next); err != nil {
		return Chat{}, err
	}
	next.UpdatedAt = time.Now().UTC()
	if err := s.saveChat(&next); err != nil {
		return Chat{}, err
	}
	s.chats[id] = &next
	return clone(&next), nil
}

func (s *Store) AppendMessage(chatID string, m Message) (Message, error) {
	m.ID = newID()
	m.CreatedAt = time.Now().UTC()
	_, err := s.mutate(chatID, func(c *Chat) error {
		c.Messages = append(c.Messages, m)
		return nil
	})
	return m, err
}

// TruncateFrom removes the message msgID and every message after it, so a
// conversation can be resumed from an earlier point (edit, regenerate).
func (s *Store) TruncateFrom(chatID, msgID string) (Chat, error) {
	return s.mutate(chatID, func(c *Chat) error {
		for i, m := range c.Messages {
			if m.ID == msgID {
				c.Messages = c.Messages[:i]
				return nil
			}
		}
		return ErrNotFound
	})
}

func (s *Store) DeleteChat(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.chats[id]; !ok {
		return ErrNotFound
	}
	if err := os.Remove(s.chatPath(id)); err != nil {
		return err
	}
	delete(s.chats, id)
	return nil
}

// SaveAgent creates the agent when its ID is empty and replaces it otherwise.
func (s *Store) SaveAgent(a Agent) (Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	if a.ID == "" {
		a.ID = newID()
		a.CreatedAt = now
	} else if old, ok := s.agents[a.ID]; ok {
		a.CreatedAt = old.CreatedAt
	} else {
		return Agent{}, ErrNotFound
	}
	a.UpdatedAt = now
	next := s.agentsWith(a.ID, &a)
	if err := writeJSON(s.agentsPath(), next); err != nil {
		return Agent{}, err
	}
	s.agents[a.ID] = a
	return a, nil
}

func (s *Store) GetAgent(id string) (Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.agents[id]
	if !ok {
		return Agent{}, ErrNotFound
	}
	return a, nil
}

func (s *Store) ListAgents() []Agent {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.agentsWith("", nil)
}

func (s *Store) DeleteAgent(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.agents[id]; !ok {
		return ErrNotFound
	}
	if err := writeJSON(s.agentsPath(), s.agentsWith(id, nil)); err != nil {
		return err
	}
	delete(s.agents, id)
	return nil
}

// agentsWith lists the agents sorted by name, with the agent id replaced by
// a (or removed when a is nil).
func (s *Store) agentsWith(id string, a *Agent) []Agent {
	out := make([]Agent, 0, len(s.agents)+1)
	for k, v := range s.agents {
		if k != id {
			out = append(out, v)
		}
	}
	if a != nil {
		out = append(out, *a)
	}
	return byName(out)
}

func byName(agents []Agent) []Agent {
	sort.Slice(agents, func(i, j int) bool { return agents[i].Name < agents[j].Name })
	return agents
}

// PluginOff reports whether the plugin id is turned off.
func (s *Store) PluginOff(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.off[id]
}

// SetPluginOff turns the plugin id off or back on.
func (s *Store) SetPluginOff(id string, off bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := map[string]bool{}
	for k := range s.off {
		if k != id {
			next[k] = true
		}
	}
	if off {
		next[id] = true
	}
	if err := s.saveSettings(next, s.image); err != nil {
		return err
	}
	s.off = next
	return nil
}

// ImageModel is the image model chosen for image generation; empty means
// none was chosen.
func (s *Store) ImageModel() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.image
}

// SetImageModel chooses the image model, as provider/id; empty clears it.
func (s *Store) SetImageModel(model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.saveSettings(s.off, model); err != nil {
		return err
	}
	s.image = model
	return nil
}

// saveSettings writes settings.json. The caller holds s.mu.
func (s *Store) saveSettings(off map[string]bool, image string) error {
	set := settings{PluginsOff: []string{}, ImageModel: image}
	for k := range off {
		set.PluginsOff = append(set.PluginsOff, k)
	}
	sort.Strings(set.PluginsOff)
	return writeJSON(s.settingsPath(), set)
}

func (s *Store) settingsPath() string { return filepath.Join(s.dir, "settings.json") }

func (s *Store) agentsPath() string { return filepath.Join(s.dir, "agents.json") }

// mcpPath holds the MCP servers, secrets included. writeJSON makes every
// file readable by its owner only.
func (s *Store) mcpPath() string { return filepath.Join(s.dir, "mcp.json") }

func (s *Store) saveChat(c *Chat) error {
	return writeJSON(s.chatPath(c.ID), c)
}

func (s *Store) chatPath(id string) string {
	return filepath.Join(s.dir, "chats", id+".json")
}

func clone(c *Chat) Chat {
	out := *c
	out.Messages = append([]Message{}, c.Messages...)
	return out
}

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// Remembered reads what Remember last kept under name into v; false when
// nothing was kept or it no longer reads.
func (s *Store) Remembered(name string, v any) bool {
	b, err := os.ReadFile(filepath.Join(s.dir, "cache-"+name+".json"))
	return err == nil && json.Unmarshal(b, v) == nil
}

// Remember keeps v under name across restarts, such as the models Pi
// last listed.
func (s *Store) Remember(name string, v any) error {
	return writeJSON(filepath.Join(s.dir, "cache-"+name+".json"), v)
}

// writeJSON writes to a temp file then renames it, so a crash mid-write
// leaves the old file in place instead of a truncated one.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// Attachment is a file sent with a message, saved in Pi's workspace.
type Attachment struct {
	Name string `json:"name"` // as the user named it
	Path string `json:"path"` // relative to the workspace
	Type string `json:"type"` // media type, such as image/png
	Size int64  `json:"size"`
}

// Part is one piece of a reply: text, thinking, or a tool call.
type Part struct {
	Type string `json:"type"` // text | thinking | tool
	Text string `json:"text,omitempty"`
	Tool *Tool  `json:"tool,omitempty"`
}

type Tool struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Args   json.RawMessage `json:"args,omitempty"`
	Output string          `json:"output,omitempty"`
	Status string          `json:"status"` // pending | running | done | error
	Ms     int64           `json:"ms,omitempty"`
}
