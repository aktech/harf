package pi

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"

	"github.com/aktech/harf/internal/store"
)

// agentTools are the tools the agent builder extension adds.
var agentTools = []string{"create_agent", "update_agent", "list_agents"}

// answerAgentTool answers the agent builder extension: it asks Harf
// through an editor dialog titled harf:<tool>, prefilled with the call's
// arguments, and reads {"result": ...} or {"error": "..."} back.
func answerAgentTool(ctx context.Context, fn func(context.Context, string, json.RawMessage) (any, error), title, prefill string) (string, bool) {
	op, ok := strings.CutPrefix(title, "harf:")
	if !ok || !slices.Contains(agentTools, op) {
		return "", false
	}
	if strings.TrimSpace(prefill) == "" {
		prefill = "{}"
	}
	var out any
	if res, err := fn(ctx, op, json.RawMessage(prefill)); err != nil {
		out = map[string]string{"error": err.Error()}
	} else {
		out = map[string]any{"result": res}
	}
	b, err := json.Marshal(out)
	if err != nil {
		b, _ = json.Marshal(map[string]string{"error": err.Error()})
	}
	return string(b), true
}

// mcpTools are the --tools patterns that keep the servers' tools.
func mcpTools(servers []store.MCPServer) []string {
	out := make([]string, len(servers))
	for i, m := range servers {
		out[i] = "mcp__" + store.MCPNamespace(m.Name) + "__*"
	}
	return out
}

// writeMCP writes the servers, in Pi's mcpServers shape, to a file only
// this user can read, and returns its path; "" when there are none. The
// MCP extension reads it when Pi starts, so the secrets in it never reach
// Pi's command line, and the caller removes it once Pi is done.
func (r *Runner) writeMCP(servers []store.MCPServer) (string, error) {
	if len(servers) == 0 || r.MCPExtension == "" {
		return "", nil
	}
	cfg := map[string]any{}
	for _, m := range servers {
		// Direct tools are declared to the model like built-in ones, so
		// each call shows as its own step in the reply.
		// Pi refuses a server whose optional fields are null.
		cfg[m.Name] = struct {
			Command  string            `json:"command,omitempty"`
			Args     []string          `json:"args,omitempty"`
			Env      map[string]string `json:"env,omitempty"`
			URL      string            `json:"url,omitempty"`
			Headers  map[string]string `json:"headers,omitempty"`
			Exposure string            `json:"exposure"`
		}{m.Command, m.Args, m.Env, m.URL, m.Headers, "direct"}
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	f, err := os.CreateTemp("", "harf-mcp-*.json") // 0600
	if err != nil {
		return "", err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// MCPCheck is what Pi saw when it connected to an MCP server.
type MCPCheck struct {
	// State is Pi's word for the connection: connected, failed,
	// needs sign-in, overridden (the user's own Pi settings have a server
	// with this name) and so on.
	State string    `json:"state"`
	Error string    `json:"error,omitempty"`
	Tools []MCPTool `json:"tools"`
}

type MCPTool struct {
	Name        string `json:"name"` // as the server names it
	Description string `json:"description,omitempty"`
}

// CheckMCP has Pi connect to the server, with no model and no session,
// and reports its tools or why it did not connect.
func (r *Runner) CheckMCP(ctx context.Context, m store.MCPServer) (MCPCheck, error) {
	m.Enabled = true
	file, err := r.writeMCP([]store.MCPServer{m})
	if err != nil {
		return MCPCheck{}, err
	}
	if file == "" {
		return MCPCheck{}, errors.New("MCP is not set up")
	}
	defer os.Remove(file)
	// No other extensions: only Pi's MCP support and Harf's.
	p, err := r.start([]string{"--mode", "rpc", "--no-session", "--no-skills", "--no-prompt-templates", "--no-context-files",
		"--no-extensions", "-e", "builtin:mcp", "-e", r.MCPExtension, "--harf-mcp", file})
	if err != nil {
		return MCPCheck{}, err
	}
	defer p.close()
	// /mcp waits for the servers to connect, then reports each one.
	status, err := p.command(ctx, "/mcp")
	if err != nil {
		return MCPCheck{}, err
	}
	c := parseMCPStatus(string(status), m.Name)
	if c.State != "connected" {
		return c, nil
	}
	data, err := p.command(ctx, "/harf-mcp-tools "+m.Name)
	if err != nil {
		return MCPCheck{}, err
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return MCPCheck{}, errors.New("read the server's tools: " + err.Error())
	}
	return c, nil
}

// parseMCPStatus reads the server's line from Pi's /mcp report:
//
//	name: state[, n tools] (exposure)
//	    error lines
func parseMCPStatus(status, name string) MCPCheck {
	c := MCPCheck{Tools: []MCPTool{}}
	lines := strings.Split(status, "\n")
	for i, l := range lines {
		rest, ok := strings.CutPrefix(l, name+": ")
		if !ok {
			if strings.HasPrefix(l, `overridden: "`+name+`"`) {
				c.State, c.Error = "overridden", strings.TrimPrefix(l, "overridden: ")
				return c
			}
			continue
		}
		if j := strings.IndexAny(rest, ",("); j >= 0 {
			rest = rest[:j]
		}
		c.State = strings.TrimSpace(rest)
		var errs []string
		for _, e := range lines[i+1:] {
			e, ok := strings.CutPrefix(e, "    ")
			if !ok {
				break
			}
			errs = append(errs, e)
		}
		c.Error = strings.TrimSpace(strings.Join(errs, "\n"))
		return c
	}
	c.State, c.Error = "unknown", strings.TrimSpace(status)
	return c
}
