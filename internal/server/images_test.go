package server

import (
	"testing"

	"github.com/aktech/harf/internal/pi"
	"github.com/aktech/harf/internal/plugins"
)

var imageModels = []pi.Model{
	{ID: "openrouter/img-1", Name: "Image One", Provider: "openrouter"},
	{ID: "openrouter/img-2", Name: "Image Two", Provider: "openrouter"},
}

func imagesPlugin(t *testing.T, h *harness) plugins.Plugin {
	t.Helper()
	var list []plugins.Plugin
	h.do("GET", "/api/plugins", nil, &list)
	for _, p := range list {
		if p.ID == plugins.Images {
			return p
		}
	}
	t.Fatalf("no image plugin in %+v", list)
	return plugins.Plugin{}
}

func TestWithoutImageModelsImageGenerationIsOffAndSaysWhy(t *testing.T) {
	h := newHarness(t, echo)
	if p := imagesPlugin(t, h); p.Enabled || p.Unavailable == "" {
		t.Fatalf("plugin %+v", p)
	}
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "draw a cat"})
	if s := h.agent.lastSpec(); s.ImageModel != "" {
		t.Fatalf("pi got image model %q with none available", s.ImageModel)
	}
}

func TestImageModelsAreListedAndTheChosenOneReachesPi(t *testing.T) {
	h := newHarnessWithImages(t, echo, imageModels)
	var cfg struct {
		ImageModels []pi.Model `json:"imageModels"`
		ImageModel  string     `json:"imageModel"`
	}
	h.do("GET", "/api/config", nil, &cfg)
	if len(cfg.ImageModels) != 2 || cfg.ImageModels[1] != imageModels[1] || cfg.ImageModel != "openrouter/img-1" {
		t.Fatalf("config %+v", cfg)
	}
	if p := imagesPlugin(t, h); !p.Enabled || p.Unavailable != "" {
		t.Fatalf("plugin %+v", p)
	}
	c := h.newChat(map[string]any{})
	h.send(c.ID, map[string]any{"content": "draw a cat"})
	if s := h.agent.lastSpec(); s.ImageModel != "openrouter/img-1" || s.ImageOnly || s.Model != "fake/small" {
		t.Fatalf("spec %+v", s)
	}

	if resp := h.do("PUT", "/api/image-model", map[string]any{"model": "openrouter/img-2"}, nil); resp.StatusCode != 200 {
		t.Fatalf("choose: status %d", resp.StatusCode)
	}
	h.do("GET", "/api/config", nil, &cfg)
	h.send(c.ID, map[string]any{"content": "and a dog"})
	if s := h.agent.lastSpec(); s.ImageModel != "openrouter/img-2" || cfg.ImageModel != "openrouter/img-2" {
		t.Fatalf("after choosing: spec %q, config %q", s.ImageModel, cfg.ImageModel)
	}
	if resp := h.do("PUT", "/api/image-model", map[string]any{"model": "fake/small"}, nil); resp.StatusCode != 400 {
		t.Fatalf("a chat model as image model: status %d", resp.StatusCode)
	}

	h.do("PUT", "/api/plugins/images", map[string]any{"enabled": false}, nil)
	h.send(c.ID, map[string]any{"content": "and a bird"})
	if s := h.agent.lastSpec(); s.ImageModel != "" {
		t.Fatalf("plugin off, yet pi got image model %q", s.ImageModel)
	}
}

func TestAChatWithAnImageModelGetsImagesForReplies(t *testing.T) {
	h := newHarnessWithImages(t, echo, imageModels)
	c := h.newChat(map[string]any{"model": "openrouter/img-2"})
	h.send(c.ID, map[string]any{"content": "a lighthouse at dusk"})
	if s := h.agent.lastSpec(); !s.ImageOnly || s.ImageModel != "openrouter/img-2" {
		t.Fatalf("spec %+v", s)
	}
	h.waitReply(c.ID)
	// The title comes from the message: an image model cannot write one.
	if got := h.chat(c.ID).Title; got != "a lighthouse at dusk" || len(h.agent.titles) != 0 {
		t.Fatalf("title %q, asked for titles %v", got, h.agent.titles)
	}
}
