package pi

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/aktech/harf/internal/store"
)

// reducer builds a reply's parts from Pi's events, in the order they happen,
// and reports each change through emit.
type reducer struct {
	emit  func(Event)
	parts []store.Part
	model string
	err   string
	// block maps the content index of the assistant message being streamed
	// to its part; each message numbers its blocks from 0.
	block map[int]int
	tools map[string]int // tool call id to its part
	usage store.Usage
	// start is when the prompt was sent; streaming is when the current
	// model call sent its first token, zero until then.
	start, first, streaming time.Time
}

// maxOutput caps the tool output kept for a part: enough to read, small
// enough that a chatty command cannot bloat the chat file.
const maxOutput = 32 << 10

type piEvent struct {
	Type    string    `json:"type"`
	Message piMessage `json:"message"`
	Update  struct {
		Type         string `json:"type"`
		ContentIndex int    `json:"contentIndex"`
		Delta        string `json:"delta"`
		ID           string `json:"id"`
		ToolName     string `json:"toolName"`
		ToolCall     struct {
			ID        string          `json:"id"`
			Arguments json.RawMessage `json:"arguments"`
		} `json:"toolCall"`
	} `json:"assistantMessageEvent"`
	ToolCallID    string          `json:"toolCallId"`
	ToolName      string          `json:"toolName"`
	Args          json.RawMessage `json:"args"`
	PartialResult toolResult      `json:"partialResult"`
	Result        toolResult      `json:"result"`
	IsError       bool            `json:"isError"`
	DurationMs    int64           `json:"durationMs"`
}

type toolResult struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

func (t toolResult) text() string {
	var b strings.Builder
	for _, c := range t.Content {
		if c.Type == "text" {
			b.WriteString(c.Text)
		}
	}
	s := b.String()
	if len(s) > maxOutput {
		s = s[:maxOutput/2] + "\n\n[... output shortened ...]\n\n" + s[len(s)-maxOutput/2:]
	}
	return s
}

type piMessage struct {
	Role         string `json:"role"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	StopReason   string `json:"stopReason"`
	ErrorMessage string `json:"errorMessage"`
	Usage        struct {
		Input      int64 `json:"input"`
		Output     int64 `json:"output"`
		CacheRead  int64 `json:"cacheRead"`
		CacheWrite int64 `json:"cacheWrite"`
		Reasoning  int64 `json:"reasoning"`
		Cost       struct {
			Total float64 `json:"total"`
		} `json:"cost"`
	} `json:"usage"`
}

func (r *reducer) apply(rec json.RawMessage) {
	var e piEvent
	if json.Unmarshal(rec, &e) != nil {
		return
	}
	switch e.Type {
	case "message_start":
		if e.Message.Role == "assistant" {
			r.block = map[int]int{}
			r.err = ""
			if e.Message.Model != "" {
				r.model = e.Message.Provider + "/" + e.Message.Model
			}
		}
	case "message_end":
		if e.Message.Role != "assistant" {
			return
		}
		u := e.Message.Usage
		r.usage.Input += u.Input
		r.usage.Output += u.Output
		r.usage.CacheRead += u.CacheRead
		r.usage.CacheWrite += u.CacheWrite
		r.usage.Reasoning += u.Reasoning
		r.usage.Cost += u.Cost.Total
		r.usage.Calls++
		if !r.streaming.IsZero() {
			r.usage.StreamMs += time.Since(r.streaming).Milliseconds()
			r.streaming = time.Time{}
		}
		switch e.Message.StopReason {
		case "error":
			r.err = e.Message.ErrorMessage
			if r.err == "" {
				r.err = "the model failed"
			}
		case "aborted":
			r.err = stopped
		}
	case "tool_execution_start":
		r.tool(e.ToolCallID, func(t *store.Tool) {
			t.Status = "running"
			if len(e.Args) > 0 {
				t.Args = e.Args
			}
		})
	case "tool_execution_update":
		r.tool(e.ToolCallID, func(t *store.Tool) { t.Output = e.PartialResult.text() })
	case "tool_execution_end":
		r.tool(e.ToolCallID, func(t *store.Tool) {
			t.Output, t.Ms, t.Status = e.Result.text(), e.DurationMs, "done"
			if e.IsError {
				t.Status = "error"
			}
		})
	case "message_update":
		u := e.Update
		switch u.Type {
		case "text_delta", "thinking_delta", "toolcall_delta":
			now := time.Now()
			if r.streaming.IsZero() {
				r.streaming = now
			}
			if r.first.IsZero() && u.Type != "toolcall_delta" {
				r.first = now
			}
		}
		switch u.Type {
		case "text_start", "thinking_start":
			r.add(u.ContentIndex, store.Part{Type: strings.TrimSuffix(u.Type, "_start")})
		case "toolcall_start":
			r.add(u.ContentIndex, store.Part{Type: "tool", Tool: &store.Tool{ID: u.ID, Name: u.ToolName, Status: "pending"}})
			r.tools[u.ID] = len(r.parts) - 1
		case "toolcall_end":
			r.tool(u.ToolCall.ID, func(t *store.Tool) { t.Args = u.ToolCall.Arguments })
		case "text_delta", "thinking_delta":
			if i, ok := r.block[u.ContentIndex]; ok {
				r.parts[i].Text += u.Delta
				r.emit(Event{Index: i, Delta: u.Delta})
			}
		}
	}
}

// tool changes the tool call's part and reports the new state.
func (r *reducer) tool(id string, fn func(*store.Tool)) {
	i, ok := r.tools[id]
	if !ok {
		return
	}
	t := *r.parts[i].Tool
	fn(&t)
	r.parts[i].Tool = &t
	p := r.parts[i]
	r.emit(Event{Index: i, Part: &p})
}

func (r *reducer) add(block int, p store.Part) {
	r.parts = append(r.parts, p)
	i := len(r.parts) - 1
	r.block[block] = i
	cp := p
	r.emit(Event{Index: i, Part: &cp})
}

func (r *reducer) text() string {
	var out []string
	for _, p := range r.parts {
		if p.Type == "text" && strings.TrimSpace(p.Text) != "" {
			out = append(out, strings.TrimSpace(p.Text))
		}
	}
	return strings.Join(out, "\n\n")
}

// result is the reply's usage, or nil when Pi reported no tokens.
func (r *reducer) result() *store.Usage {
	u := r.usage
	if u.Input+u.Output+u.CacheRead+u.CacheWrite == 0 {
		return nil
	}
	u.Ms = time.Since(r.start).Milliseconds()
	if !r.first.IsZero() {
		u.FirstMs = r.first.Sub(r.start).Milliseconds()
	}
	return &u
}
