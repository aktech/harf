#!/bin/sh
# Copies Harf's page (web/) into site/demo/ for the landing page's demo, with
# demo-api.js loaded first so the page talks to a pretend server in the
# browser. Run from anywhere: site/build.sh
set -eu
site=$(cd "$(dirname "$0")" && pwd)
web="$site/../web"
rm -rf "$site/demo"
mkdir -p "$site/demo"
(cd "$web" && tar cf - --exclude '*.test.mjs' --exclude '*.go' .) | (cd "$site/demo" && tar xf -)
cp "$site/demo-api.js" "$site/demo/demo-api.js"
# demo-api.js must run before theme.js and app.js.
sed 's|<script src="theme.js"></script>|<script src="demo-api.js"></script>\n<script src="theme.js"></script>|' "$web/index.html" > "$site/demo/index.html"
grep -q 'demo-api.js' "$site/demo/index.html" || { echo "build.sh: could not add demo-api.js to index.html" >&2; exit 1; }
echo "site/demo built"
