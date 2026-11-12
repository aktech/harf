package server

import (
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// inline lists the file types shown in the browser. Web pages are shown
// only in Harf's sandboxed frames (see webpage.go); every other type is sent
// as a download, so a file Pi wrote never opens as part of this app.
var inline = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true, "image/avif": true,
	"image/svg+xml": true, "text/plain": true, "text/csv": true, "application/json": true, "application/pdf": true,
}

// file serves one file from the workspace, read-only. The path must be
// relative and stay inside the workspace, symbolic links included.
func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	rel, ok := workspacePath(r.PathValue("path"))
	if !ok {
		badRequest(w, "a file path must be relative to the workspace")
		return
	}
	f, err := openInWorkspace(s.workspace, rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	ct := mime.TypeByExtension(path.Ext(rel))
	if ct == "" {
		ct = "application/octet-stream"
	}
	base, _, _ := strings.Cut(ct, ";")
	h := w.Header()
	if base == "text/html" {
		if r.Header.Get("Sec-Fetch-Dest") == "document" {
			toViewer(w, rel)
			return
		}
		if !framedByHarf(w, r) {
			return
		}
		if info.Size() > maxPage {
			http.Error(w, "this page is too large to show", http.StatusRequestEntityTooLarge)
			return
		}
		b, err := io.ReadAll(f)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		pageHeaders(h)
		w.Write(pageBody(b))
		return
	}
	h.Set("Content-Type", ct)
	h.Set("Cache-Control", "no-cache")
	// A file never runs as part of this app: scripts are off and it gets an
	// origin of its own, even when opened directly (an SVG with a script).
	h.Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	if !inline[base] {
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(rel)}))
	}
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// workspacePath cleans a path given relative to the workspace. It refuses
// absolute paths and any that climb out with "..".
func workspacePath(p string) (string, bool) {
	p = strings.ReplaceAll(p, "\\", "/")
	if p == "" || strings.HasPrefix(p, "/") || filepath.IsAbs(p) || filepath.VolumeName(p) != "" {
		return "", false
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return "", false
		}
	}
	p = path.Clean(p)
	return p, p != "."
}

// openInWorkspace opens rel through an os.Root, which refuses any path,
// symbolic links included, that leads outside the workspace.
func openInWorkspace(workspace, rel string) (*os.File, error) {
	root, err := os.OpenRoot(workspace)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.Open(rel)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fs.ErrNotExist
	}
	return f, err
}
