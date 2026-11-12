package server

import (
	_ "embed"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// pagePolicy is the Content-Security-Policy of every web page Pi writes,
// whether a workspace .html file or an html block in a reply. The page runs
// in a sandbox with an origin of its own, so it cannot read Harf's cookies,
// storage, pages or API. It may run scripts, its own and libraries from one
// CDN, but can load nothing else: no fetches, images, fonts or frames from
// any server, no forms. Only Harf may frame it. WebRTC, which no policy
// covers, is taken away by the shield.
const pagePolicy = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; " +
	"style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; " +
	"frame-src 'none'; worker-src 'none'; base-uri 'none'; frame-ancestors 'self'"

// shield is the first script of every page; see shield.js.
//
//go:embed shield.js
var shield string

// pageHead starts every page: the shield runs before anything the page holds.
var pageHead = `<!doctype html><meta charset="utf-8"><script>` + shield + `</script>`

// framePage is the frame an html block from a reply is shown in. Harf's
// page posts the block's HTML to it, and it writes that in as its document,
// so the block runs under pagePolicy rather than Harf's own policy. It
// takes the HTML only from the Harf page that framed it. It keeps its own
// copy of document.write, which the shield takes from the page.
var framePage = `<!doctype html><meta charset="utf-8"><script>
(function () {
  var P = Document.prototype, open = P.open, write = P.write, close = P.close, apply = Reflect.apply;
` + shield + `
  if (parent === window) return;
  var harf = new URL(location.href).origin, done = false;
  addEventListener('message', function (e) {
    if (done || e.source !== parent || e.origin !== harf || typeof e.data !== 'string') return;
    done = true;
    apply(open, document, []);
    apply(write, document, [e.data.replace(/shadowrootmode/gi, 'data-no-shadow-root')]);
    apply(close, document, []);
  });
  parent.postMessage('harf:ready', harf);
})();
</script>`

// shadowRoots finds declarative shadow root attributes. They are renamed in
// a page so it has no shadow DOM, where a frame could hide from the shield.
var shadowRoots = regexp.MustCompile(`(?i)shadowrootmode`)

// maxPage is the largest web page served.
const maxPage = 16 << 20

// pageBody is a workspace page as served: the shield, then the page.
func pageBody(b []byte) []byte {
	b = []byte(strings.TrimPrefix(string(b), "\ufeff"))
	return append([]byte(pageHead), shadowRoots.ReplaceAll(b, []byte("data-no-shadow-root"))...)
}

func pageHeaders(h http.Header) {
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", pagePolicy)
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cache-Control", "no-store")
	h.Set("X-DNS-Prefetch-Control", "off")
}

// framedByHarf reports whether r loads a page into a frame on one of Harf's
// own pages, as browsers say in the Fetch Metadata headers a page cannot
// set. Clients that send none, such as curl, are let through: the page
// policy still holds wherever it is shown. Otherwise it refuses r.
func framedByHarf(w http.ResponseWriter, r *http.Request) bool {
	dest, site := r.Header.Get("Sec-Fetch-Dest"), r.Header.Get("Sec-Fetch-Site")
	if (dest == "" || dest == "iframe") && (site == "" || site == "same-origin") {
		return true
	}
	http.Error(w, "this page is shown only inside Harf", http.StatusForbidden)
	return false
}

// frame serves the frame html blocks are shown in.
func (s *Server) frame(w http.ResponseWriter, r *http.Request) {
	if !framedByHarf(w, r) {
		return
	}
	pageHeaders(w.Header())
	w.Write([]byte(framePage))
}

// toViewer sends a web page opened as a tab of its own to Harf's viewer,
// which shows it in a frame. Harf's policy on the viewer stops the page
// from taking the tab elsewhere, which a page in a tab of its own could do.
// The address is relative, so it holds when Harf is served under a prefix.
func toViewer(w http.ResponseWriter, rel string) {
	segs := strings.Split(rel, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	w.Header().Set("Location", strings.Repeat("../", len(segs)+1)+"view.html#file="+strings.Join(segs, "/"))
	w.WriteHeader(http.StatusSeeOther)
}
