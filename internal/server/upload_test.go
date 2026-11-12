package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/store"
)

// upload sends a file as the page does: the raw bytes, with the name in a
// header.
func (h *harness) upload(chatID, name, content string) (store.Attachment, int) {
	h.t.Helper()
	return h.uploadFrom(chatID, name, strings.NewReader(content))
}

func (h *harness) uploadFrom(chatID, name string, body io.Reader) (store.Attachment, int) {
	h.t.Helper()
	req, _ := http.NewRequest("POST", h.srv.URL+"/api/chats/"+chatID+"/files", body)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Harf-Name", url.PathEscape(name))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	var a store.Attachment
	if resp.StatusCode == http.StatusCreated {
		if err := json.NewDecoder(resp.Body).Decode(&a); err != nil {
			h.t.Fatal(err)
		}
	}
	return a, resp.StatusCode
}

func TestUploadSavesTheFileInThePiWorkspace(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})

	a, status := h.upload(c.ID, "sales 2026.csv", "month,units\njan,12\n")
	if status != 201 || a.Name != "sales 2026.csv" || a.Path != "uploads/"+c.ID+"/sales-2026.csv" ||
		a.Type != "text/csv" || a.Size != 19 {
		t.Fatalf("status %d attachment %+v", status, a)
	}
	if b, err := os.ReadFile(filepath.Join(h.workspace, a.Path)); err != nil || string(b) != "month,units\njan,12\n" {
		t.Fatalf("saved %q, %v", b, err)
	}

	again, _ := h.upload(c.ID, "sales 2026.csv", "other")
	if again.Path == a.Path || !strings.HasPrefix(again.Path, "uploads/"+c.ID+"/") {
		t.Fatalf("a second file with the same name went to %q", again.Path)
	}
}

func TestUploadNamesAreCleanedAndCannotLeaveTheChatsFolder(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})
	for name, want := range map[string]string{
		".bashrc":                  "bashrc",
		"..":                       "file",
		`<b onclick="x">.h`:        "b-onclick-x-.h",
		"r\u00e9sum\u00e9 (1).pdf": "r\u00e9sum\u00e9-1-.pdf",
	} {
		a, status := h.upload(c.ID, name, "x")
		if status != 201 || a.Path != "uploads/"+c.ID+"/"+want {
			t.Errorf("%q: status %d path %q, want %q", name, status, a.Path, want)
		}
	}
	for _, name := range []string{"  ", "a\x00b", "../../escape.txt", `..\..\win.txt`, "a/b/c.png"} {
		if _, status := h.upload(c.ID, name, "x"); status != http.StatusBadRequest {
			t.Errorf("%q: status %d, want 400", name, status)
		}
	}
	if entries, _ := os.ReadDir(filepath.Join(h.workspace, "uploads", c.ID)); len(entries) != 4 {
		t.Errorf("saved %d files, want 4", len(entries))
	}
}

// serveUpload calls the server directly, so a test sees the request end
// before it looks at the workspace.
func (h *harness) serveUpload(chatID, name string, body io.Reader) int {
	req := httptest.NewRequest("POST", "/api/chats/"+chatID+"/files", body)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Harf-Name", name)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec.Code
}

func (h *harness) uploads(chatID string) []os.DirEntry {
	entries, _ := os.ReadDir(filepath.Join(h.workspace, "uploads", chatID))
	return entries
}

type cutOff struct{}

func (cutOff) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestUploadOfTooBigOrCutOffFileLeavesNothing(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})
	zeros := func(n int64) io.Reader { return io.LimitReader(zeroReader{}, n) } // no length: sent as it streams

	// Said too big up front: refused before any of it is read.
	req, _ := http.NewRequest("POST", h.srv.URL+"/api/chats/"+c.ID+"/files", zeroReader{})
	req.ContentLength = maxUpload + 1
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Harf-Name", "big.bin")
	if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("too big by its length: %v %v", resp, err)
	}
	if status := h.serveUpload(c.ID, "big.bin", zeros(maxUpload+1)); status != http.StatusRequestEntityTooLarge {
		t.Errorf("too big as it streamed: status %d", status)
	}
	if status := h.serveUpload(c.ID, "half.bin", io.MultiReader(strings.NewReader("the first half"), cutOff{})); status < 400 {
		t.Errorf("cut off: status %d", status)
	}
	if e := h.uploads(c.ID); len(e) != 0 {
		t.Fatalf("left behind: %v", e)
	}

	if status := h.serveUpload(c.ID, "full.bin", zeros(maxUpload)); status != http.StatusCreated {
		t.Errorf("exactly the limit: status %d", status)
	}
	if e := h.uploads(c.ID); len(e) != 1 || e[0].Name() != "full.bin" {
		t.Errorf("saved %v", e)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestUploadIsRefusedCrossSiteWithoutItsHeaderOrAsAForm(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})
	for _, hdr := range []map[string]string{
		{"Content-Type": "application/octet-stream", "X-Harf-Name": "a.txt", "Sec-Fetch-Site": "cross-site"},
		{"Content-Type": "application/octet-stream", "X-Harf-Name": "a.txt", "Sec-Fetch-Site": "same-site"},
		{"Content-Type": "application/octet-stream"},
		{"Content-Type": "text/plain", "X-Harf-Name": "a.txt"},
		{"Content-Type": "multipart/form-data; boundary=x", "X-Harf-Name": "a.txt"},
		{"Content-Type": "application/x-www-form-urlencoded", "X-Harf-Name": "a.txt"},
		{"Content-Type": "application/json"}, // the old base64 JSON upload
	} {
		req, _ := http.NewRequest("POST", h.srv.URL+"/api/chats/"+c.ID+"/files", strings.NewReader(`{"name":"a.txt","data":"eA=="}`))
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode < 400 {
			t.Errorf("%v: status %d", hdr, resp.StatusCode)
		}
	}
	if e := h.uploads(c.ID); len(e) != 0 {
		t.Errorf("refused uploads were saved: %v", e)
	}
}

func TestUploadNeedsTheAttachmentsPluginAndAChat(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})
	if _, status := h.upload("0123456789abcdef", "a.txt", "x"); status != 404 {
		t.Errorf("unknown chat: status %d", status)
	}
	h.do("PUT", "/api/plugins/attachments", map[string]any{"enabled": false}, nil)
	if _, status := h.upload(c.ID, "a.txt", "x"); status != http.StatusForbidden {
		t.Errorf("plugin off: status %d", status)
	}
}

const png = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"

func TestAttachedFilesAreNamedInThePromptAndImagesSentToModelsThatSeeThem(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{"model": "fake/big"})
	img, _ := h.upload(c.ID, "photo.png", png)
	csv, _ := h.upload(c.ID, "data.csv", "a,b\n1,2\n")

	h.send(c.ID, map[string]any{"content": "what is this?", "attachments": []map[string]any{
		{"name": "photo.png", "path": img.Path, "size": 1, "type": "text/html"}, {"name": "data.csv", "path": csv.Path},
	}})

	s := h.agent.lastSpec()
	for _, want := range []string{"what is this?", img.Path, csv.Path} {
		if !strings.Contains(s.Prompt, want) {
			t.Errorf("prompt %q lacks %q", s.Prompt, want)
		}
	}
	if len(s.Images) != 1 || s.Images[0].MimeType != "image/png" || string(s.Images[0].Data) != png {
		t.Errorf("images %+v", s.Images)
	}
	m := h.chat(c.ID).Messages[0]
	if m.Content != "what is this?" || len(m.Attachments) != 2 || m.Attachments[0] != img || m.Attachments[1] != csv {
		t.Errorf("saved %+v", m)
	}

	h.send(c.ID, map[string]any{"from": h.chat(c.ID).Messages[1].ID})
	if s := h.agent.lastSpec(); !strings.Contains(s.Prompt, img.Path) || len(s.Images) != 1 || s.ForkText != s.Prompt {
		t.Errorf("regenerate: prompt %q images %d fork text %q", s.Prompt, len(s.Images), s.ForkText)
	}
}

func TestModelsThatCannotSeeImagesGetOnlyTheirPaths(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{"model": "fake/small"})
	img, _ := h.upload(c.ID, "photo.png", png)

	h.send(c.ID, map[string]any{"attachments": []map[string]any{{"name": "photo.png", "path": img.Path}}})

	if s := h.agent.lastSpec(); !strings.Contains(s.Prompt, img.Path) || len(s.Images) != 0 {
		t.Errorf("prompt %q images %d", s.Prompt, len(s.Images))
	}
}

func TestAPictureTooBigForTheModelIsSavedButNotSentToIt(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{"model": "fake/big"})
	big, status := h.uploadFrom(c.ID, "huge.png", io.MultiReader(strings.NewReader(png), io.LimitReader(zeroReader{}, maxModelImage)))
	if status != http.StatusCreated || big.Type != "image/png" || big.Size != maxModelImage+int64(len(png)) {
		t.Fatalf("status %d attachment %+v", status, big)
	}
	small, _ := h.upload(c.ID, "small.png", png)

	h.send(c.ID, map[string]any{"attachments": []map[string]any{{"path": big.Path}, {"path": small.Path}}})

	s := h.agent.lastSpec()
	if !strings.Contains(s.Prompt, big.Path) || len(s.Images) != 1 || string(s.Images[0].Data) != png {
		t.Errorf("prompt %q, %d images", s.Prompt, len(s.Images))
	}
}

func TestConfigTellsThePageTheFileLimits(t *testing.T) {
	h := newHarness(t, echo)
	var cfg struct{ MaxUpload, MaxModelImage int64 }
	h.do("GET", "/api/config", nil, &cfg)
	if cfg.MaxUpload != maxUpload || cfg.MaxModelImage != maxModelImage {
		t.Errorf("config %+v", cfg)
	}
}

func TestOnlyThisChatsUploadsCanBeAttached(t *testing.T) {
	h := newHarness(t, echo)
	c := h.newChat(map[string]any{})
	other := h.newChat(map[string]any{})
	theirs, _ := h.upload(other.ID, "a.txt", "x")
	h.write("notes/b.txt", "x")

	for _, p := range []string{theirs.Path, "notes/b.txt", "uploads/" + c.ID + "/../" + other.ID + "/a.txt", "uploads/" + c.ID + "/missing.txt"} {
		resp := h.do("POST", "/api/chats/"+c.ID+"/messages", map[string]any{"content": "x", "attachments": []map[string]any{{"path": p}}}, nil)
		if resp.StatusCode != 400 {
			t.Errorf("%s: status %d", p, resp.StatusCode)
		}
	}
	if n := len(h.chat(c.ID).Messages); n != 0 {
		t.Errorf("%d messages saved", n)
	}
}

func TestTitleIsAskedFromWhatTheUserWroteAndTheFileNames(t *testing.T) {
	h := newHarness(t, func(pi.Spec) pi.Result { return pi.Result{Text: "a red circle"} })
	h.agent.title = "Red circle"
	c := h.newChat(map[string]any{"model": "fake/big"})
	img, _ := h.upload(c.ID, "circle.png", png)

	h.send(c.ID, map[string]any{"content": "what is this?", "attachments": []map[string]any{{"name": "circle.png", "path": img.Path}}})

	p := h.agent.titles[0]
	if !strings.Contains(p, "what is this?") || !strings.Contains(p, "circle.png") || strings.Contains(p, "uploads/") {
		t.Fatalf("title prompt %q", p)
	}
}

func TestUploadsCutOffByARestartAreRemovedAtStart(t *testing.T) {
	dir, ws := t.TempDir(), t.TempDir()
	left := filepath.Join(ws, "uploads", "c1", ".abc123.part")
	kept := filepath.Join(ws, "uploads", "c1", "notes.txt")
	if err := os.MkdirAll(filepath.Dir(left), 0o700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(left, []byte("half"), 0o600)
	os.WriteFile(kept, []byte("whole"), 0o600)
	serve(t, dir, ws, fstest.MapFS{}, &fakeAgent{reply: echo}, "fake/small")
	if _, err := os.Stat(left); !os.IsNotExist(err) {
		t.Errorf("half upload still there: %v", err)
	}
	if _, err := os.Stat(kept); err != nil {
		t.Errorf("finished upload gone: %v", err)
	}
}
