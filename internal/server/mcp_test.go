package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/store"
)

// raw does a request and returns its status and body as text.
func (h *harness) raw(method, path string, body any) (int, string) {
	h.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, h.srv.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(out)
}

func (h *harness) addMCP(m map[string]any) {
	h.t.Helper()
	if code, body := h.raw("POST", "/api/mcp", m); code != 201 {
		h.t.Fatalf("add %v: %d %s", m["name"], code, body)
	}
}

// piServers sends a message in a new chat (with agentID, if any) and
// returns the MCP servers Pi got, by name.
func (h *harness) piServers(agentID string) map[string]store.MCPServer {
	h.t.Helper()
	c := h.newChat(map[string]any{"agentId": agentID})
	h.send(c.ID, map[string]any{"content": "roll"})
	out := map[string]store.MCPServer{}
	for _, m := range h.agent.lastSpec().MCP {
		out[m.Name] = m
	}
	return out
}

func TestMCPSecretsNeverReachTheBrowserAndStayWhenUnchanged(t *testing.T) {
	h := newHarness(t, echo)
	h.addMCP(map[string]any{"name": "dice", "command": "node", "args": []string{"dice.mjs"},
		"env": map[string]string{"DICE_WORD": "plum", "MODE": "fast"}, "enabled": true})
	h.addMCP(map[string]any{"name": "docs", "url": "https://mcp.example.com/mcp",
		"headers": map[string]string{"Authorization": "Bearer t-1"}, "enabled": true})

	_, list := h.raw("GET", "/api/mcp", nil)
	if strings.Contains(list, "plum") || strings.Contains(list, "fast") || strings.Contains(list, "t-1") {
		t.Fatalf("secrets in the list: %s", list)
	}
	var got []store.MCPServer
	json.Unmarshal([]byte(list), &got)
	if len(got) != 2 || got[0].Env["DICE_WORD"] != secretMask || got[0].Args[0] != "dice.mjs" || got[1].Headers["Authorization"] != secretMask {
		t.Fatalf("list %+v", got)
	}

	// The masked value sent back keeps the secret; others replace or add.
	code, body := h.raw("PUT", "/api/mcp/dice", map[string]any{"name": "dice", "command": "node",
		"env": map[string]string{"DICE_WORD": secretMask, "MODE": "slow"}, "enabled": true})
	if code != 200 || strings.Contains(body, "plum") || strings.Contains(body, "slow") {
		t.Fatalf("update: %d %s", code, body)
	}
	if env := h.piServers("")["dice"].Env; env["DICE_WORD"] != "plum" || env["MODE"] != "slow" || len(env) != 2 {
		t.Fatalf("pi got env %v", env)
	}
}

func TestMCPServersAreCheckedAndRemoved(t *testing.T) {
	h := newHarness(t, echo)
	h.addMCP(map[string]any{"name": "dice", "command": "node", "enabled": true})
	for _, c := range []struct {
		method, path string
		body         any
		want         int
	}{
		{"POST", "/api/mcp", map[string]any{"name": "two words", "command": "node"}, 400},
		{"POST", "/api/mcp", map[string]any{"name": "dice", "command": "node"}, 400},
		{"POST", "/api/mcp", map[string]any{"name": "new", "command": "node", "env": map[string]string{"K": secretMask}}, 400},
		{"PUT", "/api/mcp/dice", map[string]any{"name": "other", "command": "node"}, 400},
		{"PUT", "/api/mcp/ghost", map[string]any{"name": "ghost", "command": "node"}, 404},
		{"DELETE", "/api/mcp/dice", nil, 204},
		{"DELETE", "/api/mcp/dice", nil, 404},
	} {
		if code, body := h.raw(c.method, c.path, c.body); code != c.want {
			t.Errorf("%s %s %v: %d %s, want %d", c.method, c.path, c.body, code, body, c.want)
		}
	}
}

func TestEachAgentGetsItsEnabledMCPServers(t *testing.T) {
	h := newHarness(t, echo)
	h.addMCP(map[string]any{"name": "dice", "command": "node", "enabled": true})
	h.addMCP(map[string]any{"name": "docs", "url": "https://mcp.example.com/mcp", "enabled": true})
	h.addMCP(map[string]any{"name": "off", "command": "node", "enabled": false})

	names := func(m map[string]store.MCPServer) string {
		var out []string
		for n := range m {
			out = append(out, n)
		}
		slices.Sort(out)
		return strings.Join(out, ",")
	}
	if got := names(h.piServers("")); got != "dice,docs" {
		t.Errorf("plain chat: %s", got)
	}
	for _, c := range []struct {
		mcp  []string
		want string
	}{{nil, "dice,docs"}, {[]string{"docs", "off"}, "docs"}, {[]string{}, ""}} {
		var a store.Agent
		if resp := h.do("POST", "/api/agents", map[string]any{"name": "A", "mcp": c.mcp}, &a); resp.StatusCode != 201 {
			t.Fatalf("agent: %d", resp.StatusCode)
		}
		if got := names(h.piServers(a.ID)); got != c.want {
			t.Errorf("agent with %#v: %s, want %s", c.mcp, got, c.want)
		}
	}
}

func TestTestingAServerUsesItsSavedSecrets(t *testing.T) {
	h := newHarness(t, echo)
	h.agent.check = pi.MCPCheck{State: "connected", Tools: []pi.MCPTool{{Name: "roll_dice"}}}
	h.addMCP(map[string]any{"name": "dice", "command": "node", "env": map[string]string{"DICE_WORD": "plum"}, "enabled": false})

	var got pi.MCPCheck
	resp := h.do("POST", "/api/mcp/test", map[string]any{"name": "dice", "command": "node", "args": []string{"v2.mjs"},
		"env": map[string]string{"DICE_WORD": secretMask}}, &got)
	if resp.StatusCode != 200 || got.State != "connected" || got.Tools[0].Name != "roll_dice" {
		t.Fatalf("test: %d %+v", resp.StatusCode, got)
	}
	m := h.agent.checked[0]
	if m.Env["DICE_WORD"] != "plum" || m.Args[0] != "v2.mjs" {
		t.Errorf("pi checked %+v", m)
	}
	if code, _ := h.raw("POST", "/api/mcp/test", map[string]any{"name": "dice"}); code != 400 {
		t.Errorf("test without a command or URL: %d", code)
	}
}

func TestAgentsMustNameWhatExists(t *testing.T) {
	h := newHarness(t, echo)
	h.addMCP(map[string]any{"name": "dice", "command": "node", "enabled": true})
	for _, a := range []map[string]any{
		{"name": "A", "model": "fake/none"},
		{"name": "A", "tools": []string{"read", "fly"}},
		{"name": "A", "mcp": []string{"ghost"}},
		{"name": "A", "thinking": "huge"},
		{"name": " "},
	} {
		if code, body := h.raw("POST", "/api/agents", a); code != 400 {
			t.Errorf("%v: %d %s", a, code, body)
		}
	}
	if code, body := h.raw("POST", "/api/agents", map[string]any{"name": "A", "model": "fake/big", "thinking": "high",
		"tools": []string{"read", "grep"}, "mcp": []string{"dice"}}); code != 201 {
		t.Errorf("valid agent: %d %s", code, body)
	}
}

// agentTool calls an agent builder tool the way Pi would in the last reply.
func (h *harness) agentTool(op string, args any) (map[string]any, error) {
	h.t.Helper()
	fn := h.agent.lastSpec().AgentTools
	if fn == nil {
		h.t.Fatal("pi got no agent builder tools")
	}
	b, _ := json.Marshal(args)
	res, err := fn(context.Background(), op, b)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	b, _ = json.Marshal(res)
	json.Unmarshal(b, &out)
	return out, nil
}

func TestAChatCanCreateAndChangeAnAgent(t *testing.T) {
	h := newHarness(t, echo)
	h.addMCP(map[string]any{"name": "dice", "command": "node", "enabled": true})
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "make me a Go reviewer, no bash"})
	if !strings.Contains(h.agent.lastSpec().System, "create_agent") {
		t.Errorf("pi was not told about the tools: %q", h.agent.lastSpec().System)
	}

	list, err := h.agentTool("list_agents", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(list); !strings.Contains(string(b), `"fake/big"`) || !strings.Contains(string(b), `"grep"`) || !strings.Contains(string(b), `"dice"`) {
		t.Errorf("list_agents = %s", b)
	}

	if _, err := h.agentTool("create_agent", map[string]any{"name": "Go reviewer", "model": "claude-sonnet"}); err == nil || !strings.Contains(err.Error(), "fake/big") {
		t.Errorf("unknown model: %v", err)
	}
	made, err := h.agentTool("create_agent", map[string]any{"name": "Go reviewer", "systemPrompt": "Review Go code.",
		"model": "fake/big", "tools": []string{"read", "grep"}, "mcp": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	agent := made["agent"].(map[string]any)
	id := agent["id"].(string)
	saved := h.agentByID(id)
	if saved.Name != "Go reviewer" || saved.Model != "fake/big" || strings.Join(saved.Tools, ",") != "read,grep" || saved.MCP == nil || len(saved.MCP) != 0 {
		t.Fatalf("saved %+v", saved)
	}

	if _, err := h.agentTool("update_agent", map[string]any{"id": id, "thinking": "high"}); err != nil {
		t.Fatal(err)
	}
	if got := h.agentByID(id); got.Thinking != "high" || got.SystemPrompt != "Review Go code." || got.Model != "fake/big" {
		t.Errorf("after update %+v", got)
	}
	if _, err := h.agentTool("update_agent", map[string]any{"id": "ghost"}); err == nil {
		t.Error("updated an agent that does not exist")
	}

	// The new agent's chats work like any other.
	if s := h.piServers(id); len(s) != 0 || strings.Join(h.agent.lastSpec().Tools, ",") != "read,grep" {
		t.Errorf("agent chat got %+v", h.agent.lastSpec())
	}
}

func TestAgentBuilderTurnedOffGivesPiNoTools(t *testing.T) {
	h := newHarness(t, echo)
	h.do("PUT", "/api/plugins/agent-builder", map[string]any{"enabled": false}, nil)
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "x"})
	if s := h.agent.lastSpec(); s.AgentTools != nil || strings.Contains(s.System, "create_agent") {
		t.Errorf("pi got %+v", s)
	}
}

func (h *harness) agentByID(id string) store.Agent {
	h.t.Helper()
	var list []store.Agent
	h.do("GET", "/api/agents", nil, &list)
	for _, a := range list {
		if a.ID == id {
			return a
		}
	}
	h.t.Fatalf("no agent %s", id)
	return store.Agent{}
}

func TestEveryChatIsToldItCanMakeAgents(t *testing.T) {
	h := newHarness(t, echo)
	for _, tools := range [][]string{nil, {"read"}, {}} {
		var a store.Agent
		h.do("POST", "/api/agents", map[string]any{"name": "Helper", "systemPrompt": "Be kind.", "tools": tools}, &a)
		for _, agentID := range []string{"", a.ID} {
			c := h.newChat(map[string]any{"agentId": agentID})
			h.send(c.ID, map[string]any{"content": "x"})
			s := h.agent.lastSpec()
			if s.AgentTools == nil || !strings.Contains(s.System, "create_agent") || !strings.Contains(s.System, "persona") {
				t.Errorf("agent %q with tools %#v: pi got tools %v, system %q", agentID, tools, s.AgentTools != nil, s.System)
			}
		}
	}
}

func TestNoMCPServersIsAnEmptyListNotNull(t *testing.T) {
	h := newHarness(t, echo)
	resp, err := http.Get(h.srv.URL + "/api/mcp")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if got := strings.TrimSpace(string(b)); got != "[]" {
		t.Fatalf("body %s", got)
	}
}
