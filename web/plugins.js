// What the built-in plugins add to the web UI. The server lists each plugin
// with the parts of the UI it turns on (its "web" list); a part that is off
// adds nothing, so replies fall back to plain Markdown.

import { esc, highlight } from './md.js';
import { renderChart } from './chart.js';

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const PAGE = /\.html?$/i;

// fileURL is where the server serves a workspace file.
export const fileURL = (rel) => 'api/files/' + rel.split('/').map(encodeURIComponent).join('/');

// workspacePath turns a path Pi wrote into one relative to its workspace,
// or null when it points anywhere else.
export function workspacePath(p, workspace) {
  p = String(p || '').trim();
  if (workspace && p.startsWith(workspace.replace(/\/+$/, '') + '/')) p = p.slice(workspace.replace(/\/+$/, '').length + 1);
  p = p.replace(/^(\.\/)+/, '');
  if (!p || p.startsWith('/') || p.includes('\\') || /^[a-z][\w+.-]*:/i.test(p)) return null;
  if (p.split('/').some((s) => s === '..' || s === '')) return null;
  return p;
}

// markdownHooks returns the Markdown hooks for the parts that are on.
// opts.workspace is the workspace's absolute path; opts.width the width a
// chart is drawn at.
export function markdownHooks(on, opts = {}) {
  const hooks = {};
  const images = on.has('workspace-images'), frames = on.has('web-pages');
  // A workspace web page is always a link to the viewer; with web pages on
  // it is shown in a frame too.
  hooks.link = (href) => {
    const rel = pagePath(href, opts.workspace);
    return rel && { open: viewerLink(rel), after: frames ? pageFrame({ src: fileURL(rel), open: viewerURL(rel), title: rel }) : '' };
  };
  hooks.image = (src, alt) => {
    const page = pagePath(src, opts.workspace);
    if (page) return frames ? pageFrame({ src: fileURL(page), open: viewerURL(page), title: alt || page }) : `${viewerLink(page)}${esc(alt || page)}</a>`;
    if (!images) return null;
    try { src = decodeURIComponent(src); } catch { return null; }
    const rel = workspacePath(src, opts.workspace);
    if (!rel || !IMAGE.test(rel)) return null;
    return `<img src="${esc(fileURL(rel))}" alt="${esc(alt)}" loading="lazy">`;
  };
  const chart = on.has('chart'), drawing = on.has('svg');
  if (chart || drawing || frames) {
    hooks.fence = (lang, body, closed) => {
      if (!closed) return null;
      if (lang === 'svg' && drawing) return svgFigure(body);
      if (lang === 'chart' && chart) return chartFigure(body, opts.width);
      if (lang === 'html' && frames) return pageFrame({ html: body, title: 'HTML' });
      return null;
    };
  }
  return hooks;
}

// viewerURL is where Harf shows a workspace web page in a tab of its own.
export const viewerURL = (rel) => 'view.html#file=' + rel.split('/').map(encodeURIComponent).join('/');
const viewerLink = (rel) => `<a href="${esc(viewerURL(rel))}" target="_blank" rel="noopener noreferrer">`;

// pagePath is the workspace path of a web page a reply links to, or null.
function pagePath(src, workspace) {
  try { src = decodeURIComponent(src); } catch { return null; }
  const rel = workspacePath(src, workspace);
  return rel && PAGE.test(rel) ? rel : null;
}

// pageFrame is the place a web page is shown: a workspace file (src) or an
// html block (html). frames.js makes its frame once it is on screen. Only
// phrasing elements, so it can stand inside a paragraph.
function pageFrame({ src, html, open, title }) {
  const data = src ? `data-src="${esc(src)}"` : `data-html="${esc(html)}"`;
  const openAct = open
    ? `<a class="webpage-act" href="${esc(open)}" target="_blank" rel="noopener noreferrer">Open</a>`
    : '<button type="button" class="webpage-act" data-webpage="open">Open</button>';
  return `<span class="webpage" ${data} data-title="${esc(title)}"><span class="webpage-bar"><span class="webpage-name">${esc(title)}</span>` +
    `<button type="button" class="webpage-act" data-webpage="expand" aria-expanded="false">Expand</button>${openAct}</span><span class="webpage-box"></span></span>`;
}

// svgFigure shows SVG markup as an image. An SVG loaded by <img> runs no
// scripts and loads nothing else, so the markup needs no cleaning.
function svgFigure(body) {
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(body)) return null;
  return `<figure class="drawing"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(body.trim())}" alt="Drawing"></figure>`;
}

function chartFigure(body, width) {
  try {
    return renderChart(JSON.parse(body), { width });
  } catch (e) {
    const why = e instanceof SyntaxError ? 'the block is not valid JSON' : e.message;
    return `<pre data-lang="chart"><code>${highlight(body, 'json')}</code></pre><p class="chart-error">Chart not drawn: ${esc(why)}</p>`;
  }
}

// toolImage returns the URL of an image a finished write or edit made.
export function toolImage(t, workspace) {
  if (!t || t.status !== 'done' || (t.name !== 'write' && t.name !== 'edit')) return null;
  let a = t.args;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return null; } }
  const rel = workspacePath(a && (a.path || a.file_path), workspace);
  return rel && IMAGE.test(rel) ? fileURL(rel) : null;
}
