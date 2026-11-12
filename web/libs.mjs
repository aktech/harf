// Loads the vendored libraries for tests under Node the way the page does:
// each <script src="vendor/..."> in index.html runs, in order, as a plain
// script, so it sets the same globals it sets in the browser.

import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';

const dir = new URL('./', import.meta.url);
const page = readFileSync(new URL('index.html', dir), 'utf8');
for (const [, src] of page.matchAll(/<script[^>]*\ssrc="(vendor\/[^"]+)"/g)) {
  const file = new URL(src, dir);
  runInThisContext(readFileSync(file, 'utf8'), { filename: file.pathname });
}
