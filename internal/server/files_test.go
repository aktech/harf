package server

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// get fetches a raw path, without the client cleaning it first.
func (h *harness) get(path string) (*http.Response, string) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.srv.URL, nil)
	req.URL.RawPath, req.URL.Path = path, path
	if p, err := unescape(path); err == nil {
		req.URL.Path = p
	}
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func (h *harness) write(rel, content string) {
	h.t.Helper()
	p := filepath.Join(h.workspace, rel)
	os.MkdirAll(filepath.Dir(p), 0o700)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		h.t.Fatal(err)
	}
}

func TestWorkspaceFilesAreServed(t *testing.T) {
	h := newHarness(t, echo)
	h.write("charts/sales.png", "\x89PNG\r\n\x1a\nrest")

	resp, body := h.get("/api/files/charts/sales.png")
	if resp.StatusCode != 200 || body != "\x89PNG\r\n\x1a\nrest" {
		t.Fatalf("status %d body %q", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("content type %q", ct)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" || resp.Header.Get("Content-Disposition") != "" {
		t.Errorf("headers %v", resp.Header)
	}
}

func TestWorkspaceFilesStayInsideTheWorkspace(t *testing.T) {
	h := newHarness(t, echo)
	outside := filepath.Join(filepath.Dir(h.workspace), "secret.txt")
	os.WriteFile(outside, []byte("secret"), 0o600)
	t.Cleanup(func() { os.Remove(outside) })
	h.write("notes/a.txt", "a")
	if err := os.Symlink(outside, filepath.Join(h.workspace, "link.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(h.workspace), filepath.Join(h.workspace, "up")); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		"/api/files/..%2Fsecret.txt",
		"/api/files/notes%2F..%2F..%2Fsecret.txt",
		"/api/files/%2F" + strings.TrimPrefix(filepath.ToSlash(outside), "/"),
		"/api/files/link.txt",
		"/api/files/up/secret.txt",
		"/api/files/notes",
		"/api/files/missing.txt",
	} {
		resp, body := h.get(path)
		if resp.StatusCode < 400 || strings.Contains(body, "secret") {
			t.Errorf("%s: status %d body %q", path, resp.StatusCode, body)
		}
	}
}

func TestActiveFilesNeverRunOnTheAppsOrigin(t *testing.T) {
	h := newHarness(t, echo)
	h.write("page.html", "<script>alert(1)</script>")
	h.write("logo.svg", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)

	for _, path := range []string{"/api/files/page.html", "/api/files/logo.svg"} {
		resp, _ := h.get(path)
		if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Security-Policy"), "sandbox") {
			t.Errorf("%s: status %d csp %q", path, resp.StatusCode, resp.Header.Get("Content-Security-Policy"))
		}
	}
	if resp, _ := h.get("/api/files/logo.svg"); resp.Header.Get("Content-Type") != "image/svg+xml" {
		t.Errorf("svg type %q", resp.Header.Get("Content-Type"))
	}
}

// fetchAs fetches a path the way a browser would for dest, from site.
func (h *harness) fetchAs(path, dest, site string) (*http.Response, string) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.srv.URL+path, nil)
	if dest != "" {
		req.Header.Set("Sec-Fetch-Dest", dest)
	}
	if site != "" {
		req.Header.Set("Sec-Fetch-Site", site)
	}
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

const wantPagePolicy = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; " +
	"style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; " +
	"frame-src 'none'; worker-src 'none'; base-uri 'none'; frame-ancestors 'self'"

func checkPageHeaders(t *testing.T, resp *http.Response) {
	t.Helper()
	want := map[string]string{
		"Content-Security-Policy":      wantPagePolicy,
		"Content-Type":                 "text/html; charset=utf-8",
		"X-Content-Type-Options":       "nosniff",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Referrer-Policy":              "no-referrer",
		"Cache-Control":                "no-store",
		"X-Dns-Prefetch-Control":       "off",
		"Content-Disposition":          "",
	}
	for k, v := range want {
		if got := resp.Header.Get(k); got != v {
			t.Errorf("%s: %q, want %q", k, got, v)
		}
	}
}

func TestAWebPageIsServedToHarfsFramesInASandbox(t *testing.T) {
	h := newHarness(t, echo)
	h.write("charts/pie.html", "<script>draw()</script>")

	for _, site := range []string{"same-origin", ""} {
		resp, body := h.fetchAs("/api/files/charts/pie.html", "iframe", site)
		if resp.StatusCode != 200 || !strings.HasSuffix(body, "<script>draw()</script>") {
			t.Fatalf("site %q: status %d body %q", site, resp.StatusCode, body)
		}
		checkPageHeaders(t, resp)
	}
}

// The shield is the page's first script: nothing the page holds runs
// before WebRTC is gone and frames are watched for.
func TestAWebPageRunsAfterTheShield(t *testing.T) {
	h := newHarness(t, echo)
	h.write("page.html", "\ufeff<!DOCTYPE html><div><template ShadowRootMode=\"closed\"><iframe srcdoc=\"x\"></iframe></template></div><script>draw()</script>")

	_, body := h.fetchAs("/api/files/page.html", "iframe", "same-origin")
	shield, rest, ok := strings.Cut(body, "</script>")
	if !ok || !strings.HasPrefix(shield, "<!doctype html><meta charset=\"utf-8\"><script>") || !strings.Contains(shield, "MutationObserver") {
		t.Fatalf("no shield first: %q", body)
	}
	if strings.Contains(rest, "\ufeff") || strings.Contains(strings.ToLower(rest), "shadowrootmode") || !strings.HasSuffix(rest, "<script>draw()</script>") {
		t.Fatalf("page after the shield: %q", rest)
	}

	_, frame := h.fetchAs("/api/frame", "iframe", "same-origin")
	if i, j := strings.Index(frame, "MutationObserver"), strings.Index(frame, "addEventListener('message'"); i < 0 || j < i {
		t.Fatalf("the html block frame does not start with the shield: %q", frame)
	}
}

func TestAWebPageOpenedAsATabGoesToTheViewer(t *testing.T) {
	h := newHarness(t, echo)
	h.write("charts/q1 pie.html", "<p>pie</p>")
	h.write("top.html", "<p>top</p>")

	for path, want := range map[string]string{
		"/api/files/charts/q1%20pie.html": "../../../view.html#file=charts/q1%20pie.html",
		"/api/files/top.html":             "../../view.html#file=top.html",
	} {
		for _, site := range []string{"none", "same-origin", "cross-site"} {
			resp, body := h.fetchAs(path, "document", site)
			if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != want || strings.Contains(body, "<p>") {
				t.Errorf("%s from %s: status %d location %q body %q", path, site, resp.StatusCode, resp.Header.Get("Location"), body)
			}
		}
	}
}

func TestAWebPageIsRefusedToOtherSitesAndOtherLoads(t *testing.T) {
	h := newHarness(t, echo)
	h.write("page.html", "<p>secret</p>")

	for _, c := range [][2]string{
		{"iframe", "cross-site"}, {"iframe", "same-site"}, {"empty", "same-origin"}, {"object", "same-origin"},
		{"embed", "same-origin"}, {"script", "same-origin"}, {"frame", "same-origin"},
	} {
		resp, body := h.fetchAs("/api/files/page.html", c[0], c[1])
		if resp.StatusCode != http.StatusForbidden || strings.Contains(body, "secret") {
			t.Errorf("%v: status %d body %q", c, resp.StatusCode, body)
		}
	}
}

func TestTheHTMLBlockFrameRunsUnderThePagePolicy(t *testing.T) {
	h := newHarness(t, echo)
	resp, body := h.fetchAs("/api/frame", "iframe", "same-origin")
	if resp.StatusCode != 200 || !strings.Contains(body, "postMessage") {
		t.Fatalf("status %d body %q", resp.StatusCode, body)
	}
	checkPageHeaders(t, resp)
	for _, c := range [][2]string{{"document", "none"}, {"iframe", "cross-site"}, {"empty", "same-origin"}} {
		if resp, _ := h.fetchAs("/api/frame", c[0], c[1]); resp.StatusCode != http.StatusForbidden {
			t.Errorf("%v: status %d", c, resp.StatusCode)
		}
	}
}

func unescape(p string) (string, error) { return url.PathUnescape(p) }
