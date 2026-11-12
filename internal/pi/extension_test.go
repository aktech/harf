package pi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aktech/harf/internal/store"
)

// These tests run the image extension in the real Pi, with its own empty
// settings folder, so they need pi on PATH.

// realPi returns a Runner for the installed pi with the image extension
// written out, and no saved logins or provider keys. env is added to Pi's
// environment.
func realPi(t *testing.T, env ...string) *Runner {
	t.Helper()
	bin, err := exec.LookPath("pi")
	if err != nil {
		t.Skip("pi is not installed")
	}
	dir := t.TempDir()
	work := filepath.Join(dir, "work")
	os.Mkdir(work, 0o700)
	// Pi reads provider keys from the environment: hide the developer's.
	for _, kv := range os.Environ() {
		if k, _, _ := strings.Cut(kv, "="); strings.HasSuffix(k, "_API_KEY") {
			t.Setenv(k, "")
		}
	}
	env = append(env, "PI_CODING_AGENT_DIR="+filepath.Join(dir, "agent"), "PI_OFFLINE=1", "PI_TELEMETRY=0", "PI_SKIP_VERSION_CHECK=1")
	r := &Runner{Bin: bin, Dir: work, SessionDir: filepath.Join(dir, "sessions"), Env: env}
	if err := r.WriteExtensions(filepath.Join(dir, "data")); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRealPiWithoutCredentialsHasNoImageModels(t *testing.T) {
	r := realPi(t)
	ms, err := r.ImageModels(context.Background())
	if err != nil || len(ms) != 0 {
		t.Fatalf("models %v, err %v", ms, err)
	}
	res := r.Run(context.Background(), Spec{ImageModel: "openrouter/black-forest-labs/flux.2-pro", ImageOnly: true, Prompt: "a fox"}, func(Event) {})
	if !strings.Contains(res.Error, "No image model is available") {
		t.Errorf("error = %q", res.Error)
	}
}

// fakeOpenRouter answers chat completion requests the way OpenRouter does
// for image models, with one PNG, and records each request.
func fakeOpenRouter(t *testing.T, png []byte) (url string, asked func() map[string]any) {
	var last map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&last)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"id": "gen-1", "object": "chat.completion", "model": last["model"],
			"choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "message": map[string]any{
				"role": "assistant", "content": "",
				"images": []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)}}},
			}}},
		})
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "/api/v1", func() map[string]any { return last }
}

// withOpenRouterAt points Pi's OpenRouter provider at url, with a throwaway
// key, through a second extension.
func withOpenRouterAt(t *testing.T, url string) []string {
	dir := t.TempDir()
	redirect := filepath.Join(dir, "redirect.js")
	js := `export default function (pi) { pi.registerProvider("openrouter", { baseUrl: process.env.FAKE_OPENROUTER_URL }); }`
	if err := os.WriteFile(redirect, []byte(js), 0o600); err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 16)
	rand.Read(key)
	return []string{"FAKE_OPENROUTER_URL=" + url, "OPENROUTER_API_KEY=" + hex.EncodeToString(key), "FAKE_REDIRECT=" + redirect}
}

func TestRealPiSavesTheImageInTheWorkspace(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nnot really a picture")
	url, asked := fakeOpenRouter(t, png)
	env := withOpenRouterAt(t, url)
	r := realPi(t, env...)
	// The redirect extension loads with Harf's, through a wrapper.
	wrapper := filepath.Join(t.TempDir(), "pi")
	script := "#!/bin/sh\nexec " + r.Bin + ` --extension "$FAKE_REDIRECT" "$@"` + "\n"
	if err := os.WriteFile(wrapper, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	r.Bin = wrapper

	ms, err := r.ImageModels(context.Background())
	if err != nil || len(ms) == 0 {
		t.Fatalf("models %v, err %v", ms, err)
	}
	model := "openrouter/black-forest-labs/flux.2-pro"
	res := r.Run(context.Background(), Spec{ImageModel: model, ImageOnly: true, Prompt: "A red fox, in snow!"}, func(Event) {})
	if res.Error != "" {
		t.Fatal(res.Error)
	}
	if want := "![A red fox, in snow!](images/a-red-fox-in-snow-1.png)"; res.Text != want {
		t.Errorf("reply %q, want %q", res.Text, want)
	}
	got, err := os.ReadFile(filepath.Join(r.Dir, "images", "a-red-fox-in-snow-1.png"))
	if err != nil || string(got) != string(png) {
		t.Errorf("saved %q, %v", got, err)
	}
	if asked()["model"] != "black-forest-labs/flux.2-pro" {
		t.Errorf("asked OpenRouter for %v", asked()["model"])
	}

	// A second image with the same prompt keeps the first.
	res = r.Run(context.Background(), Spec{ImageModel: model, ImageOnly: true, Prompt: "A red fox, in snow!"}, func(Event) {})
	if !strings.Contains(res.Text, "images/a-red-fox-in-snow-2.png") {
		t.Errorf("second reply %q", res.Text)
	}
}

// diceServer is a small MCP server over stdio with one tool, roll_dice.
const diceServer = `
import { createInterface } from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const ok = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  if (m.method === "initialize") return ok({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "dice", version: "1.0.0" } });
  if (m.method === "tools/list") return ok({ tools: [{ name: "roll_dice", description: "Roll a die", inputSchema: { type: "object", properties: {} } }] });
  if (m.method === "tools/call") return ok({ content: [{ type: "text", text: "rolled " + process.env.DICE_FACE }] });
  send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no such method" } });
});
`

func TestRealPiChecksAnMCPServer(t *testing.T) {
	r := realPi(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	script := filepath.Join(t.TempDir(), "dice.mjs")
	if err := os.WriteFile(script, []byte(diceServer), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := r.CheckMCP(context.Background(), store.MCPServer{Name: "dice-box", Command: node, Args: []string{script}, Env: map[string]string{"DICE_FACE": "6"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "connected" || len(got.Tools) != 1 || got.Tools[0] != (MCPTool{Name: "roll_dice", Description: "Roll a die"}) {
		t.Errorf("check = %+v", got)
	}

	got, err = r.CheckMCP(context.Background(), store.MCPServer{Name: "dice-box", Command: node, Args: []string{script + ".missing"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "failed" || !strings.Contains(got.Error, "Cannot find module") {
		t.Errorf("check = %+v", got)
	}
}
