import { test } from 'node:test';
import assert from 'node:assert/strict';
import './libs.mjs';
import { renderMarkdown } from './md.js';
import { markdownHooks } from './plugins.js';
import { frameHTML, viewerFile } from './frames.js';

const on = new Set(['workspace-images', 'web-pages']);
const md = (src, web = on) => renderMarkdown(src, markdownHooks(web, { workspace: '/srv/ws' }));
const page = '```html\n<!doctype html><p class="x">"hi" & bye</p><script>draw()</script>\n```';

test('a frame may only run scripts: no same origin, forms, popups, modals, top navigation or downloads', () => {
  assert.equal(frameHTML('api/files/a "b".html', 'Sales <q1>'),
    '<iframe src="api/files/a &quot;b&quot;.html" title="Sales &lt;q1&gt;" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>');
});

test('a workspace page embedded as an image gets a frame and an Open link to the viewer', () => {
  const out = md('![Sales "Q1"](charts/q1%20pie.html)');
  assert.match(out, /<span class="webpage" data-src="api\/files\/charts\/q1%20pie.html" data-title="Sales &quot;Q1&quot;">/, out);
  assert.ok(out.includes('href="view.html#file=charts/q1%20pie.html" target="_blank" rel="noopener noreferrer">Open</a>'), out);
  assert.ok(!out.includes('<iframe'), 'the frame is made once the page is on screen');
});

test('a link to a workspace page stays a link, to the viewer, with the frame after it', () => {
  const out = md('See [the chart](/srv/ws/out/pie.html) here.');
  assert.match(out, /See <a href="view.html#file=out\/pie.html" target="_blank" rel="noopener noreferrer">the chart<\/a><span class="webpage" data-src="api\/files\/out\/pie.html"/, out);
});

test('an html block gets a frame that holds its source', () => {
  const out = md(page);
  const m = out.match(/^<span class="webpage" data-html="([^"]*)" data-title="HTML">/);
  assert.ok(m, out);
  assert.equal(m[1], '&lt;!doctype html&gt;&lt;p class=&quot;x&quot;&gt;&quot;hi&quot; &amp; bye&lt;/p&gt;&lt;script&gt;draw()&lt;/script&gt;');
  assert.match(md('```html\n<p>still coming'), /^<pre data-lang="html">/);
});

test('with web pages off, pages are links only and html blocks are code', () => {
  const off = new Set(['workspace-images']);
  for (const src of ['![Pie](charts/pie.html)', '[Pie](charts/pie.html)']) {
    const out = md(src, off);
    assert.ok(out.includes('<a href="view.html#file=charts/pie.html" target="_blank" rel="noopener noreferrer">Pie</a>'), out);
    assert.ok(!out.includes('webpage'), out);
  }
  assert.match(md(page, off), /^<pre data-lang="html">/);
  assert.ok(!md('![Pie](charts/pie.html)', new Set()).includes('webpage'));
});

test('pages from anywhere but the workspace get no frame', () => {
  for (const src of ['https://example.com/a.html', '//example.com/a.html', '../a.html', 'a/%2e%2e/%2e%2e/b.html', '/etc/a.html', 'javascript:alert(1)//a.html', 'data:text/html,<p>']) {
    for (const s of [`![x](${src})`, `[x](${src})`]) {
      const out = md(s);
      assert.ok(!out.includes('webpage') && !out.includes('view.html'), `${s}: ${out}`);
    }
  }
  assert.ok(md('[x](https://example.com/a.html)').includes('<a href="https://example.com/a.html"'));
});

test('the viewer opens only workspace pages', () => {
  assert.equal(viewerFile('#file=charts/q1%20pie.html'), 'charts/q1 pie.html');
  for (const h of ['', '#file=', '#file=../a.html', '#file=%2Fetc%2Fa.html', '#file=a.png', '#file=https://example.com/a.html', '#file=%E0%A4%A']) {
    assert.equal(viewerFile(h), null, h);
  }
});
