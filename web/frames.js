// Web pages in replies: a workspace .html file, or an html block. Each is
// shown in a frame sandboxed to scripts only, so it runs with an origin of
// its own and cannot reach Harf's page, cookies, storage or API. The server
// adds a policy that blocks every network request but scripts from one CDN,
// and a first script that takes away WebRTC (see internal/server/webpage.go
// and shield.js).
//
// A frame is made once its reply stops changing and it is on screen, and is
// removed again when scrolled far away, so a page only runs while in view.
//
// An html block cannot be the frame's srcdoc or a blob: URL: those take
// Harf's own policy, which blocks inline scripts. It goes instead to a frame
// of api/frame, which runs under the page policy and writes in what Harf's
// page posts to it.

import { esc } from './md.js';
import { fileURL, workspacePath } from './plugins.js';

export const FRAME_URL = 'api/frame';

export const frameHTML = (src, title) =>
  `<iframe src="${esc(src)}" title="${esc(title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>`;

// viewerFile is the workspace page a viewer address (its hash) names, or null.
export function viewerFile(hash) {
  const m = /^#file=(.+)$/.exec(hash || '');
  if (!m) return null;
  let p;
  try { p = decodeURIComponent(m[1]); } catch { return null; }
  const rel = workspacePath(p, '');
  return rel && /\.html?$/i.test(rel) ? rel : null;
}

// showPage fills a .webpage element's box with its frame.
export function showPage(page) {
  const box = page.querySelector('.webpage-box');
  if (!box.firstChild) box.innerHTML = frameHTML(page.dataset.src || FRAME_URL, page.dataset.title || 'Web page');
}

const SETTLE_MS = 400;
let seen;

// mountFrames makes the frames in root once root has stayed in the page a
// moment: a reply being written is drawn anew many times a second.
export function mountFrames(root) {
  const pages = root.querySelectorAll('.webpage');
  if (!pages.length) return;
  seen ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) showPage(e.target);
      else e.target.querySelector('.webpage-box').replaceChildren();
    }
  }, { rootMargin: '50% 0px' });
  setTimeout(() => { for (const p of pages) if (p.isConnected) seen.observe(p); }, SETTLE_MS);
}

// viewers are tabs opened for html blocks, waiting for their block.
const viewers = new Map();

if (typeof document !== 'undefined') {
  addEventListener('message', (e) => {
    // An html block's frame is ready for its HTML. Its origin is opaque, so
    // the HTML is posted to any origin: it is the frame's own content.
    if (e.data === 'harf:ready' && e.origin === 'null') {
      for (const f of document.querySelectorAll('.webpage[data-html] iframe')) {
        if (f.contentWindow === e.source) return e.source.postMessage(f.closest('.webpage').dataset.html, '*');
      }
    }
    if (e.data === 'harf:viewer-ready' && e.origin === location.origin && viewers.has(e.source)) {
      e.source.postMessage(viewers.get(e.source), location.origin);
      viewers.delete(e.source);
    }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button[data-webpage]');
    const page = b && b.closest('.webpage');
    if (!page) return;
    if (b.dataset.webpage === 'expand') {
      const tall = page.classList.toggle('tall');
      b.textContent = tall ? 'Collapse' : 'Expand';
      b.setAttribute('aria-expanded', String(tall));
    } else if (b.dataset.webpage === 'open') {
      const w = open('view.html#html', '_blank');
      if (w) viewers.set(w, page.dataset.html);
    }
  });
}
