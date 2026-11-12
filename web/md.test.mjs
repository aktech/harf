import { test } from 'node:test';
import assert from 'node:assert/strict';
import './libs.mjs';
import { renderMarkdown, settle } from './md.js';

// flat drops the line breaks between tags, so a test can compare structure.
const flat = (src, ext) => renderMarkdown(src, ext).replace(/>\n+/g, '>').replace(/\n+</g, '<');
const text = (html) => html.replace(/<[^>]+>/g, '');
const LINK = 'target="_blank" rel="noopener noreferrer"';

test('html in text is escaped, never rendered', () => {
  const out = renderMarkdown('hi <img src=x onerror=alert(1)> <script>alert(1)</script>\n\n<div onclick="x()">block</div>');
  assert.ok(!out.includes('<img'), out);
  assert.ok(!out.includes('<script'), out);
  assert.ok(!out.includes('<div'), out);
  assert.ok(out.includes('&lt;script&gt;'), out);
});

test('only http, https and mailto links become links', () => {
  const out = renderMarkdown('[ok](https://example.com) [mail](mailto:a@example.com) [bad](javascript:alert(1)) [bad2](JAVASCRIPT:alert(2)) ' +
    '[data](data:text/html,x) [rel](/settings) <javascript:alert(3)>');
  assert.ok(out.includes(`<a href="https://example.com" ${LINK}>ok</a>`), out);
  assert.ok(out.includes(`<a href="mailto:a@example.com" ${LINK}>mail</a>`), out);
  assert.equal((out.match(/<a /g) || []).length, 2, out);
  assert.ok(text(out).includes('rel'), out);
});

test('a bare URL becomes a link', () => {
  const out = renderMarkdown('see https://example.com/a?b=1 now');
  assert.ok(out.includes(`<a href="https://example.com/a?b=1" ${LINK}>https://example.com/a?b=1</a>`), out);
});

test('reference links resolve', () => {
  const out = renderMarkdown('read [the docs][d]\n\n[d]: https://example.com/docs');
  assert.ok(out.includes(`<a href="https://example.com/docs" ${LINK}>the docs</a>`), out);
});

test('fenced code keeps its text verbatim and names its language', () => {
  const out = renderMarkdown('```go\nif a < b && **x** {\n}\n```');
  assert.match(out, /<pre[^>]*data-lang="go"/);
  assert.ok(text(out).includes('if a &lt; b &amp;&amp; **x** {'), out);
  assert.ok(!out.includes('<strong>'), out);
});

test('an unclosed fence while streaming still renders as code', () => {
  const out = renderMarkdown('look:\n```py\nprint(1)');
  assert.match(out, /<pre[^>]*data-lang="py"/);
  assert.ok(text(out).includes('print(1)'), out);
});

test('inline formatting', () => {
  const out = renderMarkdown('**bold** *it* `a<b` ~~gone~~ ***both***');
  assert.ok(out.includes('<strong>bold</strong>'), out);
  assert.ok(out.includes('<em>it</em>'), out);
  assert.ok(out.includes('<code>a&lt;b</code>'), out);
  assert.match(out, /<(s|del)>gone<\/(s|del)>/);
  assert.ok(out.includes('<em><strong>both</strong></em>'), out);
});

test('a backslash escapes Markdown punctuation', () => {
  const out = renderMarkdown('\\*not em\\* and 2\\*3');
  assert.ok(!out.includes('<em>'), out);
  assert.ok(out.includes('*not em* and 2*3'), out);
});

test('lists, headings, quotes and rules', () => {
  const out = flat('# Title\n\nSub\n---\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n***');
  assert.ok(out.includes('<h1>Title</h1>'), out);
  assert.ok(out.includes('<h2>Sub</h2>'), out);
  assert.ok(out.includes('<ul><li>one</li><li>two</li></ul>'), out);
  assert.ok(out.includes('<ol><li>first</li><li>second</li></ol>'), out);
  assert.ok(out.includes('<blockquote><p>quoted</p></blockquote>'), out);
  assert.ok(out.includes('<hr>'), out);
});

test('task lists show checkboxes that cannot be changed', () => {
  const out = renderMarkdown('- [x] done\n- [ ] todo');
  const boxes = out.match(/<input[^>]*>/g) || [];
  assert.equal(boxes.length, 2, out);
  assert.ok(boxes.every((b) => /type="checkbox"/.test(b) && /disabled/.test(b)), out);
  assert.ok(/checked/.test(boxes[0]) && !/checked/.test(boxes[1]), out);
  assert.ok(!text(out).includes('[x]') && !text(out).includes('[ ]'), out);
  assert.ok(text(out).includes('done') && text(out).includes('todo'), out);
});

test('tables, scrolled inside their own box, keep their column alignment', () => {
  const out = flat('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
  assert.match(out, /<div class="table"><table>/);
  assert.match(out, /<th style="text-align:\s*left;?">a<\/th>/);
  assert.match(out, /<th style="text-align:\s*center;?">b<\/th>/);
  assert.match(out, /<td style="text-align:\s*right;?">3<\/td>/);
});

test('footnotes link to a note at the end', () => {
  const out = renderMarkdown('Text[^1].\n\n[^1]: The note.');
  assert.match(out, /<sup[^>]*><a href="#[^"]+"/);
  assert.match(out, /<section class="footnotes">[\s\S]*The note\./);
  assert.ok(!out.includes('[^1]'), out);
});

test('math is typeset by KaTeX, inline and as a block, in either delimiter style', () => {
  for (const src of ['area $a^2$ here', 'area \\(a^2\\) here']) {
    const out = renderMarkdown(src);
    assert.match(out, /class="katex"/, src);
    assert.ok(!out.includes('katex-display'), src);
  }
  for (const src of ['$$\n\\frac{1}{2}\n$$', '\\[\n\\frac{1}{2}\n\\]', 'half: $$\\frac{1}{2}$$', 'half: \\[\\frac{1}{2}\\]']) {
    assert.match(renderMarkdown(src), /class="katex-display"/, src);
  }
  assert.ok(!renderMarkdown('`$a$` and\n\n```\n$$x$$\n```').includes('katex'), 'no math inside code');
  assert.ok(!renderMarkdown('it costs $5 and $10').includes('katex'), 'prices are not math');
});

test('paragraph lines join and blank lines split', () => {
  assert.equal(flat('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
});

test('highlighted code is escaped inside every token', () => {
  const out = renderMarkdown('```js\nconst s = "<img src=x onerror=alert(1)>"; // <b>\n```');
  assert.ok(!out.includes('<img'), out);
  assert.ok(!out.includes('<b>'), out);
  assert.match(out, /<span class="hljs-string">&quot;&lt;img/);
  assert.match(out, /<span class="hljs-comment">\/\/ &lt;b&gt;/);
});

test('an image is a link by default: nothing is fetched', () => {
  const out = renderMarkdown('see ![a chart](https://example.com/c.png) and ![local](c.png)');
  assert.ok(!out.includes('<img'), out);
  assert.ok(out.includes(`<a href="https://example.com/c.png" ${LINK}>a chart</a>`), out);
  assert.ok(out.includes('local'), out);
  assert.ok(!out.includes('!'), out);
});

test('an image hook draws images, given the unescaped text', () => {
  const seen = [];
  const out = renderMarkdown('![a & "b"](x.png?a=1&b=2) [link](https://example.com)', {
    image: (src, alt) => { seen.push([src, alt]); return '<img data-x>'; },
  });
  assert.deepEqual(seen, [['x.png?a=1&b=2', 'a & "b"']]);
  assert.ok(out.includes('<img data-x>'), out);
  assert.ok(out.includes('<a href="https://example.com"'), out);
});

test('an image hook that declines falls back to the default', () => {
  const out = renderMarkdown('![x](https://example.com/c.png)', { image: () => null });
  assert.ok(out.includes('<a href="https://example.com/c.png"'), out);
});

test('a fence hook can draw a block, and knows when the fence is still open', () => {
  const calls = [];
  const ext = { fence: (lang, body, closed) => { calls.push([lang, body, closed]); return lang === 'chart' && closed ? '<figure>c</figure>' : null; } };
  const out = flat('```chart\n{"a":1}\n```\n\n```go\nx\n```\n\n```chart\n{"a"', ext);
  assert.deepEqual(calls, [['chart', '{"a":1}', true], ['go', 'x', true], ['chart', '{"a"', false]]);
  assert.ok(out.startsWith('<figure>c</figure><pre data-lang="go">'), out);
  assert.ok(out.endsWith('</code></pre>'), out);
});

test('hooks reach nested blocks', () => {
  const calls = [];
  const out = flat('> ![x](a.png)\n\n- ![y](b.png)\n\n> ```chart\n> {}\n> ```', {
    image: (src) => `<img src="${src}">`,
    fence: (lang, body, closed) => { calls.push([lang, body, closed]); return '<figure>c</figure>'; },
  });
  assert.ok(out.includes('<blockquote><p><img src="a.png"></p></blockquote>'), out);
  assert.ok(out.includes('<li><img src="b.png"></li>'), out);
  assert.deepEqual(calls, [['chart', '{}', true]]);
  assert.ok(out.includes('<blockquote><figure>c</figure></blockquote>'), out);
});

test('while streaming, a half-written marker at the end is not shown', () => {
  assert.equal(text(renderMarkdown(settle('- item **C'))).trim(), 'item C');
  assert.equal(text(renderMarkdown(settle('call `fo'))).trim(), 'call fo');
  assert.equal(text(renderMarkdown(settle('a *b'))).trim(), 'a b');
  // Finished markers are left alone, and so is a list item that is only a dash.
  assert.equal(settle('**done** and `code`'), '**done** and `code`');
  assert.equal(settle('- '), '- ');
  // Inside an open code fence nothing changes.
  assert.equal(settle('```js\nconst a = 2 ** 3'), '```js\nconst a = 2 ** 3');
});
