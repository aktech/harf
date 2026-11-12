# Harf

A self-hosted chat interface whose replies come from the [Pi](https://pi.dev) coding agent. Harf is one Go binary with the web UI built in; for each chat it runs `pi --mode rpc` and streams Pi's answer to the browser. Pi can read and write files and run shell commands in a workspace folder, so a chat can do real work, not just talk.

## Features

- Streaming replies with Markdown, tables, task lists, footnotes, math and highlighted code (copy button on every block).
- Stop a reply, edit a message and resend, regenerate a reply, copy any message.
- Chat history: search, pin, rename, delete, export as Markdown.
- **Agents**: a name, icon, description, instructions, and an optional model, thinking level and list of allowed Pi tools.
- **Agent builder**: ask in any chat, such as "make me an agent that reviews Go code, uses Claude Sonnet, no bash", and Pi saves the agent with its `create_agent` tool. The reply shows the agent with a button to start a chat with it. Pi can also change and list agents. Turn it off under Plugins.
- **MCP servers**: add a server under Settings, either a command Pi starts or a URL, then test it to see its tools. Pi connects to every server that is on, unless an agent picks its own, and each tool call shows as a step in the reply. Env and header values are kept in `<HARF_DATA>/mcp.json`, readable by its owner only, and the browser only ever sees them hidden. Servers that sign in with OAuth are not supported yet.
- **Attachments**: attach, paste or drop files up to 100 MB each, up to 10 per message. Each is saved in the workspace under `uploads/<chat>/`, where Pi's tools can open it. Pictures up to 10 MB are also shown to models that take images; a bigger one is only saved.
- Any model Pi has credentials for; pick the model per chat.
- **Image generation** (with an OpenRouter key or login in Pi): Pi gets a `generate_image` tool that saves pictures in the workspace under `images/`, and picking an image model for a chat makes each message an image prompt. The image model is chosen under Plugins.
- Light and dark themes, keyboard shortcuts, phone layout.

## Run locally

You need Pi 1.4.0 installed and either signed in (run `pi`, then `/login`) or a provider key in the environment.

```sh
make build
ANTHROPIC_API_KEY=... ./bin/harf        # http://127.0.0.1:8080
```

| Variable | What it does |
|---|---|
| `HARF_ADDR` | Listen address (default `127.0.0.1:8080`; the image uses `:8080`) |
| `HARF_DATA` | Where chats, agents and Pi sessions are stored (default `~/.harf`) |
| `HARF_WORKSPACE` | Folder Pi's tools work in (default `<HARF_DATA>/workspace`) |
| `HARF_PI` | The Pi executable (default `pi` on `PATH`) |
| `HARF_DEFAULT_MODEL` | Model for new chats, as `provider/id`, such as `anthropic/claude-sonnet-5-5` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY` | Provider keys, read by Pi. The full list is in [Pi's provider docs](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/providers.md) |
| `PI_CODING_AGENT_DIR` | Pi's settings and saved logins (default `~/.pi/agent`) |
| `PI_OFFLINE` | `1` stops Pi's automatic network calls, such as model list refreshes and tool downloads (set in the image) |

Harf offers the models Pi can use with the credentials it finds. With no key and no login, the model list is empty.

Harf has no sign-in of its own, and Pi runs commands for whoever can reach it. It listens on localhost by default; put it behind a reverse proxy that signs people in before exposing it.

An MCP server added as a command runs on this machine as the user running Harf, with that user's files and Harf's whole environment, provider keys included. Since Harf has no sign-in, anyone who can reach it can add one, which is the same as running any command; only the person using Harf should be able to reach it.

## Deploy with Docker

CI publishes the image to `ghcr.io/aktech/harf` for `linux/amd64` and `linux/arm64`: `:main` and `:sha-<commit>` from every push to `main`, and `:<version>` plus `:latest` from every `v*` tag. To build it yourself:

The image holds Harf, Pi 1.4.0, bash, git, ripgrep and fd on Debian 13 slim, for `linux/amd64` and `linux/arm64`. `make image` downloads Pi and checks it against the release's SHA-256 hashes before building.

```sh
make image IMAGE=registry.example.com/you/harf:0.1.0
docker push registry.example.com/you/harf:0.1.0
```

Run it with port `8080` published, a provider key in the environment (such as `ANTHROPIC_API_KEY`) and a volume at `/home/user`, so chats, Pi's settings and the workspace survive restarts:

```sh
docker run -p 8080:8080 -e ANTHROPIC_API_KEY -v harf:/home/user registry.example.com/you/harf:0.1.0
```

The image points everything at that folder:

- `HOME=/home/user`, so Pi keeps its settings in `/home/user/.pi/agent`.
- `HARF_DATA=/home/user/.harf` and `HARF_WORKSPACE=/home/user/workspace`.

The UI uses relative URLs, so it also works behind a proxy that serves it under a path prefix.

Harf shows who is signed in at the top right. `GET /api/me` answers `200 {"username": ..., "name": ...}` from the `X-Forwarded-Preferred-Username` header (or `X-Forwarded-User` without it) that an authenticating proxy such as oauth2-proxy sets on every request, and otherwise names the user running Harf on its computer (`204` only when that is unknown). Harf believes these headers only because that proxy removes any copies the browser sent. Anyone who reaches Harf directly can send them and be named as anyone, so when deployed, Harf must be reachable only through such a proxy. The name shown is not access control: Harf still has no sign-in of its own.

Keep it private. There is no sign-in of its own, everyone who can reach it sees the same chats, and Pi's bash tool runs commands inside the container, where your secrets are in the environment.

## Develop

```sh
make test      # go vet, Go tests, and the Markdown renderer's tests (node --test)
make run       # build and run on http://127.0.0.1:8080
make pi        # download and verify Pi for the image into bin/
```

The browser code is plain JavaScript modules in `web/` (no build step). `web/md.js` renders Markdown with markdown-it, KaTeX and highlight.js, vendored in `web/vendor/` (each with its licence and a SOURCE.txt naming the exact npm tarball and its sha256); raw HTML in model output is always escaped.

## License

Harf is licensed under the [Apache License 2.0](LICENSE). The libraries, fonts, logos and icons in `web/vendor/`, `web/fonts/`, `web/logos/` and `web/icons/` keep their own licences, which sit next to them.
