package pi

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The test binary doubles as a fake pi: with FAKE_PI set to a scenario file
// it speaks pi's RPC protocol on stdin and stdout and logs what it received.

type scenario struct {
	Stderr    string                     `json:"stderr,omitempty"` // write this and exit 1 at start
	Responses map[string]json.RawMessage `json:"responses,omitempty"`
	Prompt    []json.RawMessage          `json:"prompt,omitempty"` // events emitted after a prompt
	WaitAbort bool                       `json:"waitAbort,omitempty"`
	// Aborted is what Pi says when it stops; empty is an aborted message.
	Aborted []json.RawMessage `json:"aborted,omitempty"`
	// Handled answers a prompt as an extension command would: handled, with
	// the Prompt events (its notifications) sent before the response.
	Handled bool `json:"handled,omitempty"`
	// Commands answers prompts that are extension commands: the events
	// (notifications) for each message, sent before a handled response.
	Commands map[string][]json.RawMessage `json:"commands,omitempty"`
}

type fakeLog struct {
	Args     []string         `json:"args"`
	Dir      string           `json:"dir"`
	Commands []map[string]any `json:"commands"`
	// MCP is the file --harf-mcp named, as it was when pi started, and
	// MCPMode its permissions.
	MCP     json.RawMessage `json:"mcp,omitempty"`
	MCPMode os.FileMode     `json:"mcpMode,omitempty"`
}

func TestMain(m *testing.M) {
	if path := os.Getenv("FAKE_PI"); path != "" {
		fakePi(path)
		return
	}
	os.Exit(m.Run())
}

func fakePi(path string) {
	var sc scenario
	b, _ := os.ReadFile(path)
	json.Unmarshal(b, &sc)
	dir, _ := os.Getwd()
	log := fakeLog{Args: os.Args[1:], Dir: dir}
	for i, a := range log.Args {
		if a == "--harf-mcp" && i+1 < len(log.Args) {
			log.MCP, _ = os.ReadFile(log.Args[i+1])
			if fi, err := os.Stat(log.Args[i+1]); err == nil {
				log.MCPMode = fi.Mode().Perm()
			}
		}
	}
	save := func() {
		b, _ := json.Marshal(log)
		os.WriteFile(path+".log", b, 0o600)
	}
	save()
	if sc.Stderr != "" {
		fmt.Fprintln(os.Stderr, sc.Stderr)
		os.Exit(1)
	}
	out := json.NewEncoder(os.Stdout)
	in := bufio.NewScanner(os.Stdin)
	next := func() (map[string]any, bool) {
		if !in.Scan() {
			return nil, false
		}
		var c map[string]any
		json.Unmarshal(in.Bytes(), &c)
		log.Commands = append(log.Commands, c)
		save()
		return c, true
	}
	respond := func(c map[string]any, data json.RawMessage) {
		r := map[string]any{"type": "response", "command": c["type"], "success": true}
		if c["id"] != nil {
			r["id"] = c["id"]
		}
		if data != nil {
			r["data"] = data
		}
		out.Encode(r)
	}
	for {
		c, ok := next()
		if !ok {
			return
		}
		if c["type"] != "prompt" {
			respond(c, sc.Responses[c["type"].(string)])
			continue
		}
		if evs, ok := sc.Commands[c["message"].(string)]; ok {
			for _, ev := range evs {
				os.Stdout.Write(append(ev, '\n'))
			}
			respond(c, json.RawMessage(`{"disposition":"handled"}`))
			continue
		}
		if sc.Handled {
			for _, ev := range sc.Prompt {
				os.Stdout.Write(append(ev, '\n'))
			}
			respond(c, json.RawMessage(`{"disposition":"handled"}`))
			continue
		}
		respond(c, json.RawMessage(`{"disposition":"started"}`))
		for _, ev := range sc.Prompt {
			var head struct {
				Type, ID, Method string
				Ms               int
			}
			json.Unmarshal(ev, &head)
			if head.Type == "fake_sleep" { // a pause between events, not sent
				time.Sleep(time.Duration(head.Ms) * time.Millisecond)
				continue
			}
			os.Stdout.Write(append(ev, '\n'))
			if head.Type == "extension_ui_request" && (head.Method == "confirm" || head.Method == "editor") {
				next() // the client's answer
			}
		}
		if sc.WaitAbort {
			for {
				c, ok := next()
				if !ok {
					return
				}
				if c["type"] == "abort" {
					if len(sc.Aborted) > 0 {
						for _, e := range sc.Aborted {
							fmt.Fprintln(os.Stdout, string(e))
						}
					} else {
						fmt.Fprintln(os.Stdout, `{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"partial"}],"stopReason":"aborted","errorMessage":"Request was aborted"}}`)
					}
					fmt.Fprintln(os.Stdout, `{"type":"agent_settled","aborted":true}`)
					respond(c, nil)
					break
				}
			}
		}
	}
}

// fake writes a scenario and returns a Runner that starts the fake pi, plus a
// function that reads what the fake received.
func fake(t *testing.T, sc scenario) (*Runner, func() fakeLog) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "scenario.json")
	b, _ := json.Marshal(sc)
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(dir, "work")
	os.Mkdir(work, 0o700)
	r := &Runner{Bin: exe, Dir: work, SessionDir: filepath.Join(dir, "sessions"), Env: []string{"FAKE_PI=" + path}}
	return r, func() fakeLog {
		var l fakeLog
		b, _ := os.ReadFile(path + ".log")
		json.Unmarshal(b, &l)
		return l
	}
}

// events joins pi event records written as compact JSON.
func events(lines ...string) []json.RawMessage {
	out := make([]json.RawMessage, len(lines))
	for i, l := range lines {
		out[i] = json.RawMessage(l)
	}
	return out
}
