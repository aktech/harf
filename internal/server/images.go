package server

import (
	"context"
	"net/http"
	"slices"

	"github.com/aktech/harf/internal/pi"
)

const noImageModel = "Pi has no image model. Sign in to OpenRouter in Pi, or set OPENROUTER_API_KEY, then reload Harf."

func (s *Server) listImageModels(ctx context.Context) ([]pi.Model, error) {
	return s.imageModels.get(ctx, s.agent.ImageModels)
}

// imageModel is the image model that makes images: the one chosen in
// settings while Pi still has it, else Pi's first. Empty when Pi has none.
func (s *Server) imageModel(ctx context.Context) string {
	ms, _ := s.listImageModels(ctx)
	if len(ms) == 0 {
		return ""
	}
	chosen := s.store.ImageModel()
	if slices.ContainsFunc(ms, func(m pi.Model) bool { return m.ID == chosen }) {
		return chosen
	}
	return ms[0].ID
}

// isImageModel reports whether model is one of Pi's image models, which
// make images and cannot chat.
func (s *Server) isImageModel(ctx context.Context, model string) bool {
	ms, _ := s.listImageModels(ctx)
	return slices.ContainsFunc(ms, func(m pi.Model) bool { return m.ID == model })
}

// setImageModel chooses the image model for image generation; an empty
// model goes back to Pi's first.
func (s *Server) setImageModel(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Model string `json:"model"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Model != "" && !s.isImageModel(r.Context(), in.Model) {
		badRequest(w, "not an image model Pi has: "+in.Model)
		return
	}
	if err := s.store.SetImageModel(in.Model); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"imageModel": s.imageModel(r.Context())})
}
