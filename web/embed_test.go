package web

import (
	"io/fs"
	"regexp"
	"testing"
)

// A module the page imports but the binary leaves out stops the whole page
// from loading.
func TestEveryImportedModuleIsBuiltIn(t *testing.T) {
	imp := regexp.MustCompile(`(?m)^import .* from '\./([^']+)';`)
	pages, _ := fs.Glob(FS, "*.js")
	for _, p := range pages {
		b, _ := fs.ReadFile(FS, p)
		for _, m := range imp.FindAllStringSubmatch(string(b), -1) {
			if _, err := fs.Stat(FS, m[1]); err != nil {
				t.Errorf("%s imports %s, which is not built in", p, m[1])
			}
		}
	}
}
