// Package web holds the browser UI, built into the binary.
package web

import "embed"

//go:embed index.html app.js md.js chart.js plugins.js frames.js view.html view.js stats.js reveal.js match.js work.js agents.js models.js makers.js appearance.js palette.js mcp.js filekind.js stream.js avatar.js theme.js style.css fonts logos brand favicon.ico favicon.svg apple-touch-icon.png icon-192.png icon-512.png icon-maskable-512.png safari-pinned-tab.svg og-image.png site.webmanifest vendor
var FS embed.FS
