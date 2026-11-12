# Deploy with Docker

CI publishes `ghcr.io/aktech/harf` for `linux/amd64` and `linux/arm64`: `:main` and `:sha-<commit>` from every push to `main`, and `:<version>`, `:<major>.<minor>` and `:latest` from every `v*` tag.

The image holds Harf, Pi 1.4.0, bash, git, ripgrep and fd on Debian 13 slim. It runs as a non-root user and points everything at `/home/user`:

- `HOME=/home/user`, so Pi keeps its settings in `/home/user/.pi/agent`.
- `HARF_DATA=/home/user/.harf` and `HARF_WORKSPACE=/home/user/workspace`.

Run it with port `8080` published, a provider key in the environment and a volume at `/home/user`, so chats, Pi's settings and the workspace survive restarts:

```sh
docker run -p 8080:8080 -e ANTHROPIC_API_KEY -v harf:/home/user ghcr.io/aktech/harf:main
```

Read [security](security.md) before exposing it: Harf has no sign-in of its own.

The UI uses relative URLs, so it also works behind a proxy that serves it under a path prefix.

## Build the image yourself

`make image` builds Harf for both platforms, downloads Pi and checks it against the release's SHA-256 hashes, then builds the image:

```sh
make image IMAGE=registry.example.com/you/harf:0.1.0
docker push registry.example.com/you/harf:0.1.0
```
