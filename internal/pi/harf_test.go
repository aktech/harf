package pi

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/aktech/harf/internal/store"
)

func TestMCPServersReachPiInAPrivateFileRemovedAfterTheReply(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(settled)})
	r.MCPExtension = "/data/pi/mcp.js"
	r.Run(context.Background(), Spec{Session: "s", Prompt: "roll", Tools: []string{"read"}, MCP: []store.MCPServer{
		{Name: "dice-box", Command: "node", Args: []string{"dice.mjs"}, Env: map[string]string{"DICE_WORD": "plum"}, Enabled: true},
		{Name: "docs", URL: "https://mcp.example.com/mcp", Headers: map[string]string{"Authorization": "Bearer t-1"}, Enabled: true},
	}}, func(Event) {})

	l := log()
	args := strings.Join(l.Args, " ")
	for _, want := range []string{"--extension /data/pi/mcp.js", "--tools read,mcp__dice_box__*,mcp__docs__*"} {
		if !strings.Contains(args, want) {
			t.Errorf("args %q lack %q", args, want)
		}
	}
	var got map[string]map[string]any
	if err := json.Unmarshal(l.MCP, &got); err != nil {
		t.Fatalf("pi got %s: %v", l.MCP, err)
	}
	dice, docs := got["dice-box"], got["docs"]
	if dice["command"] != "node" || dice["env"].(map[string]any)["DICE_WORD"] != "plum" || dice["exposure"] != "direct" || dice["url"] != nil {
		t.Errorf("dice = %v", dice)
	}
	if docs["url"] != "https://mcp.example.com/mcp" || docs["headers"].(map[string]any)["Authorization"] != "Bearer t-1" || docs["exposure"] != "direct" {
		t.Errorf("docs = %v", docs)
	}
	if l.MCPMode != 0o600 {
		t.Errorf("file mode %v", l.MCPMode)
	}
	file := l.Args[len(l.Args)-1]
	for i, a := range l.Args {
		if a == "--harf-mcp" {
			file = l.Args[i+1]
		}
	}
	if _, err := os.Stat(file); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("%s is still there: %v", file, err)
	}
}

func TestMCPToolsStayForAnAgentWithNoOtherTools(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(settled)})
	r.MCPExtension = "/data/pi/mcp.js"
	r.Run(context.Background(), Spec{Session: "s", Prompt: "x", Tools: []string{}, MCP: []store.MCPServer{{Name: "dice", Command: "node"}}}, func(Event) {})
	if args := strings.Join(log().Args, " "); !strings.Contains(args, "--tools mcp__dice__*") || strings.Contains(args, "--no-tools") {
		t.Errorf("args %q", args)
	}

	r.Run(context.Background(), Spec{Session: "s", Prompt: "x"}, func(Event) {})
	if args := strings.Join(log().Args, " "); strings.Contains(args, "--harf-mcp") || strings.Contains(args, "mcp.js") {
		t.Errorf("no servers, yet %q", args)
	}

	// The agent builder's tools, like MCP servers, are not Pi's own tools.
	r.AgentExtension = "/data/pi/agents.js"
	noop := func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }
	r.Run(context.Background(), Spec{Session: "s", Prompt: "x", Tools: []string{}, AgentTools: noop}, func(Event) {})
	if args := strings.Join(log().Args, " "); !strings.Contains(args, "--tools create_agent,update_agent,list_agents") || strings.Contains(args, "--no-tools") {
		t.Errorf("agent tools with no Pi tools: %q", args)
	}
}

func TestAgentToolCallsAreAnsweredByHarf(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(
		`{"type":"extension_ui_request","id":"ui-1","method":"editor","title":"harf:create_agent","prefill":"{\"name\":\"Go reviewer\"}"}`,
		`{"type":"extension_ui_request","id":"ui-2","method":"editor","title":"harf:update_agent","prefill":"{\"id\":\"nope\"}"}`,
		`{"type":"extension_ui_request","id":"ui-3","method":"editor","title":"Write a note"}`,
		settled,
	)})
	r.AgentExtension = "/data/pi/agents.js"
	var asked []string
	r.Run(context.Background(), Spec{Session: "s", Prompt: "make an agent", Tools: []string{"read"},
		AgentTools: func(_ context.Context, op string, args json.RawMessage) (any, error) {
			asked = append(asked, op+" "+string(args))
			if op == "update_agent" {
				return nil, errors.New("no agent nope")
			}
			return map[string]string{"id": "a-1"}, nil
		}}, func(Event) {})

	if strings.Join(asked, "|") != `create_agent {"name":"Go reviewer"}|update_agent {"id":"nope"}` {
		t.Errorf("asked %q", asked)
	}
	l := log()
	answers := map[string]map[string]any{}
	for _, c := range l.Commands {
		if c["type"] == "extension_ui_response" {
			answers[c["id"].(string)] = c
		}
	}
	if answers["ui-1"]["value"] != `{"result":{"id":"a-1"}}` || answers["ui-2"]["value"] != `{"error":"no agent nope"}` || answers["ui-3"]["cancelled"] != true {
		t.Errorf("answers %v", answers)
	}
	args := strings.Join(l.Args, " ")
	for _, want := range []string{"--extension /data/pi/agents.js", "--tools read,create_agent,update_agent,list_agents"} {
		if !strings.Contains(args, want) {
			t.Errorf("args %q lack %q", args, want)
		}
	}
}

func TestCheckMCPReportsTheServersTools(t *testing.T) {
	r, log := fake(t, scenario{Commands: map[string][]json.RawMessage{
		"/mcp":                 events(`{"type":"extension_ui_request","id":"u1","method":"notify","message":"web: connected, 28 tools (direct)\ndice: connected, 1 tools (direct)"}`),
		"/harf-mcp-tools dice": events(`{"type":"extension_ui_request","id":"u2","method":"notify","message":"{\"tools\":[{\"name\":\"roll_dice\",\"description\":\"Roll dice\"}]}"}`),
	}})
	r.MCPExtension = "/data/pi/mcp.js"
	got, err := r.CheckMCP(context.Background(), store.MCPServer{Name: "dice", Command: "node", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "connected" || got.Error != "" || len(got.Tools) != 1 || got.Tools[0] != (MCPTool{Name: "roll_dice", Description: "Roll dice"}) {
		t.Errorf("check = %+v", got)
	}
	l := log()
	if args := strings.Join(l.Args, " "); !strings.Contains(args, "--no-session") || !strings.Contains(args, "-e builtin:mcp") || strings.Contains(args, "--no-mcp") {
		t.Errorf("args %q", args)
	}
	if !strings.Contains(string(l.MCP), `"dice"`) {
		t.Errorf("pi got %s", l.MCP)
	}
}

func TestCheckMCPReportsWhyTheServerFailed(t *testing.T) {
	r, _ := fake(t, scenario{Commands: map[string][]json.RawMessage{
		"/mcp": events(`{"type":"extension_ui_request","id":"u1","method":"notify","message":"web: connected, 28 tools (direct)\ndice: failed (direct)\n    MCP connection closed\n    Error: Cannot find module 'dice.mjs'\nother: starting (direct)"}`),
	}})
	r.MCPExtension = "/data/pi/mcp.js"
	got, err := r.CheckMCP(context.Background(), store.MCPServer{Name: "dice", Command: "node", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "failed" || got.Error != "MCP connection closed\nError: Cannot find module 'dice.mjs'" || len(got.Tools) != 0 {
		t.Errorf("check = %+v", got)
	}
}
