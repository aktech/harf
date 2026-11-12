package server

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/plugins"
	"github.com/aktech/harf/internal/store"
)

// removeHalfUploads deletes the temp files of uploads that a stop of the
// server cut off; a finished upload never keeps that name.
func removeHalfUploads(workspace string) {
	parts, _ := filepath.Glob(filepath.Join(workspace, "uploads", "*", ".*.part"))
	for _, p := range parts {
		os.Remove(p)
	}
}

// maxUpload caps one attached file. The page is told it in /api/config.
const maxUpload = 100 << 20

// maxModelImage caps an attached picture sent to a model that takes images.
// A bigger one is still saved for Pi's tools. Pi shrinks each picture to
// its model's size before sending it, so this only bounds what Harf reads
// into memory and hands Pi.
const maxModelImage = 10 << 20

// nameHeader carries an uploaded file's name, URL-encoded.
const nameHeader = "X-Harf-Name"

// upload saves a file sent as the raw request body in uploads/<chat>/ in
// the workspace, so Pi's tools can open it. The body is written to disk as
// it arrives, never held whole in memory.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	if !s.pluginOn(plugins.Attachments) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "the Attachments plugin is off"})
		return
	}
	id := r.PathValue("id")
	if _, err := s.store.GetChat(id); err != nil {
		fail(w, err)
		return
	}
	name, err := url.PathUnescape(r.Header.Get(nameHeader))
	name = strings.TrimSpace(name)
	if err != nil || name == "" || strings.ContainsAny(name, "/\\\x00") {
		badRequest(w, "send the file's name, without folders, in the "+nameHeader+" header")
		return
	}
	if r.ContentLength > maxUpload {
		tooLarge(w)
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxUpload)
	rel, head, n, err := s.saveNew(path.Join("uploads", id), safeName(name), body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			tooLarge(w)
			return
		}
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, store.Attachment{
		Name: clip(name, 200), Path: rel, Type: fileType(rel, head), Size: n,
	})
}

func tooLarge(w http.ResponseWriter) {
	writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": fmt.Sprintf("a file can be at most %d MB", maxUpload>>20)})
}

// saveNew writes what body sends to a new file named name in dir, adding
// -2, -3 and so on to the name when a file of that name is already there.
// It writes to a hidden temporary file first and moves it into place only
// when all of body arrived, so a failed or cut-off upload leaves nothing.
// It returns the file's path, its first bytes and its size.
func (s *Server) saveNew(dir, name string, body io.Reader) (rel string, head []byte, n int64, err error) {
	root, err := os.OpenRoot(s.workspace)
	if err != nil {
		return "", nil, 0, err
	}
	defer root.Close()
	if err := root.MkdirAll(dir, 0o700); err != nil {
		return "", nil, 0, err
	}
	// safeName never starts with a dot, so the temporary name cannot be
	// taken for an upload or attached.
	tmp := path.Join(dir, "."+rand.Text()+".part")
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", nil, 0, err
	}
	defer root.Remove(tmp) // fails once the file is moved into place
	sniff := &headWriter{max: 512}
	n, err = io.Copy(io.MultiWriter(f, sniff), body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", nil, 0, err
	}
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i < 1000; i++ {
		rel = path.Join(dir, name)
		if i > 1 {
			rel = path.Join(dir, fmt.Sprintf("%s-%d%s", stem, i, ext))
		}
		// Claim the name first: a rename would replace a file already there.
		claim, err := root.OpenFile(rel, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", nil, 0, err
		}
		claim.Close()
		if err := root.Rename(tmp, rel); err != nil {
			root.Remove(rel)
			return "", nil, 0, err
		}
		return rel, sniff.b, n, nil
	}
	return "", nil, 0, errors.New("too many files with that name")
}

// headWriter keeps the first max bytes written to it.
type headWriter struct {
	b   []byte
	max int
}

func (h *headWriter) Write(p []byte) (int, error) {
	if room := h.max - len(h.b); room > 0 {
		h.b = append(h.b, p[:min(room, len(p))]...)
	}
	return len(p), nil
}

// safeName keeps a file name's last part, with only letters, digits, dot,
// dash and underscore, and never starting with a dot.
func safeName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = name[strings.LastIndex(name, "/")+1:]
	var b strings.Builder
	dash := false
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
			dash = r == '-'
		} else if !dash {
			b.WriteRune('-')
			dash = true
		}
	}
	out := strings.TrimLeft(b.String(), ".-")
	if r := []rune(out); len(r) > 100 {
		ext := path.Ext(out)
		if len([]rune(ext)) > 20 {
			ext = ""
		}
		out = string(r[:100-len([]rune(ext))]) + ext
	}
	if out == "" {
		return "file"
	}
	return out
}

// fileType names a file's media type from its extension, or from its first
// bytes when the extension says nothing.
func fileType(name string, data []byte) string {
	t := mime.TypeByExtension(path.Ext(name))
	if t == "" {
		t = http.DetectContentType(data)
	}
	t, _, _ = strings.Cut(t, ";")
	return t
}

// attachments checks that each file was uploaded to this chat and is still
// there, and describes it from the file itself rather than the request.
func (s *Server) attachments(chatID string, in []store.Attachment) ([]store.Attachment, error) {
	if len(in) == 0 {
		return nil, nil
	}
	if len(in) > maxAttachments {
		return nil, fmt.Errorf("a message can carry at most %d files", maxAttachments)
	}
	dir := path.Join("uploads", chatID)
	out := make([]store.Attachment, 0, len(in))
	for _, a := range in {
		name, ok := strings.CutPrefix(a.Path, dir+"/")
		if !ok || name != safeName(name) {
			return nil, fmt.Errorf("%s is not a file attached to this chat", a.Path)
		}
		f, err := openInWorkspace(s.workspace, a.Path)
		if err != nil {
			return nil, fmt.Errorf("%s is no longer in the workspace", a.Path)
		}
		head := make([]byte, 512)
		n, _ := f.Read(head)
		info, err := f.Stat()
		f.Close()
		if err != nil || !info.Mode().IsRegular() {
			return nil, fmt.Errorf("%s is not a file", a.Path)
		}
		label := clip(strings.TrimSpace(a.Name), 200)
		if label == "" {
			label = name
		}
		out = append(out, store.Attachment{Name: label, Path: a.Path, Type: fileType(a.Path, head[:n]), Size: info.Size()})
	}
	return out, nil
}

// maxAttachments caps the files on one message.
const maxAttachments = 10

// seeable lists the image types sent to models that take images.
var seeable = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

// images reads the attached pictures for the model, when it takes images.
// A file whose bytes are not the picture its name says is left out.
func (s *Server) images(ctx context.Context, model string, atts []store.Attachment) []pi.Image {
	var out []pi.Image
	for _, a := range atts {
		if !seeable[a.Type] {
			continue
		}
		if out == nil && !s.seesImages(ctx, model) {
			return nil
		}
		f, err := openInWorkspace(s.workspace, a.Path)
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, maxModelImage+1))
		f.Close()
		if err != nil || len(data) > maxModelImage || http.DetectContentType(data) != a.Type {
			continue
		}
		out = append(out, pi.Image{MimeType: a.Type, Data: data})
	}
	return out
}

func (s *Server) seesImages(ctx context.Context, model string) bool {
	ms, _ := s.listModels(ctx)
	i := slices.IndexFunc(ms, func(m pi.Model) bool { return m.ID == model })
	return i >= 0 && ms[i].Images
}

// promptFor is the text Pi gets for a user message: what they wrote, then
// where each attached file is, so Pi's tools can open it.
func promptFor(m store.Message) string {
	if len(m.Attachments) == 0 {
		return m.Content
	}
	var b strings.Builder
	if m.Content != "" {
		b.WriteString(m.Content + "\n\n")
	}
	b.WriteString("Attached files, saved in the workspace:")
	for _, a := range m.Attachments {
		fmt.Fprintf(&b, "\n- %s (%s, %s)", a.Path, a.Type, size(a.Size))
	}
	return b.String()
}

func size(n int64) string {
	switch {
	case n < 1<<10:
		return fmt.Sprintf("%d bytes", n)
	case n < 1<<20:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	}
}
