# Harf and Pi are built or downloaded outside the image (make image), which
# checks Pi's release hash. Pi is a glibc executable and its bash tool runs real
# commands, so the base is Debian slim rather than distroless.
# debian:trixie-20261104-slim (Debian 13.7), built 2026-11-04.
FROM debian:trixie-20261104-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

# ripgrep and fd-find are on PATH so Pi's grep and find tools never download
# their own copies at run time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates=20250419+deb13u1 \
      git=1:2.47.3-0+deb13u1 \
      ripgrep=14.1.1-1+b4 \
      fd-find=10.2.0-1+b5 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /home/user \
 && chmod 1777 /home/user

ARG TARGETARCH
# Pi looks for its themes, docs and wasm next to its executable, so the release
# folder is copied whole.
COPY bin/pi-linux-${TARGETARCH}/pi/ /opt/pi/
COPY bin/harf-linux-${TARGETARCH} /usr/local/bin/harf

# Everything Harf and Pi write lives under /home/user: mount a volume there
# to keep chats, settings and the workspace across restarts.
# PI_OFFLINE stops Pi's automatic network calls (model catalog refresh, tool
# downloads); PI_SKIP_VERSION_CHECK and PI_TELEMETRY=0 stop the rest.
ENV PATH=/opt/pi:$PATH \
    HOME=/home/user \
    SHELL=/bin/bash \
    HARF_ADDR=:8080 \
    HARF_DATA=/home/user/.harf \
    HARF_WORKSPACE=/home/user/workspace \
    PI_OFFLINE=1 \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0

USER 65532:65532
WORKDIR /home/user
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/harf"]
