package pi

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aktech/harf/internal/store"
)

const settled = `{"type":"agent_settled","aborted":false}`

func TestRunStreamsReplyText(t *testing.T) {
	r, _ := fake(t, scenario{
		Responses: map[string]json.RawMessage{"get_state": json.RawMessage(`{"sessionId":"s-1"}`)},
		Prompt: events(
			`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
			`{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}`,
			`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hel"}}`,
			`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"lo"}}`,
			`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}],"stopReason":"stop"}}`,
			settled,
		),
	})
	var deltas string
	res := r.Run(context.Background(), Spec{Session: "s-1", Prompt: "hi"}, func(e Event) { deltas += e.Delta })
	if res.Error != "" {
		t.Fatalf("error: %s", res.Error)
	}
	if deltas != "Hello" {
		t.Errorf("streamed %q", deltas)
	}
	want := []store.Part{{Type: "text", Text: "Hello"}}
	if len(res.Parts) != 1 || res.Parts[0].Type != want[0].Type || res.Parts[0].Text != want[0].Text {
		t.Errorf("parts = %+v", res.Parts)
	}
	if res.Text != "Hello" || res.Session != "s-1" {
		t.Errorf("text %q session %q", res.Text, res.Session)
	}
}

func TestRunReportsToolCallsAsTheyRun(t *testing.T) {
	r, _ := fake(t, scenario{Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[],"provider":"anthropic","model":"m-1"}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"thinking_start","contentIndex":0}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":0,"delta":"look first"}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":1,"id":"call-1","toolName":"bash"}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_end","contentIndex":1,"toolCall":{"type":"toolCall","id":"call-1","name":"bash","arguments":{"command":"ls"}}}}`,
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"toolUse"}}`,
		`{"type":"tool_execution_start","toolCallId":"call-1","toolName":"bash","args":{"command":"ls"}}`,
		`{"type":"tool_execution_update","toolCallId":"call-1","toolName":"bash","partialResult":{"content":[{"type":"text","text":"a.txt\n"}]}}`,
		`{"type":"tool_execution_end","toolCallId":"call-1","toolName":"bash","result":{"content":[{"type":"text","text":"a.txt\nb.txt\n"}]},"isError":false,"durationMs":12}`,
		`{"type":"message_start","message":{"role":"assistant","content":[],"provider":"anthropic","model":"m-1"}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Two files."}}`,
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop"}}`,
		settled,
	)})
	var statuses []string
	res := r.Run(context.Background(), Spec{Session: "s", Prompt: "list"}, func(e Event) {
		if e.Part != nil && e.Part.Tool != nil {
			statuses = append(statuses, e.Part.Tool.Status)
		}
	})
	if res.Error != "" {
		t.Fatal(res.Error)
	}
	if got := strings.Join(statuses, ","); got != "pending,pending,running,running,done" {
		t.Errorf("tool statuses streamed: %s", got)
	}
	if len(res.Parts) != 3 {
		t.Fatalf("parts = %+v", res.Parts)
	}
	think, tool, text := res.Parts[0], res.Parts[1].Tool, res.Parts[2]
	if think.Type != "thinking" || think.Text != "look first" {
		t.Errorf("thinking = %+v", think)
	}
	if tool.Name != "bash" || string(tool.Args) != `{"command":"ls"}` || tool.Output != "a.txt\nb.txt\n" || tool.Status != "done" || tool.Ms != 12 {
		t.Errorf("tool = %+v (args %s)", tool, tool.Args)
	}
	if text.Text != "Two files." || res.Text != "Two files." {
		t.Errorf("text = %+v, %q", text, res.Text)
	}
	if res.Model != "anthropic/m-1" {
		t.Errorf("model = %q", res.Model)
	}
}

func TestFailedToolIsMarkedAsError(t *testing.T) {
	r, _ := fake(t, scenario{Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":0,"id":"c","toolName":"read"}}`,
		`{"type":"tool_execution_end","toolCallId":"c","toolName":"read","result":{"content":[{"type":"text","text":"no such file"}]},"isError":true}`,
		settled,
	)})
	res := r.Run(context.Background(), Spec{Session: "s", Prompt: "x"}, func(Event) {})
	if tool := res.Parts[0].Tool; tool.Status != "error" || tool.Output != "no such file" {
		t.Errorf("tool = %+v", tool)
	}
}

func TestSpecReachesPi(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(settled)})
	r.Run(context.Background(), Spec{
		Session: "chat-1", Model: "anthropic/m-1", Thinking: "high",
		Tools: []string{"read", "bash"}, System: "Be brief.", Prompt: "hello",
	}, func(Event) {})
	l := log()
	got := strings.Join(l.Args, " ")
	for _, want := range []string{
		"--mode rpc", "--session-id chat-1", "--model anthropic/m-1", "--thinking high",
		"--tools read,bash", "--append-system-prompt Be brief.",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("args %q lack %q", got, want)
		}
	}
	if want, _ := filepath.EvalSymlinks(r.Dir); l.Dir != want {
		t.Errorf("pi ran in %s, want %s", l.Dir, r.Dir)
	}
	if l.Commands[0]["type"] != "prompt" || l.Commands[0]["message"] != "hello" {
		t.Errorf("first command %v", l.Commands[0])
	}

	r.Run(context.Background(), Spec{Session: "chat-1", Tools: []string{}, Prompt: "x"}, func(Event) {})
	if got := strings.Join(log().Args, " "); !strings.Contains(got, "--no-tools") || strings.Contains(got, "--model") {
		t.Errorf("no tools and no model: args %q", got)
	}
}

func TestImagesAreSentWithThePrompt(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(settled)})
	r.Run(context.Background(), Spec{Session: "s", Prompt: "what is this?",
		Images: []Image{{MimeType: "image/png", Data: []byte("png bytes")}}}, func(Event) {})
	c := log().Commands[0]
	imgs, _ := c["images"].([]any)
	if c["message"] != "what is this?" || len(imgs) != 1 {
		t.Fatalf("prompt command %v", c)
	}
	img := imgs[0].(map[string]any)
	if img["type"] != "image" || img["mimeType"] != "image/png" || img["data"] != "cG5nIGJ5dGVz" {
		t.Errorf("image %v", img)
	}

	r.Run(context.Background(), Spec{Session: "s", Prompt: "plain"}, func(Event) {})
	if _, ok := log().Commands[0]["images"]; ok {
		t.Errorf("a prompt without images sent %v", log().Commands[0])
	}
}

func TestModelErrorIsReported(t *testing.T) {
	r, _ := fake(t, scenario{Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"429 rate limited"}}`,
		settled,
	)})
	if res := r.Run(context.Background(), Spec{Session: "s", Prompt: "x"}, func(Event) {}); res.Error != "429 rate limited" {
		t.Errorf("error = %q", res.Error)
	}
}

func TestPiThatCannotStartExplainsWhy(t *testing.T) {
	r, _ := fake(t, scenario{Stderr: "Error: Model not found: nope/nope"})
	res := r.Run(context.Background(), Spec{Session: "s", Prompt: "x"}, func(Event) {})
	if !strings.Contains(res.Error, "Model not found: nope/nope") {
		t.Errorf("error = %q", res.Error)
	}
}

func TestCancellingStopsTheReplyAndKeepsWhatCame(t *testing.T) {
	r, log := fake(t, scenario{WaitAbort: true, Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"partial"}}`,
	)})
	ctx, cancel := context.WithCancel(context.Background())
	res := r.Run(ctx, Spec{Session: "s", Prompt: "x"}, func(e Event) {
		if e.Delta != "" {
			cancel()
		}
	})
	if res.Error != "Stopped" || res.Text != "partial" {
		t.Errorf("error %q text %q", res.Error, res.Text)
	}
	cmds := log().Commands
	if last := cmds[len(cmds)-1]; last["type"] != "abort" {
		t.Errorf("last command %v, want abort", last)
	}
}

func TestStoppingDuringAToolSaysStopped(t *testing.T) {
	r, _ := fake(t, scenario{WaitAbort: true, Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":0,"id":"t1","toolName":"bash"}}`,
		`{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash","args":{"command":"sleep 40"}}`,
	), Aborted: events(
		`{"type":"tool_execution_end","toolCallId":"t1","toolName":"bash","isError":true,"result":{"content":[{"type":"text","text":"aborted"}]}}`,
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"This operation was aborted"}}`,
	)})
	ctx, cancel := context.WithCancel(context.Background())
	res := r.Run(ctx, Spec{Session: "s", Prompt: "x"}, func(e Event) {
		if e.Part != nil && e.Part.Tool != nil && e.Part.Tool.Status == "running" {
			cancel()
		}
	})
	if res.Error != "Stopped" {
		t.Errorf("error %q, want Stopped", res.Error)
	}
}

func TestExtensionDialogsAreDeclined(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(
		`{"type":"extension_ui_request","id":"ui-1","method":"confirm","title":"Allow?"}`,
		`{"type":"extension_ui_request","id":"ui-2","method":"notify","message":"fyi"}`,
		settled,
	)})
	r.Run(context.Background(), Spec{Session: "s", Prompt: "x"}, func(Event) {})
	var answered bool
	for _, c := range log().Commands {
		if c["type"] == "extension_ui_response" && c["id"] == "ui-1" && c["cancelled"] == true {
			answered = true
		}
		if c["id"] == "ui-2" {
			t.Errorf("answered a notification: %v", c)
		}
	}
	if !answered {
		t.Errorf("dialog not declined: %v", log().Commands)
	}
}

func TestForkGoesBackBeforeThatMessageInANewSession(t *testing.T) {
	r, log := fake(t, scenario{
		Responses: map[string]json.RawMessage{
			"get_fork_messages": json.RawMessage(`{"messages":[{"entryId":"e-1","text":"one"},{"entryId":"e-2","text":"two"}]}`),
			"fork":              json.RawMessage(`{"text":"two","cancelled":false}`),
			"get_state":         json.RawMessage(`{"sessionId":"forked-1"}`),
		},
		Prompt: events(settled),
	})
	res := r.Run(context.Background(), Spec{Session: "s", ForkAt: 2, Prompt: "two, edited"}, func(Event) {})
	if res.Error != "" || res.Session != "forked-1" {
		t.Fatalf("error %q session %q", res.Error, res.Session)
	}
	var fork map[string]any
	for _, c := range log().Commands {
		if c["type"] == "fork" {
			fork = c
		}
	}
	if fork["entryId"] != "e-2" {
		t.Errorf("forked at %v", fork)
	}
}

func TestModelsListsWhatPiCanUse(t *testing.T) {
	r, log := fake(t, scenario{Responses: map[string]json.RawMessage{
		"get_available_models": json.RawMessage(`{"models":[
			{"id":"m-1","name":"Model One","provider":"anthropic","reasoning":true,"input":["text","image"]},
			{"id":"m-2","name":"Model Two","provider":"openai","reasoning":false,"input":["text"]}]}`),
	}})
	ms, err := r.Models(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 2 || ms[0] != (Model{ID: "anthropic/m-1", Name: "Model One", Provider: "anthropic", Reasoning: true, Images: true}) ||
		ms[1].Images {
		t.Errorf("models = %+v", ms)
	}
	if args := strings.Join(log().Args, " "); !strings.Contains(args, "--no-session") {
		t.Errorf("listing models must not create a session: %q", args)
	}
}

func TestCompleteAnswersWithoutToolsOrSession(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Trip plans"}}`,
		settled,
	)})
	out, err := r.Complete(context.Background(), "anthropic/m-1", "Write a title.", "convo")
	if err != nil || out != "Trip plans" {
		t.Fatalf("got %q, %v", out, err)
	}
	args := strings.Join(log().Args, " ")
	for _, want := range []string{"--no-session", "--no-tools", "--model anthropic/m-1", "--system-prompt Write a title."} {
		if !strings.Contains(args, want) {
			t.Errorf("args %q lack %q", args, want)
		}
	}
	// Some models refuse "thinking off" (Pi 1.4.0 sends a setting they reject),
	// so a one-off request keeps the model's own default.
	if strings.Contains(args, "--thinking") {
		t.Errorf("args %q set a thinking level", args)
	}
}

func TestRunSumsUsageAcrossTheReplysModelCalls(t *testing.T) {
	r, _ := fake(t, scenario{Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":0,"id":"call-1","toolName":"bash"}}`,
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"toolUse","usage":{"input":1000,"output":40,"cacheRead":200,"cacheWrite":50,"reasoning":10,"totalTokens":1290,"cost":{"total":0.0125}}}}`,
		`{"type":"tool_execution_end","toolCallId":"call-1","toolName":"bash","result":{"content":[]},"isError":false}`,
		`{"type":"message_end","message":{"role":"toolResult","toolCallId":"call-1","content":[],"usage":{"input":9999,"output":9999,"cacheRead":0,"cacheWrite":0,"totalTokens":19998,"cost":{"total":1}}}}`,
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Done."}}`,
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop","usage":{"input":1100,"output":60,"cacheRead":1200,"cacheWrite":0,"reasoning":5,"totalTokens":2360,"cost":{"total":0.0025}}}}`,
		settled,
	)})
	res := r.Run(context.Background(), Spec{Session: "s", Prompt: "go"}, func(Event) {})
	u := res.Usage
	if u == nil {
		t.Fatal("no usage")
	}
	if u.Input != 2100 || u.Output != 100 || u.CacheRead != 1400 || u.CacheWrite != 50 || u.Reasoning != 15 || u.Calls != 2 {
		t.Errorf("usage = %+v", *u)
	}
	if u.Cost < 0.01499 || u.Cost > 0.01501 {
		t.Errorf("cost = %v", u.Cost)
	}
}

func TestRunReportsNoUsageWhenPiReportsNone(t *testing.T) {
	r, _ := fake(t, scenario{Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"no key"}}`,
		settled,
	)})
	if res := r.Run(context.Background(), Spec{Session: "s", Prompt: "go"}, func(Event) {}); res.Usage != nil {
		t.Errorf("usage = %+v", *res.Usage)
	}
}

func TestRunTimesTheReply(t *testing.T) {
	r, _ := fake(t, scenario{Prompt: events(
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"fake_sleep","ms":40}`, // waiting for the model
		`{"type":"message_update","assistantMessageEvent":{"type":"thinking_start","contentIndex":0}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":0,"delta":"hm"}}`,
		`{"type":"fake_sleep","ms":40}`, // streaming
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"toolUse","usage":{"input":10,"output":8}}}`,
		`{"type":"fake_sleep","ms":40}`, // a tool runs
		`{"type":"message_start","message":{"role":"assistant","content":[]}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}`,
		`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"ok"}}`,
		`{"type":"fake_sleep","ms":40}`, // streaming
		`{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop","usage":{"input":20,"output":8}}}`,
		settled,
	)})
	u := r.Run(context.Background(), Spec{Session: "s", Prompt: "go"}, func(Event) {}).Usage
	if u == nil {
		t.Fatal("no usage")
	}
	if u.FirstMs < 40 || u.Ms < 160 || u.FirstMs > u.Ms {
		t.Errorf("first token %dms, total %dms", u.FirstMs, u.Ms)
	}
	// Streaming time leaves out the wait for the first token and the tool.
	if u.StreamMs < 80 || u.Ms-u.StreamMs < 70 {
		t.Errorf("streamed %dms of %dms", u.StreamMs, u.Ms)
	}
}

func TestImageModelGivesPiTheImageTool(t *testing.T) {
	r, log := fake(t, scenario{Prompt: events(settled)})
	r.Extension = "/data/pi/generate_image.js"
	r.Run(context.Background(), Spec{Session: "s", Prompt: "a cat", ImageModel: "openrouter/img-1", Tools: []string{"read"}}, func(Event) {})
	got := strings.Join(log().Args, " ")
	for _, want := range []string{"--extension /data/pi/generate_image.js", "--harf-image-model openrouter/img-1", "--tools read,generate_image"} {
		if !strings.Contains(got, want) {
			t.Errorf("args %q lack %q", got, want)
		}
	}

	r.Run(context.Background(), Spec{Session: "s", Prompt: "a cat"}, func(Event) {})
	if got := strings.Join(log().Args, " "); strings.Contains(got, "--extension") {
		t.Errorf("no image model, yet the image extension was loaded: %q", got)
	}
}

func TestImageModelsAsksTheImageExtension(t *testing.T) {
	r, log := fake(t, scenario{Handled: true, Prompt: events(
		`{"type":"extension_ui_request","id":"ui-1","method":"notify","notifyType":"info",` +
			`"message":"{\"models\":[{\"id\":\"openrouter/img-1\",\"name\":\"Image One\",\"provider\":\"openrouter\"}]}"}`,
	)})
	r.Extension = "/data/pi/generate_image.js"
	ms, err := r.ImageModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 1 || ms[0] != (Model{ID: "openrouter/img-1", Name: "Image One", Provider: "openrouter"}) {
		t.Errorf("image models = %+v", ms)
	}
	l := log()
	if args := strings.Join(l.Args, " "); !strings.Contains(args, "--no-session") || !strings.Contains(args, "--extension /data/pi/generate_image.js") {
		t.Errorf("args %q", args)
	}
	if l.Commands[0]["message"] != "/harf-image-models" {
		t.Errorf("command %v", l.Commands[0])
	}
}

func TestImageModelsWithoutTheExtensionLoadedIsAnError(t *testing.T) {
	// Pi takes an unknown command as a chat prompt and starts a run.
	r, _ := fake(t, scenario{Prompt: events(settled)})
	r.Extension = "/data/pi/generate_image.js"
	if _, err := r.ImageModels(context.Background()); err == nil || !strings.Contains(err.Error(), "/harf-image-models: Harf's extension is not loaded") {
		t.Errorf("err = %v", err)
	}
}

func TestImageOnlyReplyIsTheImageItself(t *testing.T) {
	r, log := fake(t, scenario{Handled: true, Prompt: events(
		`{"type":"extension_ui_request","id":"ui-1","method":"notify","notifyType":"info",` +
			`"message":"{\"model\":\"openrouter/img-1\",\"paths\":[\"images/a-red-fox-1.png\"]}"}`,
	)})
	r.Extension = "/data/pi/generate_image.js"
	var streamed []Event
	res := r.Run(context.Background(), Spec{Session: "s", Model: "openrouter/img-1", ImageModel: "openrouter/img-1", ImageOnly: true, Prompt: "a red fox"},
		func(e Event) { streamed = append(streamed, e) })
	if res.Error != "" {
		t.Fatal(res.Error)
	}
	want := "![a red fox](images/a-red-fox-1.png)"
	if res.Text != want || len(res.Parts) != 1 || res.Parts[0].Text != want || res.Model != "openrouter/img-1" || res.Session != "s" {
		t.Errorf("result %+v", res)
	}
	if len(streamed) != 1 || streamed[0].Part == nil || streamed[0].Part.Text != want {
		t.Errorf("streamed %+v", streamed)
	}
	l := log()
	args := strings.Join(l.Args, " ")
	if !strings.Contains(args, "--harf-image-model openrouter/img-1") || strings.Contains(args, "--model") || strings.Contains(args, "--session-id") {
		t.Errorf("args %q", args)
	}
	if l.Commands[0]["message"] != "/harf-generate-image a red fox" {
		t.Errorf("command %v", l.Commands[0])
	}
}

func TestImageOnlyReportsWhyNoImageCame(t *testing.T) {
	r, _ := fake(t, scenario{Handled: true, Prompt: events(
		`{"type":"extension_ui_request","id":"ui-1","method":"notify","notifyType":"error","message":"{\"error\":\"No image model is available.\"}"}`,
	)})
	r.Extension = "/data/pi/generate_image.js"
	res := r.Run(context.Background(), Spec{Session: "s", ImageModel: "openrouter/img-1", ImageOnly: true, Prompt: "a fox"}, func(Event) {})
	if res.Error != "No image model is available." || len(res.Parts) != 0 {
		t.Errorf("result %+v", res)
	}
}
