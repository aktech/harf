package store

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
)

// ErrInvalid matches the errors that say why a value cannot be saved.
var ErrInvalid = errors.New("invalid")

type invalid string

func (e invalid) Error() string      { return string(e) }
func (invalid) Is(target error) bool { return target == ErrInvalid }

// Invalid is an error that says why a value cannot be saved; it matches
// ErrInvalid.
func Invalid(format string, args ...any) error { return invalid(fmt.Sprintf(format, args...)) }

// MCPServer is an MCP server Pi connects to during replies: either a
// command Pi starts on this machine (stdio), or a URL (streamable HTTP).
// Env and Headers often hold secrets.
type MCPServer struct {
	Name      string            `json:"name"` // letters, digits, _ and -; never changes
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	URL       string            `json:"url,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Enabled   bool              `json:"enabled"`
	CreatedAt time.Time         `json:"createdAt"`
	UpdatedAt time.Time         `json:"updatedAt"`
}

var mcpName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// MCPNamespace is the server's part of its tools' names in Pi:
// mcp__<namespace>__<tool>. Pi treats - and _ in server names alike.
func MCPNamespace(name string) string { return strings.ReplaceAll(name, "-", "_") }

// Check reports what keeps Pi from using the server.
func (m MCPServer) Check() error {
	switch {
	case !mcpName.MatchString(m.Name):
		return Invalid("a server name may hold only letters, digits, _ and -")
	case (m.Command == "") == (m.URL == ""):
		return Invalid("give a command to run or a URL, not both")
	case m.URL != "":
		if u, err := url.Parse(m.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return Invalid("the URL must start with http:// or https://")
		}
	}
	return nil
}

// ListMCP returns the MCP servers sorted by name.
func (s *Store) ListMCP() []MCPServer {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]MCPServer{}, s.mcp...) // never nil: the API answers []
}

func (s *Store) GetMCP(name string) (MCPServer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if i := s.mcpIndex(name); i >= 0 {
		return s.mcp[i], nil
	}
	return MCPServer{}, ErrNotFound
}

// AddMCP saves a new server. Its name must not be taken, also not with -
// and _ swapped, as Pi would see one server.
func (s *Store) AddMCP(m MCPServer) (MCPServer, error) {
	if err := m.Check(); err != nil {
		return MCPServer{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, o := range s.mcp {
		if MCPNamespace(o.Name) == MCPNamespace(m.Name) {
			return MCPServer{}, Invalid("there is already a server named %s", o.Name)
		}
	}
	m.CreatedAt = time.Now().UTC()
	m.UpdatedAt = m.CreatedAt
	next := append(slices.Clone(s.mcp), m)
	sort.Slice(next, func(i, j int) bool { return next[i].Name < next[j].Name })
	return m, s.saveMCP(next, nil)
}

// UpdateMCP replaces the server with the same name.
func (s *Store) UpdateMCP(m MCPServer) (MCPServer, error) {
	if err := m.Check(); err != nil {
		return MCPServer{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.mcpIndex(m.Name)
	if i < 0 {
		return MCPServer{}, ErrNotFound
	}
	m.CreatedAt, m.UpdatedAt = s.mcp[i].CreatedAt, time.Now().UTC()
	next := slices.Clone(s.mcp)
	next[i] = m
	return m, s.saveMCP(next, nil)
}

// DeleteMCP removes the server and takes it out of the agents that named
// it. An agent left with no servers keeps none: it never meant all.
func (s *Store) DeleteMCP(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.mcpIndex(name)
	if i < 0 {
		return ErrNotFound
	}
	var agents []Agent
	for _, a := range s.agents {
		if slices.Contains(a.MCP, name) {
			a.MCP = slices.DeleteFunc(slices.Clone(a.MCP), func(n string) bool { return n == name })
		}
		agents = append(agents, a)
	}
	return s.saveMCP(slices.Delete(slices.Clone(s.mcp), i, i+1), agents)
}

// saveMCP writes the servers, and the agents when given, then keeps them.
// The caller holds s.mu.
func (s *Store) saveMCP(servers []MCPServer, agents []Agent) error {
	if agents != nil {
		if err := writeJSON(s.agentsPath(), byName(agents)); err != nil {
			return err
		}
		for _, a := range agents {
			s.agents[a.ID] = a
		}
	}
	if err := writeJSON(s.mcpPath(), servers); err != nil {
		return err
	}
	s.mcp = servers
	return nil
}

func (s *Store) mcpIndex(name string) int {
	return slices.IndexFunc(s.mcp, func(m MCPServer) bool { return m.Name == name })
}
