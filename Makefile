VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
IMAGE   ?= harf:$(VERSION)
LDFLAGS := -s -w -X main.version=$(VERSION)

# Pi, the coding agent that writes Harf's replies, goes into the image.
# The hashes are copied from the release's SHA256SUMS and checked on every
# download, so a changed release asset fails the build.
PI_VERSION      := 1.4.0
PI_URL          := https://github.com/earendil-works/pi/releases/download/v$(PI_VERSION)
PI_SHA256_amd64 := f2e4e4329603223d03260cdb8bd5033dbdc1f73ba58ab8939db2e56546e115d2
PI_SHA256_arm64 := fa5829c7ef83ffeaebba015715c8306220f89b2aa8a00154efbba98dd5440156
SHA256SUM       := $(shell command -v sha256sum >/dev/null 2>&1 && echo sha256sum || echo shasum -a 256)

.PHONY: build test run linux pi image dist clean

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/harf .

test:
	go vet ./...
	go test ./...
	node --test web/*.test.mjs

run: build
	./bin/harf

linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/harf-linux-amd64 .
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/harf-linux-arm64 .

# Downloads and verifies Pi for both image platforms into bin/pi-linux-<arch>/pi/.
pi: bin/pi-linux-amd64/pi/pi bin/pi-linux-arm64/pi/pi

# Pi calls its x86-64 build x64; Docker calls it amd64.
bin/pi-linux-amd64/pi/pi: PI_ASSET := pi-linux-x64.tar.gz
bin/pi-linux-arm64/pi/pi: PI_ASSET := pi-linux-arm64.tar.gz
bin/pi-linux-%/pi/pi:
	mkdir -p bin/dl
	curl -fsSL --proto '=https' -o bin/dl/$(PI_ASSET) $(PI_URL)/$(PI_ASSET)
	echo "$(PI_SHA256_$*)  bin/dl/$(PI_ASSET)" | $(SHA256SUM) -c -
	rm -rf bin/pi-linux-$*
	mkdir -p bin/pi-linux-$*
	tar -xzf bin/dl/$(PI_ASSET) -C bin/pi-linux-$*
	touch $@

image: linux pi
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE) .

# Release archives: the binary with the licence and README, for each
# platform Pi publishes a build for, plus SHA256SUMS.
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64
dist:
	rm -rf dist && mkdir -p dist
	set -e; for p in $(PLATFORMS); do \
	  os=$${p%/*}; arch=$${p#*/}; name=harf_$${os}_$${arch}; \
	  mkdir -p dist/$$name; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" -o dist/$$name/harf .; \
	  cp LICENSE README.md dist/$$name/; \
	  tar -C dist -czf dist/$$name.tar.gz $$name; \
	  rm -rf dist/$$name; \
	done
	cd dist && $(SHA256SUM) *.tar.gz > SHA256SUMS

clean:
	rm -rf bin dist
