package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/aktech/harf/internal/store"
)

// mcpTestTimeout bounds a server test: Pi waits up to a minute for a
// server's answers.
const mcpTestTimeout = 75 * time.Second

// piTools are the built-in Pi tools an agent may list.
var piTools = []string{"read", "bash", "edit", "write", "grep", "find", "ls"}

var thinkingLevels = []string{"", "off", "minimal", "low", "medium", "high", "xhigh", "max"}

// checkAgent says what in the agent Pi or Harf does not have. It checks
// agents saved from the API and from a chat alike.
func (s *Server) checkAgent(ctx context.Context, a store.Agent) error {
	bad := store.Invalid
	if strings.TrimSpace(a.Name) == "" {
		return bad("an agent needs a name")
	}
	if !slices.Contains(thinkingLevels, a.Thinking) {
		return bad("thinking is one of %s, not %s", strings.Join(thinkingLevels[1:], ", "), a.Thinking)
	}
	if a.Model != "" {
		ms, err := s.listModels(ctx)
		if err != nil && len(ms) == 0 {
			return fmt.Errorf("list Pi's models: %w", err)
		}
		ids := make([]string, len(ms))
		for i, m := range ms {
			ids[i] = m.ID
		}
		if !slices.Contains(ids, a.Model) {
			return bad("Pi has no model %s. The models are: %s", a.Model, strings.Join(ids, ", "))
		}
	}
	for _, t := range a.Tools {
		if !slices.Contains(piTools, t) {
			return bad("%s is not a Pi tool. The tools are: %s", t, strings.Join(piTools, ", "))
		}
	}
	for _, n := range a.MCP {
		if _, err := s.store.GetMCP(n); err != nil {
			return bad("there is no MCP server named %s. The servers are: %s", n, strings.Join(s.mcpNames(), ", "))
		}
	}
	return nil
}

func (s *Server) mcpNames() []string {
	var out []string
	for _, m := range s.store.ListMCP() {
		out = append(out, m.Name)
	}
	return out
}

// agentTool answers the agent builder tools a chat's model calls.
func (s *Server) agentTool(ctx context.Context, op string, args json.RawMessage) (any, error) {
	switch op {
	case "list_agents":
		return s.agentChoices(ctx), nil
	case "create_agent":
		var a store.Agent
		if err := strictJSON(args, &a); err != nil {
			return nil, err
		}
		a.ID = ""
		return s.saveCheckedAgent(ctx, a)
	case "update_agent":
		var in struct {
			ID string `json:"id"`
		}
		json.Unmarshal(args, &in)
		a, err := s.store.GetAgent(in.ID)
		if err != nil {
			return nil, fmt.Errorf("there is no agent with id %q: list_agents lists them", in.ID)
		}
		// Only the fields given change.
		if err := strictJSON(args, &a); err != nil {
			return nil, err
		}
		a.ID = in.ID
		return s.saveCheckedAgent(ctx, a)
	}
	return nil, fmt.Errorf("no such tool %s", op)
}

func (s *Server) saveCheckedAgent(ctx context.Context, a store.Agent) (any, error) {
	if err := s.checkAgent(ctx, a); err != nil {
		return nil, err
	}
	saved, err := s.store.SaveAgent(a)
	if err != nil {
		return nil, err
	}
	return map[string]any{"agent": saved,
		"note": "Saved. The reply shows the agent with a button to start a chat with it, so do not repeat its settings."}, nil
}

// agentChoices is what list_agents answers: the agents, and what an agent
// can be given.
func (s *Server) agentChoices(ctx context.Context) map[string]any {
	type brief struct {
		ID          string   `json:"id"`
		Name        string   `json:"name"`
		Description string   `json:"description,omitempty"`
		Model       string   `json:"model,omitempty"`
		Thinking    string   `json:"thinking,omitempty"`
		Tools       []string `json:"tools"`
		MCP         []string `json:"mcp"`
	}
	agents := []brief{}
	for _, a := range s.store.ListAgents() {
		agents = append(agents, brief{a.ID, a.Name, a.Description, a.Model, a.Thinking, a.Tools, a.MCP})
	}
	models := []string{}
	ms, _ := s.listModels(ctx)
	for _, m := range ms {
		models = append(models, m.ID)
	}
	type server struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	servers := []server{}
	for _, m := range s.store.ListMCP() {
		servers = append(servers, server{m.Name, m.Enabled})
	}
	return map[string]any{"agents": agents, "models": models, "tools": piTools, "mcpServers": servers,
		"thinking": thinkingLevels[1:]}
}

// strictJSON decodes data into v and names any field v does not have, so
// a model that misspells one hears about it.
func strictJSON(data json.RawMessage, v any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return fmt.Errorf("read the arguments: %w", err)
	}
	return nil
}
