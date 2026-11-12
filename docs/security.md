# Security

**Harf has no sign-in of its own.** Everyone who can reach it sees the same chats, and Pi runs shell commands for them in the workspace, with Harf's environment, provider keys included. Harf listens on localhost by default. To share it, put it behind a reverse proxy that signs people in, and make sure that proxy is the only way to reach it.

## MCP servers

An MCP server added as a command runs on this machine as the user running Harf, with that user's files and Harf's whole environment. Anyone who can reach Harf can add one, which is the same as running any command.

## Web pages in replies

HTML pages Pi writes run in a sandboxed frame. They can run their own scripts but cannot reach Harf, your data or the network. Raw HTML in model output is always escaped in the Markdown itself.

## Who is signed in

The card at the bottom left of the sidebar shows who is using Harf. `GET /api/me` answers `200 {"username": ..., "name": ...}` from the `X-Forwarded-Preferred-Username` header (or `X-Forwarded-User` without it), which an authenticating proxy such as oauth2-proxy sets on every request. Without either header it names the user running Harf on its computer, and answers `204` only when that is unknown.

Harf trusts these headers only because the proxy removes any copies the browser sent. Anyone who reaches Harf directly can send them and be shown as anyone, which is another reason the proxy must be the only way in. The name shown is not access control.
