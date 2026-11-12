// The viewer shows one web page in a tab of its own, in the same sandboxed
// frame a reply uses. Harf's policy on this page keeps the frame from
// loading anything but Harf's own pages, so the page cannot take the tab to
// another site. view.html#file=<path> shows a workspace file; view.html#html
// shows an html block, which the reply's tab posts here.

import { showPage, viewerFile } from './frames.js';
import { fileURL } from './plugins.js';

function show(data) {
  const page = document.createElement('div');
  page.className = 'webpage';
  page.innerHTML = '<div class="webpage-box"></div>';
  Object.assign(page.dataset, data);
  document.body.replaceChildren(page);
  showPage(page);
}

const rel = viewerFile(location.hash);
if (rel) {
  document.title = rel.split('/').pop();
  show({ src: fileURL(rel), title: rel });
} else if (location.hash === '#html' && opener) {
  addEventListener('message', (e) => {
    if (e.source !== opener || e.origin !== location.origin || typeof e.data !== 'string') return;
    show({ html: e.data, title: 'HTML' });
  }, { once: true });
  opener.postMessage('harf:viewer-ready', location.origin);
} else {
  document.body.innerHTML = '<p>There is no page to show here.</p>';
}

// A new address in the same tab shows its page.
addEventListener('hashchange', () => location.reload());
