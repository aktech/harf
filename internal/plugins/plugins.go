// Package plugins lists Harf's built-in plugins. A plugin can add text to
// Pi's system prompt and turn on parts of the web UI (renderers, attachment
// handlers). Each can be turned off; an off plugin adds nothing to Pi and the
// UI falls back to plain Markdown.
package plugins

import "strings"

// Plugin is one plugin as the UI lists it.
type Plugin struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// System is added to Pi's system prompt while the plugin is on.
	System string `json:"system,omitempty"`
	// Web names the parts of the web UI the plugin turns on.
	Web     []string `json:"web"`
	Enabled bool     `json:"enabled"`
	// Unavailable says why the plugin cannot work now; it is then off.
	Unavailable string `json:"unavailable,omitempty"`
}

const (
	Attachments  = "attachments"
	Workspace    = "workspace"
	Charts       = "charts"
	WebPages     = "web-pages"
	Images       = "images"
	AgentBuilder = "agent-builder"
)

// Builtin is every plugin Harf ships, in the order the UI lists them.
var Builtin = []Plugin{
	{
		ID:          Attachments,
		Name:        "Attachments",
		Description: "Attach files and images to a message. Files are saved in the workspace under uploads, and images also go straight to models that can see them.",
		Web:         []string{"attach"},
	},
	{
		ID:          Workspace,
		Name:        "Workspace images",
		Description: "Show images from the workspace in replies, and under the step that wrote them. Image links to other sites stay links.",
		System: "Harf shows images from the workspace (your working folder). To show an image file, embed it in your reply with Markdown, " +
			"using a path relative to the workspace: ![short description](charts/sales.png). Image URLs from the web are shown only as links, " +
			"so save an image into the workspace first if it should be seen. An image you create with the write tool is also shown under that step.",
		Web: []string{"workspace-images"},
	},
	{
		ID:          Charts,
		Name:        "Charts and drawings",
		Description: "Draw line, bar and scatter charts from a small JSON block, and show SVG drawings, in the app's own colours.",
		System: "Harf draws charts and drawings in replies.\n\n" +
			"To draw a chart, write a fenced code block whose language is chart, holding one JSON object:\n" +
			"```chart\n" +
			`{"type": "line", "title": "Monthly sales", "x": {"label": "Month"}, "y": {"label": "Units"},` + "\n" +
			` "labels": ["Jan", "Feb", "Mar"],` + "\n" +
			` "series": [{"name": "North", "data": [12, 19, 15]}, {"name": "South", "data": [8, 11, 14]}]}` + "\n" +
			"```\n" +
			"type is line, bar or scatter. For line and bar, labels names the points along x and each series' data has one number per label. " +
			"For scatter, or a line over numeric x, leave out labels and give data as [x, y] pairs. Use at most 8 series. " +
			"Prefer a chart block to drawing a chart by hand or writing plotting code, unless a file is asked for.\n\n" +
			"To show a diagram or illustration, write a fenced code block whose language is svg, holding one complete <svg> element with a viewBox. " +
			"It is shown as an image, so scripts, links and external files do not work inside it.",
		Web: []string{"chart", "svg"},
	},
	{
		ID:   WebPages,
		Name: "Web pages",
		Description: "Show HTML pages Pi writes, such as interactive charts and diagrams, in replies. " +
			"Each runs in a locked-down frame: it can run its own scripts but cannot reach Harf, your data or the network. Turned off, pages are links.",
		System: "Harf shows web pages in replies. For a chart, diagram or any other visual that a chart or svg block cannot draw, " +
			"write one self-contained .html file in the workspace: CSS and JavaScript inline and the data embedded in the page. " +
			"Load libraries only from https://cdnjs.cloudflare.com, with an exact version in the URL. " +
			"The page cannot make network requests, load images or fonts from the web, open windows or submit forms, " +
			"and iframes, shadow DOM, document.write and WebRTC are turned off, so do not rely on them. " +
			"Use prefers-color-scheme so it suits light and dark themes. Show it with a Markdown image or link to its path relative to the workspace: " +
			"![Sales by region](charts/sales.html). A short page can instead go in a fenced code block whose language is html.",
		Web: []string{"web-pages"},
	},
	{
		ID:   Images,
		Name: "Image generation",
		Description: "Make pictures with an image model, such as FLUX or Gemini image models on OpenRouter. " +
			"Images are saved in the workspace under images and shown in the reply.",
		Web: []string{},
	},
	{
		ID:   AgentBuilder,
		Name: "Agent builder",
		Description: "Create and change agents by asking in any chat, such as: make me an agent that reviews Go code, with no bash. " +
			"The reply shows the new agent with a button to start a chat with it.",
		System: "You can create, change and list the user's Harf agents with the create_agent, update_agent and list_agents tools. " +
			"An agent is a saved, reusable setup: its own instructions, and optionally a model, a thinking level, Pi tools and MCP servers. " +
			"Use these tools whenever the user asks you to make, set up, change or save an agent, assistant, persona, bot or reusable setup, " +
			"such as \"make me an agent that reviews Go code, uses Claude Sonnet, no bash\". " +
			"Call list_agents first to see the exact model ids, tools and MCP servers, pick the ones that match what the user asked for, " +
			"write clear instructions for the agent, then call create_agent (or update_agent for an existing one). " +
			"Leave out what the user did not ask about, so the defaults apply. Harf shows the saved agent in your reply with a button to start a chat with it.",
		Web: []string{"agent-card"},
	},
}

// List returns the built-in plugins, each marked on unless off says so.
func List(off func(id string) bool) []Plugin {
	out := make([]Plugin, len(Builtin))
	for i, p := range Builtin {
		p.Enabled = !off(p.ID)
		out[i] = p
	}
	return out
}

// Find returns the built-in plugin id.
func Find(id string) (Plugin, bool) {
	for _, p := range Builtin {
		if p.ID == id {
			return p, true
		}
	}
	return Plugin{}, false
}

// System joins what the plugins that are on add to Pi's system prompt.
func System(ps []Plugin) string {
	var out []string
	for _, p := range ps {
		if p.Enabled && p.System != "" {
			out = append(out, p.System)
		}
	}
	return strings.Join(out, "\n\n")
}
