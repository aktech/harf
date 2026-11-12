// Package pi runs replies through the Pi coding agent: it starts
// `pi --mode rpc` for each reply, sends the prompt, and turns Pi's event
// stream into reply parts (text, thinking, tool calls) as they happen.
package pi

import (
	"bufio"
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/aktech/harf/internal/store"
)

// Runner starts Pi. Each chat is one Pi session, kept in SessionDir.
type Runner struct {
	Bin        string   // the pi executable
	Dir        string   // working folder for Pi's tools
	SessionDir string   // where Pi keeps sessions
	Env        []string // added to Harf's own environment
	// Extension is the image extension's file (see WriteExtension); empty
	// leaves image generation out.
	Extension string
	// MCPExtension and AgentExtension are the files of the extensions that
	// hand Pi Harf's MCP servers and add the agent builder tools.
	MCPExtension   string
	AgentExtension string
}

// Spec is one reply to produce.
type Spec struct {
	Session  string   // Pi session id; created when it does not exist yet
	Model    string   // provider/id; empty uses Pi's default
	Thinking string   // off, minimal, low, medium, high, xhigh or max; empty uses Pi's default
	Tools    []string // nil keeps Pi's default tools; empty turns all tools off
	System   string   // added to Pi's system prompt
	// ForkAt, when above 0, first takes the session back to just before
	// its ForkAt'th user message (1 is the first) in a new session.
	// ForkText is that message's text: when Pi's session has a different
	// count (a reply that failed before reaching Pi), the message with this
	// text nearest to ForkAt is used.
	ForkAt   int
	ForkText string
	Prompt   string
	Images   []Image // sent with the prompt; only for models that take images
	// ImageModel, when set, gives Pi the generate_image tool, which makes
	// images with this image model (provider/id).
	ImageModel string
	// ImageOnly sends the prompt straight to ImageModel, with no chat
	// model: the reply is the image. The chat's session is left as it is.
	ImageOnly bool
	// MCP are the MCP servers Pi connects to for this reply, on top of
	// the user's own Pi settings. Their tools are added to Tools.
	MCP []store.MCPServer
	// AgentTools, when set, gives Pi the agent builder tools and answers
	// their calls: op is create_agent, update_agent or list_agents and args
	// the call's arguments. The result reaches the model as JSON.
	AgentTools func(ctx context.Context, op string, args json.RawMessage) (any, error)
}

// Image is a picture the model sees with the prompt.
type Image struct {
	MimeType string
	Data     []byte
}

// Event is one change to a reply while it streams. Part, when set, adds or
// replaces the part at Index; Delta appends text to it.
type Event struct {
	Index int         `json:"index"`
	Part  *store.Part `json:"part,omitempty"`
	Delta string      `json:"delta,omitempty"`
}

// Result is a finished reply.
type Result struct {
	Parts   []store.Part
	Text    string // the reply's text parts, joined
	Session string // the session the reply ended in (a fork makes a new one)
	Model   string
	Error   string       // why the reply failed, or "Stopped"
	Usage   *store.Usage // nil when Pi reported no tokens
}

const stopped = "Stopped"

// Run produces one reply. Cancelling ctx stops the reply: Pi is told to
// abort, and what it had produced so far is returned with Error "Stopped".
func (r *Runner) Run(ctx context.Context, s Spec, emit func(Event)) Result {
	res := Result{Session: s.Session}
	if s.ImageOnly {
		return r.image(ctx, s, emit)
	}
	mcp, err := r.writeMCP(s.MCP)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer os.Remove(mcp)
	p, err := r.start(r.args(s, mcp))
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer p.close()
	if s.AgentTools != nil {
		p.answer = func(title, prefill string) (string, bool) { return answerAgentTool(ctx, s.AgentTools, title, prefill) }
	}

	if s.ForkAt > 0 {
		if res.Session, err = p.fork(ctx, s.ForkAt, s.ForkText); err != nil {
			res.Error = err.Error()
			return res
		}
	}
	red := reducer{emit: emit, tools: map[string]int{}}
	prompt := map[string]any{"type": "prompt", "message": s.Prompt}
	if len(s.Images) > 0 {
		imgs := make([]map[string]string, len(s.Images))
		for i, im := range s.Images {
			imgs[i] = map[string]string{"type": "image", "mimeType": im.MimeType, "data": base64.StdEncoding.EncodeToString(im.Data)}
		}
		prompt["images"] = imgs
	}
	red.start = time.Now()
	if _, err := p.call(ctx, prompt); err != nil {
		res.Error = err.Error()
		return res
	}
	err = p.events(ctx, red.apply)
	res.Parts, res.Text, res.Model, res.Error = red.parts, red.text(), red.model, red.err
	res.Usage = red.result()
	if err != nil {
		res.Error = err.Error()
	}
	if ctx.Err() != nil {
		// Pi words a stop by where it happened ("This operation was
		// aborted" in a tool); to the reader it is one thing.
		res.Error = stopped
	}
	return res
}

// args are Pi's arguments for the reply; mcp is the file holding its MCP
// servers, if any.
func (r *Runner) args(s Spec, mcp string) []string {
	a := []string{"--mode", "rpc", "--session-dir", r.SessionDir, "--session-id", s.Session}
	if s.Model != "" {
		a = append(a, "--model", s.Model)
	}
	if s.Thinking != "" {
		a = append(a, "--thinking", s.Thinking)
	}
	// Tools that Harf's extensions and MCP servers add join an agent's
	// list. Tools lists Pi's own tools, so an agent with none still gets
	// them.
	var extra []string
	if s.ImageModel != "" && r.Extension != "" {
		a = append(a, "--extension", r.Extension, "--harf-image-model", s.ImageModel)
		extra = append(extra, imageTool)
	}
	if s.AgentTools != nil && r.AgentExtension != "" {
		a = append(a, "--extension", r.AgentExtension)
		extra = append(extra, agentTools...)
	}
	if mcp != "" {
		a = append(a, "--extension", r.MCPExtension, "--harf-mcp", mcp)
	}
	switch tools := slices.Concat(s.Tools, extra, mcpTools(s.MCP)); {
	case s.Tools == nil:
	case len(tools) == 0:
		a = append(a, "--no-tools")
	default:
		a = append(a, "--tools", strings.Join(tools, ","))
	}
	if strings.TrimSpace(s.System) != "" {
		a = append(a, "--append-system-prompt", s.System)
	}
	return a
}

// image makes the reply an image: the image extension saves it in the
// workspace and the reply shows it.
func (r *Runner) image(ctx context.Context, s Spec, emit func(Event)) Result {
	res := Result{Session: s.Session, Model: s.ImageModel}
	if r.Extension == "" {
		res.Error = "image generation is not set up"
		return res
	}
	p, err := r.start(append(append([]string{}, quiet...), "--extension", r.Extension, "--harf-image-model", s.ImageModel))
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer p.close()
	data, err := p.command(ctx, "/harf-generate-image "+s.Prompt)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	var out struct {
		Paths []string `json:"paths"`
		Error string   `json:"error"`
	}
	json.Unmarshal(data, &out)
	if out.Error != "" || len(out.Paths) == 0 {
		res.Error = cmp.Or(out.Error, "the image model returned no image")
		return res
	}
	alt := strings.NewReplacer("[", "", "]", "", "\n", " ").Replace(s.Prompt)
	if r := []rune(alt); len(r) > 100 {
		alt = string(r[:100])
	}
	var imgs []string
	for _, path := range out.Paths {
		imgs = append(imgs, "!["+alt+"]("+path+")")
	}
	res.Text = strings.Join(imgs, "\n\n")
	part := store.Part{Type: "text", Text: res.Text}
	res.Parts = []store.Part{part}
	emit(Event{Index: 0, Part: &part})
	return res
}

// fork takes the session back to just before its n'th user message (1 is
// the first), in a new session, and returns that session's id.
func (p *proc) fork(ctx context.Context, n int, text string) (string, error) {
	data, err := p.call(ctx, map[string]any{"type": "get_fork_messages"})
	if err != nil {
		return "", err
	}
	var fm struct {
		Messages []struct {
			EntryID string `json:"entryId"`
			Text    string `json:"text"`
		} `json:"messages"`
	}
	json.Unmarshal(data, &fm)
	at := -1
	if n <= len(fm.Messages) && (text == "" || fm.Messages[n-1].Text == text) {
		at = n - 1
	} else {
		for i, m := range fm.Messages {
			if m.Text == text && (at < 0 || abs(i-(n-1)) < abs(at-(n-1))) {
				at = i
			}
		}
	}
	if at < 0 {
		return "", errors.New("pi's session has no record of that message")
	}
	if _, err := p.call(ctx, map[string]any{"type": "fork", "entryId": fm.Messages[at].EntryID}); err != nil {
		return "", err
	}
	data, err = p.call(ctx, map[string]any{"type": "get_state"})
	if err != nil {
		return "", err
	}
	var st struct {
		SessionID string `json:"sessionId"`
	}
	json.Unmarshal(data, &st)
	if st.SessionID == "" {
		return "", errors.New("pi did not say which session the fork made")
	}
	return st.SessionID, nil
}

// proc is one running pi process.
type proc struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	recs   chan json.RawMessage
	stderr *tail
	mu     sync.Mutex
	seq    int
	// answer replies to an extension's editor dialog; false declines it.
	answer func(title, prefill string) (string, bool)
}

func (r *Runner) start(args []string) (*proc, error) {
	cmd := exec.Command(r.Bin, args...)
	cmd.Dir = r.Dir
	cmd.Env = append(os.Environ(), r.Env...)
	stderr := &tail{}
	cmd.Stderr = stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pi: %w", err)
	}
	p := &proc{cmd: cmd, stdin: stdin, recs: make(chan json.RawMessage, 64), stderr: stderr}
	go p.read(stdout)
	return p, nil
}

// read splits stdout on LF only: JSON strings may hold U+2028, which some
// line readers also treat as a line end.
func (p *proc) read(stdout io.Reader) {
	defer close(p.recs)
	br := bufio.NewReaderSize(stdout, 1<<16)
	for {
		line, err := br.ReadBytes('\n')
		if line = bytes.TrimRight(line, "\r\n"); len(line) > 0 {
			p.recs <- json.RawMessage(line)
		}
		if err != nil {
			return
		}
	}
}

func (p *proc) send(cmd map[string]any) error {
	b, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	_, err = p.stdin.Write(append(b, '\n'))
	return err
}

type response struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Success bool            `json:"success"`
	Error   string          `json:"error"`
	Data    json.RawMessage `json:"data"`
}

// call sends a command and waits for its response. Events that arrive
// first are dropped: call is only used while no reply is streaming.
func (p *proc) call(ctx context.Context, cmd map[string]any) (json.RawMessage, error) {
	p.seq++
	id := fmt.Sprintf("harf-%d", p.seq)
	cmd["id"] = id
	if err := p.send(cmd); err != nil {
		return nil, p.died(err)
	}
	for {
		select {
		case <-ctx.Done():
			return nil, errors.New(stopped)
		case rec, ok := <-p.recs:
			if !ok {
				return nil, p.died(nil)
			}
			var r response
			if json.Unmarshal(rec, &r) != nil || r.Type != "response" || r.ID != id {
				continue
			}
			if !r.Success {
				return nil, fmt.Errorf("pi refused %s: %s", cmd["type"], r.Error)
			}
			return r.Data, nil
		}
	}
}

// events feeds Pi's events to fn until Pi settles. When ctx ends, Pi is
// told to abort and events keeps reading until Pi has stopped.
func (p *proc) events(ctx context.Context, fn func(json.RawMessage)) error {
	done := ctx.Done()
	for {
		select {
		case <-done:
			done = nil
			if err := p.send(map[string]any{"type": "abort"}); err != nil {
				return errors.New(stopped)
			}
		case rec, ok := <-p.recs:
			if !ok {
				if ctx.Err() != nil {
					return errors.New(stopped)
				}
				return p.died(nil)
			}
			var head struct{ Type, ID, Method string }
			json.Unmarshal(rec, &head)
			switch head.Type {
			case "agent_settled":
				return nil
			case "extension_ui_request":
				if head.Method == "editor" && p.answer != nil {
					var d struct{ Title, Prefill string }
					json.Unmarshal(rec, &d)
					if v, ok := p.answer(d.Title, d.Prefill); ok {
						p.send(map[string]any{"type": "extension_ui_response", "id": head.ID, "value": v})
						continue
					}
				}
				// Harf has nowhere to show an extension's dialog, so it
				// declines it rather than leave Pi waiting.
				switch head.Method {
				case "select", "confirm", "input", "editor":
					p.send(map[string]any{"type": "extension_ui_response", "id": head.ID, "cancelled": true})
				}
				continue
			}
			fn(rec)
		}
	}
}

// died explains why pi stopped answering, using what it last wrote to stderr.
func (p *proc) died(err error) error {
	if msg := strings.TrimSpace(p.stderr.String()); msg != "" {
		return fmt.Errorf("pi stopped: %s", msg)
	}
	if err != nil {
		return fmt.Errorf("pi stopped: %w", err)
	}
	return errors.New("pi stopped without finishing the reply")
}

// close ends stdin, which asks Pi to shut down, and kills it if it does not.
func (p *proc) close() {
	p.stdin.Close()
	done := make(chan struct{})
	go func() { p.cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		p.cmd.Process.Kill()
		<-done
	}
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// tail keeps the last few KB written to it.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tail) Write(b []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, b...)
	if n := len(t.buf); n > 4096 {
		t.buf = t.buf[n-4096:]
	}
	return len(b), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

// Model is one model Pi can use.
type Model struct {
	ID        string `json:"id"` // provider/id, as --model takes it
	Name      string `json:"name"`
	Provider  string `json:"provider"`
	Reasoning bool   `json:"reasoning"` // supports a thinking level
	Images    bool   `json:"images"`    // accepts images with the prompt
}

// quiet runs Pi for a one-off request: no session, and none of the user's
// extensions, skills or project files.
var quiet = []string{"--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
	"--no-prompt-templates", "--no-context-files", "--no-mcp"}

// Models lists the models Pi has credentials for.
func (r *Runner) Models(ctx context.Context) ([]Model, error) {
	p, err := r.start(quiet)
	if err != nil {
		return nil, err
	}
	defer p.close()
	data, err := p.call(ctx, map[string]any{"type": "get_available_models"})
	if err != nil {
		return nil, err
	}
	var out struct {
		Models []struct {
			Model
			Input []string `json:"input"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("read pi's models: %w", err)
	}
	ms := make([]Model, len(out.Models))
	for i, m := range out.Models {
		ms[i] = m.Model
		ms[i].ID = m.Provider + "/" + m.ID
		ms[i].Images = slices.Contains(m.Input, "image")
	}
	return ms, nil
}

// Complete asks a model for a short answer, with no tools and no session.
func (r *Runner) Complete(ctx context.Context, model, system, prompt string) (string, error) {
	// No --thinking: some models refuse the "off" setting Pi 1.4.0 sends.
	args := append(append([]string{}, quiet...), "--no-tools", "--system-prompt", system)
	if model != "" {
		args = append(args, "--model", model)
	}
	p, err := r.start(args)
	if err != nil {
		return "", err
	}
	defer p.close()
	red := reducer{emit: func(Event) {}, tools: map[string]int{}}
	if _, err := p.call(ctx, map[string]any{"type": "prompt", "message": prompt}); err != nil {
		return "", err
	}
	if err := p.events(ctx, red.apply); err != nil {
		return "", err
	}
	if red.err != "" {
		return "", errors.New(red.err)
	}
	return red.text(), nil
}

// imageTool is the tool the image extension adds.
const imageTool = "generate_image"

// ImageModels lists the image models Pi has credentials for. Pi's own model
// list holds chat models only, so the image extension is asked.
func (r *Runner) ImageModels(ctx context.Context) ([]Model, error) {
	if r.Extension == "" {
		return nil, nil
	}
	p, err := r.start(append(append([]string{}, quiet...), "--extension", r.Extension))
	if err != nil {
		return nil, err
	}
	defer p.close()
	data, err := p.command(ctx, "/harf-image-models")
	if err != nil {
		return nil, err
	}
	var out struct {
		Models []Model `json:"models"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("read the image extension's models: %w", err)
	}
	return out.Models, nil
}

// command runs an extension command and returns the last notification it
// sent: each of Harf's answers with a single JSON notification.
func (p *proc) command(ctx context.Context, line string) (json.RawMessage, error) {
	p.seq++
	id := fmt.Sprintf("harf-%d", p.seq)
	if err := p.send(map[string]any{"type": "prompt", "id": id, "message": line}); err != nil {
		return nil, p.died(err)
	}
	var said json.RawMessage
	handled := false
	for {
		select {
		case <-ctx.Done():
			return nil, errors.New(stopped)
		case rec, ok := <-p.recs:
			if !ok {
				return nil, p.died(nil)
			}
			var head struct {
				Type, ID, Method, Message string
				Success                   bool
				Error                     string
				Data                      struct{ Disposition string }
			}
			json.Unmarshal(rec, &head)
			switch {
			case head.Type == "extension_ui_request" && head.Method == "notify":
				said = json.RawMessage(head.Message)
			case head.Type == "response" && head.ID == id:
				if !head.Success {
					return nil, fmt.Errorf("pi refused %s: %s", line, head.Error)
				}
				if head.Data.Disposition != "handled" {
					p.send(map[string]any{"type": "abort"})
					return nil, fmt.Errorf("pi did not run %s: Harf's extension is not loaded", strings.Fields(line)[0])
				}
				handled = true
			}
			if handled && said != nil {
				return said, nil
			}
		}
	}
}
