package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func open(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return s
}

func TestChatSurvivesReopen(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	c, err := s.CreateChat(Chat{Title: "Trip ideas", Model: "openai:gpt-test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendMessage(c.ID, Message{Role: "user", Content: "hello"}); err != nil {
		t.Fatal(err)
	}

	got, err := open(t, dir).GetChat(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Trip ideas" || len(got.Messages) != 1 || got.Messages[0].Content != "hello" {
		t.Fatalf("unexpected chat after reopen: %+v", got)
	}
}

func TestListChatsPinnedThenMostRecent(t *testing.T) {
	s := open(t, t.TempDir())
	a, _ := s.CreateChat(Chat{Title: "a"})
	b, _ := s.CreateChat(Chat{Title: "b"})
	c, _ := s.CreateChat(Chat{Title: "c"})
	s.AppendMessage(a.ID, Message{Role: "user", Content: "bump a"})
	pinned := true
	if _, err := s.UpdateChat(b.ID, ChatPatch{Pinned: &pinned}); err != nil {
		t.Fatal(err)
	}

	var titles []string
	for _, x := range s.ListChats() {
		titles = append(titles, x.Title)
	}
	want := []string{"b", "a", "c"}
	if fmt.Sprint(titles) != fmt.Sprint(want) {
		t.Fatalf("order = %v, want %v (c=%s)", titles, want, c.ID)
	}
}

func TestDeletedChatIsGoneAfterReopen(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	c, _ := s.CreateChat(Chat{Title: "bye"})
	if err := s.DeleteChat(c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := open(t, dir).GetChat(c.ID); err != ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestTruncateFromDropsThatMessageAndLater(t *testing.T) {
	s := open(t, t.TempDir())
	c, _ := s.CreateChat(Chat{})
	s.AppendMessage(c.ID, Message{Role: "user", Content: "one"})
	two, _ := s.AppendMessage(c.ID, Message{Role: "assistant", Content: "two"})
	s.AppendMessage(c.ID, Message{Role: "user", Content: "three"})

	got, err := s.TruncateFrom(c.ID, two.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Messages) != 1 || got.Messages[0].Content != "one" {
		t.Fatalf("messages = %+v", got.Messages)
	}
	if _, err := s.TruncateFrom(c.ID, "nope"); err != ErrNotFound {
		t.Fatalf("unknown message: err = %v, want ErrNotFound", err)
	}
}

func TestAgentsPersistAndListByName(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	w, err := s.SaveAgent(Agent{Name: "Writer", SystemPrompt: "You edit prose."})
	if err != nil {
		t.Fatal(err)
	}
	s.SaveAgent(Agent{Name: "Analyst"})
	w.SystemPrompt = "You edit prose tightly."
	if _, err := s.SaveAgent(w); err != nil {
		t.Fatal(err)
	}

	got := open(t, dir).ListAgents()
	if len(got) != 2 || got[0].Name != "Analyst" || got[1].SystemPrompt != "You edit prose tightly." {
		t.Fatalf("agents = %+v", got)
	}

	if err := s.DeleteAgent(w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := open(t, dir).GetAgent(w.ID); err != ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestTurnedOffPluginsSurviveReopen(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if s.PluginOff("charts") {
		t.Fatal("plugins start on")
	}
	if err := s.SetPluginOff("charts", true); err != nil {
		t.Fatal(err)
	}
	s.SetPluginOff("attachments", true)
	s.SetPluginOff("attachments", false)

	again := open(t, dir)
	if !again.PluginOff("charts") || again.PluginOff("attachments") {
		t.Fatalf("after reopen: charts off %v, attachments off %v", again.PluginOff("charts"), again.PluginOff("attachments"))
	}
}

func TestImageModelAndPluginSettingsSurviveReopenTogether(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if s.ImageModel() != "" {
		t.Fatal("no image model is chosen at first")
	}
	s.SetPluginOff("charts", true)
	if err := s.SetImageModel("openrouter/img-1"); err != nil {
		t.Fatal(err)
	}
	s.SetPluginOff("attachments", true)

	again := open(t, dir)
	if again.ImageModel() != "openrouter/img-1" || !again.PluginOff("charts") || !again.PluginOff("attachments") {
		t.Fatalf("after reopen: image model %q, charts off %v, attachments off %v",
			again.ImageModel(), again.PluginOff("charts"), again.PluginOff("attachments"))
	}
}

func TestMCPServersPersistInAPrivateFile(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if _, err := s.AddMCP(MCPServer{Name: "docs", URL: "https://mcp.example.com/mcp", Headers: map[string]string{"Authorization": "Bearer t-1"}, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	dice, err := s.AddMCP(MCPServer{Name: "dice", Command: "node", Args: []string{"dice.mjs"}, Env: map[string]string{"DICE_WORD": "plum"}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	dice.Enabled = false
	if _, err := s.UpdateMCP(dice); err != nil {
		t.Fatal(err)
	}

	got := open(t, dir).ListMCP()
	if len(got) != 2 || got[0].Name != "dice" || got[0].Enabled || got[0].Env["DICE_WORD"] != "plum" || got[1].Headers["Authorization"] != "Bearer t-1" {
		t.Fatalf("servers = %+v", got)
	}
	fi, err := os.Stat(filepath.Join(dir, "mcp.json"))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("mcp.json: %v, %v", fi, err)
	}
	if _, err := s.UpdateMCP(MCPServer{Name: "gone", Command: "x"}); err != ErrNotFound {
		t.Errorf("update of a missing server: %v", err)
	}
}

func TestDeletedMCPServerLeavesTheAgentsThatUsedIt(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	s.AddMCP(MCPServer{Name: "dice", Command: "node", Enabled: true})
	s.AddMCP(MCPServer{Name: "docs", URL: "https://mcp.example.com/mcp", Enabled: true})
	a, _ := s.SaveAgent(Agent{Name: "Gamer", MCP: []string{"dice", "docs"}})
	all, _ := s.SaveAgent(Agent{Name: "Any"}) // nil: every enabled server

	if err := s.DeleteMCP("dice"); err != nil {
		t.Fatal(err)
	}
	r := open(t, dir)
	if got, _ := r.GetAgent(a.ID); len(got.MCP) != 1 || got.MCP[0] != "docs" {
		t.Errorf("agent MCP = %#v", got.MCP)
	}
	if got, _ := r.GetAgent(all.ID); got.MCP != nil {
		t.Errorf("agent with every server now has %#v", got.MCP)
	}
	if len(r.ListMCP()) != 1 {
		t.Errorf("servers = %+v", r.ListMCP())
	}
}

func TestMCPServersMustBeUsableByPi(t *testing.T) {
	s := open(t, t.TempDir())
	s.AddMCP(MCPServer{Name: "my-tools", Command: "node"})
	for _, m := range []MCPServer{
		{Name: "my tools", Command: "node"},                         // Pi allows letters, digits, _ and -
		{Name: "", Command: "node"},                                 // no name
		{Name: "my_tools", Command: "node"},                         // Pi sees my-tools and my_tools as one
		{Name: "my-tools", Command: "node"},                         // taken
		{Name: "both", Command: "node", URL: "https://example.com"}, // stdio or URL, not both
		{Name: "neither"},
		{Name: "ftp", URL: "ftp://example.com/mcp"},
	} {
		if _, err := s.AddMCP(m); !errors.Is(err, ErrInvalid) {
			t.Errorf("%+v: err = %v, want ErrInvalid", m, err)
		}
	}
}
