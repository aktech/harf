// Markdown for chat replies: markdown-it (CommonMark with GitHub tables,
// strikethrough and bare URL links) with footnotes, task lists and KaTeX math,
// and highlight.js for code. The libraries live in vendor/ and index.html
// loads them as plain scripts, so they are read here from the page's globals.
//
// Raw HTML in a reply is always shown as text, never rendered, and only http,
// https and mailto links become links. Replies arrive in pieces, so partial
// input renders too.
//
// Plugins extend it with hooks, each returning HTML or null to keep the
// default (the hook escapes what it adds):
//   image(src, alt)          an image; by default a link, so nothing is fetched
//   fence(lang, body, closed) a fenced block; by default highlighted code
//   link(href)               a link, as {open, after}: the opening tag, and
//                            HTML to put after the link; by default a link
//                            only to the web or email

export const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_URL = /^(https?:|mailto:)/i;

let parser;

// settle hides a marker the model has opened but not yet closed at the end
// of a streaming reply ("**C" shows as "C" until the closing ** arrives),
// so half-written formatting never flashes as raw characters.
export function settle(src) {
  const fences = src.match(/^\s*(`{3,}|~{3,})/gm);
  if (fences && fences.length % 2) return src; // inside an open code block
  const cut = src.lastIndexOf('\n') + 1;
  const bullet = src.slice(cut).match(/^\s*(?:[*+-]|\d+[.)])\s+/);
  const head = src.slice(0, cut + (bullet ? bullet[0].length : 0));
  let line = src.slice(head.length);
  for (const mark of ['**', '__', '`', '*', '_']) {
    const parts = line.split(mark);
    if (parts.length % 2 === 0) {
      const i = line.lastIndexOf(mark);
      line = line.slice(0, i) + line.slice(i + mark.length);
    }
  }
  return head + line;
}

export function renderMarkdown(src, ext = {}) {
  parser ??= makeParser();
  return parser.render(src, { ext });
}

function makeParser() {
  const { markdownit, markdownitFootnote, mdItPluginTasklist, texmath, katex } = globalThis;
  // texmath reads \[...\] only on lines of its own; models also write it
  // mid-line, as they do $$...$$, so it gets the same in-line display rule.
  texmath.rules.brackets.inline.push({ name: 'math_inline_display', rex: /\\\[(.+?)\\\]/gy, tmpl: '<section><eqn>$1</eqn></section>', tag: '\\[', displayMode: true });
  const md =markdownit({ html: false, linkify: true, typographer: false, breaks: true })
    .use(markdownitFootnote)
    .use(mdItPluginTasklist.tasklist, { label: false })
    .use(texmath, { engine: katex, delimiters: ['dollars', 'brackets'], katexOptions: { throwOnError: false } });
  const rules = md.renderer.rules;

  rules.fence = rules.code_block = (tokens, i, _opts, env) => {
    const t = tokens[i];
    const { lang, file } = fenceInfo(t.info);
    const code = t.content.replace(/\n$/, '');
    const named = file ? ` data-file="${esc(file)}"` : '';
    return (env.ext.fence && env.ext.fence(lang, code, closed(t))) ?? `<pre data-lang="${esc(lang)}"${named}><code>${highlight(code, lang)}</code></pre>\n`;
  };

  rules.image = (tokens, i, opts, env, self) => {
    const t = tokens[i];
    const src = t.attrGet('src');
    const alt = self.renderInlineAsText(t.children, opts, env);
    return (env.ext.image && env.ext.image(src, alt)) ??
      (SAFE_URL.test(src) ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(alt || 'image')}</a>` : esc(alt));
  };

  // A link to anything but the web or email keeps its text and drops the
  // link, unless a link hook makes it something else.
  rules.link_open = (tokens, i, opts, env, self) => {
    const t = tokens[i];
    const close = tokens.find((c, j) => j > i && c.type === 'link_close');
    const own = env.ext.link && env.ext.link(t.attrGet('href'));
    if (own) {
      close.meta = { after: own.after };
      return own.open;
    }
    if (!SAFE_URL.test(t.attrGet('href'))) {
      close.hidden = true;
      return '';
    }
    t.attrSet('target', '_blank');
    t.attrSet('rel', 'noopener noreferrer');
    return self.renderToken(tokens, i, opts);
  };

  rules.link_close = (tokens, i, opts, _env, self) => self.renderToken(tokens, i, opts) + (tokens[i].meta?.after || '');

  rules.table_open = () => '<div class="table"><table>\n';
  rules.table_close = () => '</table></div>\n';
  return md;
}

// fenceInfo reads a fence's info line: its language, then a file name
// when one follows ("python chart.py" or 'js title="app.js"').
function fenceInfo(info) {
  const [lang = '', ...rest] = info.trim().split(/\s+/);
  const m = rest.join(' ').match(/^(?:(?:title|file|filename)=)?"?([\w./-]*\.\w+)"?$/);
  return { lang: lang.toLowerCase(), file: m ? m[1] : '' };
}

// closed reports whether a fence has its closing line. A fence's map covers
// its opening line, its content and, once it has arrived, its closing line.
// An indented code block has no closing line to wait for.
function closed(t) {
  if (t.type !== 'fence') return true;
  const lines = t.content ? t.content.split('\n').length - (t.content.endsWith('\n') ? 1 : 0) : 0;
  return t.map[1] - t.map[0] === lines + 2;
}

// highlight colours code in a language highlight.js knows, and escapes it.
// langOf is the language to colour a file's contents in, from its
// extension; empty when highlight.js does not know it.
export function langOf(path) {
  const m = String(path || '').match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : '';
  return ext && globalThis.hljs.getLanguage(ext) ? ext : '';
}

export function highlight(code, lang) {
  const { hljs } = globalThis;
  return lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : esc(code);
}
