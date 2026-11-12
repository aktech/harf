import { test } from 'node:test';
import assert from 'node:assert/strict';
import './libs.mjs';
import { renderMarkdown } from './md.js';
import { markdownHooks, toolImage, fileURL } from './plugins.js';

const all = new Set(['workspace-images', 'chart', 'svg']);
const md = (src, on = all) => renderMarkdown(src, markdownHooks(on, { workspace: '/srv/ws' }));
const chart = '```chart\n{"type":"bar","labels":["a","b"],"series":[{"name":"n","data":[1,2]}]}\n```';
const drawing = '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle r="4" onload="alert(2)"/></svg>\n```';

test('a workspace image is drawn from the files endpoint', () => {
  const out = md('![Sales "Q1"](charts/sales%20q1.png)');
  assert.ok(out.includes('<img src="api/files/charts/sales%20q1.png" alt="Sales &quot;Q1&quot;" loading="lazy">'), out);
});

test('an absolute path inside the workspace is drawn too', () => {
  assert.ok(md('![x](/srv/ws/out/a.png)').includes('src="api/files/out/a.png"'));
});

test('images from elsewhere are never fetched', () => {
  for (const src of ['https://example.com/a.png', '//example.com/a.png', '../a.png', 'a/../../b.png', 'a/%2e%2e/%2e%2e/b.png', '/etc/a.png',
    'data:image/svg+xml,<svg onload=alert(1)>', 'javascript:alert(1)//a.png', 'notes.csv']) {
    const out = md(`![x](${src})`);
    assert.ok(!out.includes('<img'), `${src}: ${out}`);
  }
  assert.ok(md('![x](https://example.com/a.png)').includes('<a href="https://example.com/a.png"'));
});

test('an svg block is shown as an image, where its scripts cannot run', () => {
  const out = md(drawing);
  assert.match(out, /^<figure class="drawing"><img src="data:image\/svg\+xml;charset=utf-8,[^"<>]+" alt="Drawing"><\/figure>$/);
  assert.ok(decodeURIComponent(out.match(/,([^"]+)"/)[1]).includes('<script>'), 'the drawing itself is kept whole');
});

test('an svg block that is not an svg, or still streaming, stays code', () => {
  assert.match(md('```svg\nnot a drawing\n```'), /<pre data-lang="svg">/);
  assert.match(md('```svg\n<svg viewBox="0 0 1 1">'), /<pre data-lang="svg">/);
});

test('a chart block is drawn, and a broken one says why under its code', () => {
  assert.match(md(chart), /^<figure class="chart">/);
  const out = md('```chart\n{"type":"pie","series":[{"data":[1]}]}\n```');
  assert.match(out, /<pre data-lang="chart">/);
  assert.match(out, /<p class="chart-error">Chart not drawn: type must be line, bar or scatter<\/p>/);
});

test('with the plugins off every block and image falls back to plain Markdown', () => {
  const out = md(`${chart}\n\n${drawing}\n\n![x](a.png)`, new Set());
  assert.equal((out.match(/<pre data-lang="(chart|svg)">/g) || []).length, 2, out);
  assert.ok(!out.includes('<img') && !out.includes('<figure'), out);
});

test('an image a tool wrote is shown under its step', () => {
  const t = (name, path, status = 'done') => ({ name, status, args: JSON.stringify({ path }) });
  assert.equal(toolImage(t('write', 'plots/a.png'), '/srv/ws'), 'api/files/plots/a.png');
  assert.equal(toolImage(t('edit', '/srv/ws/b.svg'), '/srv/ws'), 'api/files/b.svg');
  assert.equal(toolImage(t('write', 'plots/a.png', 'running'), '/srv/ws'), null);
  assert.equal(toolImage(t('write', 'notes.md'), '/srv/ws'), null);
  assert.equal(toolImage(t('write', '/etc/a.png'), '/srv/ws'), null);
  assert.equal(toolImage(t('bash', 'a.png'), '/srv/ws'), null);
});

test('file links encode every part of the path', () => {
  assert.equal(fileURL('uploads/c1/a b#?.png'), 'api/files/uploads/c1/a%20b%23%3F.png');
});
