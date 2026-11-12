# Configuration

Harf reads these environment variables. The first five also have a command-line flag (`-addr`, `-data`, `-workspace`, `-pi`, `-model`).

| Variable | What it does |
|---|---|
| `HARF_ADDR` | Listen address (default `127.0.0.1:8080`; the image uses `:8080`) |
| `HARF_DATA` | Where chats, agents and Pi sessions are stored (default `~/.harf`) |
| `HARF_WORKSPACE` | Folder Pi's tools work in (default `<HARF_DATA>/workspace`) |
| `HARF_PI` | The Pi executable (default `pi` on `PATH`) |
| `HARF_DEFAULT_MODEL` | Model for new chats, as `provider/id`, such as `openrouter/qwen/qwen3-coder` |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY` | Provider keys, read by Pi. The full list is in [Pi's provider docs](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/providers.md) |
| `PI_CODING_AGENT_DIR` | Pi's settings and saved logins (default `~/.pi/agent`) |
| `PI_OFFLINE` | `1` stops Pi's automatic network calls, such as model list refreshes and tool downloads (set in the image) |

Harf offers the models Pi can use with the credentials it finds. With no key and no login, the model list is empty.

## MCP servers

Add a server under Settings, either a command Pi starts or a URL, then test it to see its tools. Pi connects to every server that is on, unless an agent picks its own. Env and header values are kept in `<HARF_DATA>/mcp.json`, readable by its owner only, and the browser only sees them hidden. Servers that sign in with OAuth are not supported yet.

## Plugins

Each plugin can be turned off under Plugins:

- **Attachments**: attach, paste or drop files up to 100 MB each, up to 10 per message. Each is saved in the workspace under `uploads/<chat>/`. Pictures up to 10 MB also go to models that take images.
- **Workspace images**: images from the workspace show in replies.
- **Charts and drawings**: line, bar and scatter charts from a small JSON block, and SVG drawings, in the app's colours.
- **Web pages**: HTML pages Pi writes show in replies, in a locked-down frame that cannot reach Harf, your data or the network.
- **Image generation** (with an OpenRouter key or login in Pi): Pi gets a `generate_image` tool that saves pictures under `images/`, and picking an image model for a chat makes each message an image prompt.
- **Agent builder**: ask in any chat, such as "make me an agent that reviews Go code, no bash", and Pi saves the agent.
