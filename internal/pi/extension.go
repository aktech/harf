package pi

import (
	_ "embed"
	"os"
	"path/filepath"
)

var (
	//go:embed generate_image.js
	imageExtension []byte
	//go:embed mcp.js
	mcpExtension []byte
	//go:embed agents.js
	agentExtension []byte
)

// WriteExtensions writes the extensions built into Harf (images, MCP
// servers, agent builder) into dir and points the Runner at them. Pi loads
// extensions from files, so they are written out on every start.
func (r *Runner) WriteExtensions(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	for _, e := range []struct {
		path *string
		name string
		data []byte
	}{
		{&r.Extension, "generate_image.js", imageExtension},
		{&r.MCPExtension, "mcp.js", mcpExtension},
		{&r.AgentExtension, "agents.js", agentExtension},
	} {
		path := filepath.Join(dir, e.name)
		if err := os.WriteFile(path, e.data, 0o600); err != nil {
			return err
		}
		*e.path = path
	}
	return nil
}
