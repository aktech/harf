package server

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/aktech/harf/internal/store"
)

// secretMask stands in for every env and header value sent to the
// browser, which may be a secret. Sent back unchanged, it keeps the saved
// value.
const secretMask = "••••••••"

func masked(m store.MCPServer) store.MCPServer {
	mask := func(in map[string]string) map[string]string {
		if in == nil {
			return nil
		}
		out := make(map[string]string, len(in))
		for k := range in {
			out[k] = secretMask
		}
		return out
	}
	m.Env, m.Headers = mask(m.Env), mask(m.Headers)
	return m
}

// unmask puts the saved values back where the browser sent the mask.
func unmask(m store.MCPServer, saved store.MCPServer) (store.MCPServer, error) {
	put := func(in, old map[string]string) (map[string]string, error) {
		if in == nil {
			return nil, nil
		}
		out := make(map[string]string, len(in))
		for k, v := range in {
			if v == secretMask {
				var ok bool
				if v, ok = old[k]; !ok {
					return nil, store.Invalid("enter a value for %s", k)
				}
			}
			out[k] = v
		}
		return out, nil
	}
	var err, err2 error
	m.Env, err = put(m.Env, saved.Env)
	m.Headers, err2 = put(m.Headers, saved.Headers)
	return m, errors.Join(err, err2)
}

func (s *Server) listMCP(w http.ResponseWriter, r *http.Request) {
	list := s.store.ListMCP()
	for i := range list {
		list[i] = masked(list[i])
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) addMCP(w http.ResponseWriter, r *http.Request) {
	var m store.MCPServer
	if !decode(w, r, &m) {
		return
	}
	m, err := unmask(m, store.MCPServer{})
	if err == nil {
		m, err = s.store.AddMCP(m)
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, masked(m))
}

func (s *Server) updateMCP(w http.ResponseWriter, r *http.Request) {
	var m store.MCPServer
	if !decode(w, r, &m) {
		return
	}
	name := r.PathValue("name")
	if m.Name != "" && m.Name != name {
		badRequest(w, "a server cannot be renamed: add it under the new name")
		return
	}
	m.Name = name
	saved, err := s.store.GetMCP(name)
	if err == nil {
		m, err = unmask(m, saved)
	}
	if err == nil {
		m, err = s.store.UpdateMCP(m)
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, masked(m))
}

func (s *Server) deleteMCP(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteMCP(r.PathValue("name")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// testMCP has Pi connect to a server, saved or not, and reports its tools
// or why it failed. Masked values are those of the saved server with the
// same name.
func (s *Server) testMCP(w http.ResponseWriter, r *http.Request) {
	var m store.MCPServer
	if !decode(w, r, &m) {
		return
	}
	saved, _ := s.store.GetMCP(m.Name)
	m, err := unmask(m, saved)
	if err == nil {
		err = m.Check()
	}
	if err != nil {
		fail(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), mcpTestTimeout)
	defer cancel()
	c, err := s.agent.CheckMCP(ctx, m)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// mcpServers are the enabled servers the agent uses: all of them unless
// the agent names some (nil a means no agent).
func (s *Server) mcpServers(a *store.Agent) []store.MCPServer {
	var out []store.MCPServer
	for _, m := range s.store.ListMCP() {
		if m.Enabled && (a == nil || a.MCP == nil || slices.Contains(a.MCP, m.Name)) {
			out = append(out, m)
		}
	}
	return out
}
