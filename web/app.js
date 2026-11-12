import { beam } from './avatar.js';
import { renderMarkdown, settle, highlight, langOf } from './md.js';
import { markdownHooks, toolImage, fileURL, workspacePath } from './plugins.js';
import { mountFrames } from './frames.js';
import { statsSummary, statsDetail } from './stats.js';
import { revealNext, shownText } from './reveal.js';
import { groupModels } from './models.js';
import { makerOf, providerName, providerLogo } from './makers.js';
import { stepTime, workSummary, plainPeek } from './work.js';
import { agentTags, agentActivity, editedLabel } from './agents.js';
import { createPalette } from './palette.js';
import { FONTS, SIZES, ACCENTS, loadAppearance, applyAppearance } from './appearance.js';
import { parsePairs, formatPairs, mcpTool, savedAgent } from './mcp.js';
import { fileKind } from './filekind.js';
import { watchReply } from './stream.js';

// All URLs are relative so the app works under any path prefix, as when a
// proxy serves it at /u/<owner>/<app>/.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const waitingSpark = () => {
  const s = svg(ICON.sparkle);
  s.setAttribute('class', 'waiting-spark');
  s.setAttribute('aria-hidden', 'true');
  return s;
};
const svg = (paths) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = paths; // constant markup from this file only
  return s;
};
// Every icon is from Lucide 1.63.0 (ISC licence, lucide-static on npm);
// web/icons/SOURCE.txt lists them.
const ICON = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  redo: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  chevUp: '<path d="m18 15-6-6-6 6"/>',
  terminal: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
  filePlus: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  panelOpen: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  panelClose: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
  chat: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/>',
  newChat: '<path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  plug: '<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>',
  sparkle: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  idea: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  agent: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  swatch: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  pencilLine: '<path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  pinOff: '<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  cancel: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  save: '<path d="M20 6 9 17l-5-5"/>',
  plugZap: '<path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="m2 22 3-3"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m18 3-4 4h6l-4 4"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
};
// FILE_ICON draws an attached file by its kind: file, file-text,
// file-spreadsheet, file-image, file-code, file-archive, file-audio and
// file-video from Lucide 1.63.0 (ISC licence, lucide-static on npm).
const FILE_ICON = {
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
  text: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sheet: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  image: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><circle cx="10" cy="12" r="2"/><path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"/>',
  code: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>',
  archive: '<path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 12v-1"/><path d="M8 18v-2"/><path d="M8 7V6"/><circle cx="8" cy="20" r="2"/>',
  audio: '<path d="M4 6.835V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-.343"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M2 19a2 2 0 0 1 4 0v1a2 2 0 0 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0"/>',
  video: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M15.033 13.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z"/>',
};
const fileIcon = (type, name) => svg(FILE_ICON[fileKind(type, name)]);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const store = {
  get(k, d) { try { return localStorage.getItem('harf.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('harf.' + k, v); } catch {} },
};

const state = {
  models: [],
  mcp: [], // MCP servers, their env and header values masked
  defaultModel: '',
  chats: [],
  agents: [],
  chat: null,          // the open chat, with messages; null on a new chat
  draftAgent: null,    // agent picked for a chat not created yet
  draftModel: '',
  streaming: null,     // AbortController while a reply is watched
  streamingChat: null, // the chat whose reply is watched
  follow: true,        // keep the view pinned to the newest text
  plugins: [],         // the server's plugins, with enabled
  web: new Set(),      // the parts of the UI the enabled plugins turn on
  workspace: '',       // Pi's workspace folder, to read paths Pi wrote
  imageModels: [],     // the image models Pi has
  imageModel: '',      // the one image generation uses
  pending: [],         // files picked for the next message: { file, url, sent }
  uploading: false,    // the pending files are being uploaded
};

// ---------- agents' colours ----------
function hueOf(id) {
  let h = 0;
  for (const c of id || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function agentColor(agent) {
  if (!agent) return '';
  const dark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? `oklch(0.76 0.13 ${hueOf(agent.id)})` : `oklch(0.52 0.17 ${hueOf(agent.id)})`;
}
const agentById = (id) => state.agents.find((a) => a.id === id) || null;
const currentAgent = () => (state.chat ? agentById(state.chat.agentId) : state.draftAgent);
const modelIds = () => state.models.map((m) => m.id);
const hasModel = (id) => state.models.some((m) => m.id === id);
const modelName = (id) => (state.models.find((m) => m.id === id) || {}).name || id;

// modelLogo is the logo of the company that made a model (Anthropic for
// github-copilot/claude-haiku-4.5). A model whose maker is not known gets
// an empty slot, not a stand-in drawing, so names stay aligned.
// One-colour logos are masks filled with the text colour, so they follow
// the theme; the others keep their own colours.
function modelLogo(id, name) {
  const m = makerOf(id, name);
  if (!m) return el('span', { class: 'mlogo none', 'aria-hidden': 'true' });
  return logoView(m, m.label);
}

// An <img> draws currentColor black, so tint logos (Kimi's K) are put in
// the page as SVG, where those parts take the text colour.
const tintLogos = new Map();
function tintLogo(logo) {
  if (!tintLogos.has(logo)) {
    tintLogos.set(logo, fetch(`logos/${logo}.svg`).then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => new DOMParser().parseFromString(t, 'image/svg+xml').documentElement));
  }
  return tintLogos.get(logo);
}

function logoView({ logo, mono, tint }, title) {
  if (mono) {
    const s = el('span', { class: 'mlogo mono', 'aria-hidden': 'true', title });
    s.style.setProperty('--logo', `url(logos/${logo}.svg)`);
    return s;
  }
  if (tint) {
    const s = el('span', { class: 'mlogo', 'aria-hidden': 'true', title });
    tintLogo(logo).then((doc) => s.replaceChildren(document.importNode(doc, true)), () => {});
    return s;
  }
  return el('span', { class: 'mlogo', 'aria-hidden': 'true', title }, el('img', { src: `logos/${logo}.svg`, alt: '' }));
}
const currentModel = () => (state.chat ? state.chat.model : state.draftModel) || state.defaultModel || (state.models[0] || {}).id || '';


function applyHue() {
  const c = agentColor(currentAgent());
  if (c) document.documentElement.style.setProperty('--hue', c);
  else document.documentElement.style.removeProperty('--hue');
}

// ---------- sidebar ----------
function renderAgents() {
  const list = $('agentList');
  list.replaceChildren();
  if (!state.agents.length) {
    list.append(el('li', { class: 'agent-empty' }, 'Give a model a role and instructions, then chat with it.'));
    renderAgentsPage();
    return;
  }
  const active = currentAgent();
  for (const a of state.agents) {
    const li = el('li', { class: active && active.id === a.id ? 'active' : '' },
      el('button', { class: 'agent-go', title: a.description || a.name, onclick: () => startChat(a) },
        el('span', { class: 'agent-dot', 'aria-hidden': 'true' }), el('span', { class: 'name' }, a.name)),
      el('button', { class: 'icon-btn agent-edit', onclick: () => openAgent(a), 'aria-label': `Edit ${a.name}`, title: `Edit ${a.name}` }, svg(ICON.edit)));
    li.style.setProperty('--agent', agentColor(a));
    list.append(li);
  }
  renderAgentsPage();
}

function dayGroup(iso) {
  const d = new Date(iso);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const diff = (start - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5;
  if (diff <= 0) return 'Today';
  if (diff <= 1) return 'Yesterday';
  if (diff <= 7) return 'Previous 7 days';
  if (diff <= 30) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function renderChats() {
  const nav = $('chatList');
  nav.replaceChildren();
  const chats = state.chats;
  if (!chats.length) {
    nav.append(el('div', { class: 'list-empty' }, 'Your chats will be listed here.'));
    renderAgentsPage();
    return;
  }
  const groups = new Map();
  for (const c of chats) {
    const g = c.pinned ? 'Pinned' : dayGroup(c.updatedAt);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  for (const [name, items] of groups) {
    const sec = el('div', { class: 'group' }, el('h3', { class: 'nav-sec' }, name));
    for (const c of items) sec.append(chatRow(c));
    nav.append(sec);
  }
  renderAgentsPage();
}

function chatRow(c) {
  const agent = agentById(c.agentId);
  const link = el('a', { href: '#c=' + c.id }, el('span', { class: 't' }, c.title || 'New chat'));
  const row = el('div', { class: 'row' + (state.chat && state.chat.id === c.id ? ' active' : '') }, link);
  if (agent) row.style.setProperty('--agent', agentColor(agent));
  const more = el('button', { class: 'icon-btn row-menu', 'aria-label': 'Chat options', 'aria-haspopup': 'menu' }, svg(ICON.dots));
  more.addEventListener('click', (e) => {
    e.preventDefault();
    showMenu(more, chatMenu(c, more, () => renameIn(row, c)));
  });
  row.append(more);
  return row;
}

// chatMenu is what can be done to a chat, from its sidebar row or the
// title at the top; rename edits the title where the menu was opened.
function chatMenu(c, anchor, rename) {
  return [
    ['Rename', ICON.pencilLine, rename],
    [c.pinned ? 'Unpin' : 'Pin', c.pinned ? ICON.pinOff : ICON.pin, () => patchChat(c.id, { pinned: !c.pinned })],
    ['Export as Markdown', ICON.download, () => exportChat(c.id)],
    null,
    ['Delete', ICON.trash, () => confirmDelete(anchor, c), 'danger'],
  ];
}

// renameIn swaps box's content for a field holding the chat's title; Enter
// or leaving it saves, Escape puts things back.
function renameIn(box, c) {
  const input = el('input', { class: 'rename', value: c.title || '', 'aria-label': 'Chat title' });
  box.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const t = input.value.trim();
    if (save && t && t !== c.title) await patchChat(c.id, { title: t });
    else { renderChats(); renderTitle(); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function confirmDelete(anchor, c) {
  showMenu(anchor, [
    [`Delete “${clip(c.title || 'New chat', 28)}”`, ICON.trash, async () => {
      await api('DELETE', `api/chats/${c.id}`);
      state.chats = state.chats.filter((x) => x.id !== c.id);
      if (state.chat && state.chat.id === c.id) location.hash = '';
      renderChats();
      toast('Chat deleted');
    }, 'danger'],
    ['Keep it', ICON.cancel, () => {}],
  ]);
}

async function patchChat(id, patch) {
  try {
    const c = await api('PATCH', `api/chats/${id}`, patch);
    upsertChat(c);
    if (state.chat && state.chat.id === id) Object.assign(state.chat, patch);
    renderChats();
    renderTitle();
  } catch (e) { toast(e.message); }
}

function upsertChat(c) {
  const summary = { ...c, messages: undefined };
  const i = state.chats.findIndex((x) => x.id === c.id);
  if (i >= 0) state.chats[i] = summary; else state.chats.unshift(summary);
  state.chats.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updatedAt) - new Date(a.updatedAt)));
}

let menuEl = null;
function showMenu(anchor, items) {
  closeMenu();
  const m = el('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) { m.append(el('hr')); continue; }
    const [label, icon, fn, cls] = it;
    m.append(el('button', { role: 'menuitem', class: cls || '', onclick: () => { closeMenu(); fn(); } }, svg(icon), label));
  }
  // Arrow keys move along the items; Escape closes and returns to the key
  // that opened the menu; Tab leaves it.
  m.addEventListener('keydown', (e) => {
    const items = [...m.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); if (anchor.isConnected) anchor.focus(); }
    else if (e.key === 'Tab') closeMenu();
  });
  popUp(m, anchor);
  m.querySelector('button').focus();
}
// popUp shows a raised sheet under its anchor, or over it when there is no
// room below. A click outside it or Escape closes it.
function popUp(m, anchor) {
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  // Left-aligned with its anchor, or right-aligned when that runs off screen.
  const left = r.left + m.offsetWidth > innerWidth - 12 ? Math.min(r.right, innerWidth - 12) - m.offsetWidth : r.left;
  const top = r.bottom + 4 + m.offsetHeight > innerHeight - 12 ? r.top - m.offsetHeight - 4 : r.bottom + 4;
  m.style.left = Math.max(12, left) + 'px';
  m.style.top = top + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  menuEl = { m, anchor };
}
function closeMenu() {
  if (!menuEl) return;
  menuEl.anchor.removeAttribute('aria-expanded');
  menuEl.m.remove();
  menuEl = null;
}
document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.m.contains(e.target)) closeMenu(); });
// The stats popover is placed by its line, so it closes when the thread scrolls.
$('scroller').addEventListener('scroll', () => { if (menuEl && menuEl.m.classList.contains('stats-pop')) closeMenu(); }, { passive: true });

// ---------- top bar ----------
// renderTitle shows the open chat's title at the top, a key that opens the
// chat's menu; a new chat shows its agent, if it has one, or nothing.
function renderTitle() {
  const t = $('topTitle');
  const c = state.chat;
  const agent = currentAgent();
  document.title = c && c.title ? `${c.title} · Harf` : 'Harf';
  if (!$('agentsPage').hidden || !$('settingsPage').hidden) { t.replaceChildren(...crumbs()); return; }
  if (!c) { t.replaceChildren(agent ? el('span', { class: 'top-name' }, agent.name) : ''); return; }
  const b = el('button', { type: 'button', class: 'title-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Chat options' },
    el('span', { class: 'top-name' }, c.title || 'New chat'), svg(ICON.chevDown));
  b.addEventListener('click', () => {
    if (menuEl && menuEl.anchor === b) { closeMenu(); return; }
    const chat = state.chats.find((x) => x.id === c.id) || c;
    showMenu(b, chatMenu(chat, b, () => renameIn(t, chat)));
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  t.replaceChildren(b);
}

// crumbs is the top bar on the Agents and settings pages: a way back to the
// chat the reader left, then where they are.
function crumbs() {
  const back = el('a', { class: 'icon-btn back-btn', href: backTo || '#', 'aria-label': 'Back to chat', title: 'Back to chat' }, svg(ICON.arrowLeft));
  if (!backTo) back.addEventListener('click', newChat);
  const sep = () => el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/');
  const trail = !$('agentsPage').hidden
    ? [el('span', { class: 'crumb', 'aria-current': 'page' }, 'Agents')]
    : [el('a', { class: 'crumb', href: '#settings' }, 'Settings'), sep(),
      el('span', { class: 'crumb', 'aria-current': 'page' }, SECTIONS.find((x) => x.id === settingsSection).label)];
  return [back, el('nav', { class: 'crumbs', 'aria-label': 'You are here' }, ...trail)];
}

function renderModels() {
  const cur = currentModel();
  $('modelValue').textContent = cur ? modelName(cur) : state.listed ? 'No models' : 'Loading models';
  $('modelLogo').replaceChildren(...(cur ? [modelLogo(cur, modelName(cur))] : []));
  $('modelBtn').disabled = !cur;
  $('modelBtn').title = cur ? `Model: ${modelName(cur)}` : 'No models yet';
}

// ---------- dropdowns ----------
// A select list under a trigger: grouped, filtered by what is
// typed, with a check on the chosen entry. The filter box is a combobox
// over the list. One popover serves every trigger; the composer's model
// picker and the image model picker in Settings use it.
const dd = { trigger: null, opts: null, rows: [], at: 0 };
const ddPop = $('modelPop');
const ddFilter = $('modelFilter');

function renderDropdown() {
  const { current, groups, noun } = dd.opts;
  const list = $('modelList');
  list.replaceChildren();
  dd.rows = [];
  const shown = groups(ddFilter.value);
  if (!shown.length) list.append(el('div', { class: 'select-empty' }, `No ${noun} matches “${ddFilter.value.trim()}”`));
  shown.forEach((g, gi) => {
    const own = ['Current', 'Default'].includes(g.provider);
    const pl = own ? null : providerLogo(g.provider);
    const head = el('div', { class: 'select-heading', id: `dd-g-${gi}` }, pl ? logoView(pl, '') : null, own ? g.provider : providerName(g.provider));
    const group = el('div', { class: 'select-group', role: 'group', 'aria-labelledby': head.id }, head);
    for (const m of g.models) {
      const i = dd.rows.length;
      const opt = el('div', { class: 'select-item', role: 'option', id: `dd-o-${i}`, 'aria-selected': String(m.id === current) },
        m.id ? modelLogo(m.id, m.name) : el('span', { class: 'mlogo' }), el('span', { class: 'select-value' }, m.name || m.id),
        m.id === current ? el('span', { class: 'select-check', 'aria-hidden': 'true' }, svg(ICON.check)) : null);
      opt.title = m.id;
      opt.addEventListener('pointermove', () => { if (dd.at !== i) highlightDropdown(i, false); });
      opt.addEventListener('click', () => pickDropdown(m.id));
      group.append(opt);
      dd.rows.push({ id: m.id, node: opt });
    }
    list.append(group);
  });
  const chosen = dd.rows.findIndex((r) => r.id === current);
  dd.at = 0;
  highlightDropdown(chosen >= 0 && !ddFilter.value.trim() ? chosen : 0, true);
}

function highlightDropdown(i, scroll) {
  const old = dd.rows[dd.at];
  if (old) old.node.classList.remove('on');
  dd.at = i;
  const r = dd.rows[i];
  if (!r) { ddFilter.removeAttribute('aria-activedescendant'); return; }
  r.node.classList.add('on');
  ddFilter.setAttribute('aria-activedescendant', r.node.id);
  if (scroll) r.node.scrollIntoView({ block: 'nearest' });
}

// placeDropdown opens the list under its trigger, or above it when there
// is more room there (the composer sits at the bottom).
function placeDropdown() {
  const r = dd.trigger.getBoundingClientRect();
  const w = Math.min(Math.max(320, r.width), innerWidth - 16);
  ddPop.style.width = w + 'px';
  ddPop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  const below = innerHeight - r.bottom - 14;
  const above = r.top - 14;
  const list = $('modelList');
  if (below >= 260 || below >= above) {
    ddPop.style.top = r.bottom + 6 + 'px'; ddPop.style.bottom = 'auto';
    list.style.maxHeight = Math.min(320, below - 44) + 'px';
  } else {
    ddPop.style.bottom = innerHeight - r.top + 6 + 'px'; ddPop.style.top = 'auto';
    list.style.maxHeight = Math.min(320, above - 44) + 'px';
  }
}

// openDropdown shows the list for trigger. opts: { noun, current, groups(query), onPick(id) }.
function openDropdown(trigger, opts) {
  if (trigger.disabled) return;
  if (dd.trigger === trigger && !ddPop.hidden) return;
  closeDropdown(false);
  dd.trigger = trigger;
  dd.opts = opts;
  const host = trigger.closest('dialog') || document.body;
  if (ddPop.parentNode !== host) host.append(ddPop);
  ddFilter.value = '';
  ddFilter.placeholder = `Filter ${opts.noun}s`;
  ddFilter.setAttribute('aria-label', `Filter ${opts.noun}s`);
  $('modelList').setAttribute('aria-label', `${opts.noun[0].toUpperCase()}${opts.noun.slice(1)}s`);
  ddPop.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  placeDropdown();
  renderDropdown();
  ddFilter.focus();
}
function closeDropdown(refocus = true) {
  if (ddPop.hidden) return;
  ddPop.hidden = true;
  dd.trigger.setAttribute('aria-expanded', 'false');
  if (refocus && dd.trigger.isConnected) dd.trigger.focus();
}
function pickDropdown(id) {
  const { onPick } = dd.opts;
  closeDropdown();
  onPick(id);
}
// dropdownTrigger wires a trigger button to open its list on click and on
// the arrow keys.
function dropdownTrigger(trigger, opts) {
  trigger.addEventListener('click', () => (ddPop.hidden || dd.trigger !== trigger ? openDropdown(trigger, opts()) : closeDropdown()));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openDropdown(trigger, opts()); }
  });
  return trigger;
}

ddFilter.addEventListener('input', renderDropdown);
ddFilter.addEventListener('keydown', (e) => {
  const n = dd.rows.length;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); highlightDropdown((dd.at + 1) % n, true); }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); highlightDropdown((dd.at - 1 + n) % n, true); }
  else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (dd.rows[dd.at]) pickDropdown(dd.rows[dd.at].id); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDropdown(); }
  else if (e.key === 'Tab') closeDropdown(false);
});
document.addEventListener('pointerdown', (e) => {
  if (!ddPop.hidden && !ddPop.contains(e.target) && !dd.trigger.contains(e.target)) closeDropdown(false);
});
addEventListener('resize', () => { if (!ddPop.hidden) placeDropdown(); });

// The composer's model picker.
dropdownTrigger($('modelBtn'), () => ({
  noun: 'model',
  current: currentModel(),
  groups: (q) => groupModels(state.models, q, currentModel()),
  onPick: (id) => {
    store.set('model', id);
    if (state.chat) patchChat(state.chat.id, { model: id });
    else state.draftModel = id;
    renderModels();
  },
}));

// ---------- thread ----------
function renderThread() {
  const thread = $('thread');
  thread.replaceChildren();
  applyHue();
  renderTitle();
  renderModels();
  renderComposerAgent();
  const empty = !state.chat || !state.chat.messages.length;
  $('main').classList.toggle('empty', empty);
  renderStarters(empty);
  if (empty) {
    thread.append(welcome());
    showJump(); // nothing to jump to; drop the key a chat left showing
    return;
  }
  const msgs = state.chat.messages;
  msgs.forEach((m, i) => thread.append(messageView(m, i === msgs.length - 1)));
  scrollToEnd(true);
}

function welcome() {
  const agent = currentAgent();
  if (agent) {
    return el('div', { class: 'welcome' },
      el('h1', {}, agent.name),
      el('p', { class: 'lead' }, agent.description || 'Its instructions apply to every message in this chat.'));
  }
  return el('div', { class: 'welcome' },
    el('h1', {}, 'How can I help you today?'),
    el('p', { class: 'lead' }, 'It can read and change files and run commands in its workspace while it works.'),
    el('div', { class: 'samples', role: 'group', 'aria-label': 'Try one' }, ...SAMPLES.map((s) =>
      el('button', { class: 'sample', type: 'button', title: s.prompt, onclick: () => send(s.prompt) }, svg(ICON[s.icon]), s.label))));
}

// SAMPLES are prompts someone new can click to see what a chat can do.
const SAMPLES = [
  { icon: 'chart', label: 'Chart the largest countries', prompt: 'Make a bar chart of the population of the ten most populous countries, then say in one line where the numbers come from.' },
  { icon: 'terminal', label: 'Write and run a script', prompt: 'Write a Python script that prints the first 20 prime numbers, run it, and show me the output.' },
  { icon: 'file', label: 'Make a file', prompt: 'Create a file called packing-list.md with a packing list for a three day hiking trip, then show it to me.' },
  { icon: 'idea', label: 'Explain with a formula', prompt: 'Explain compound interest in two short paragraphs, with the formula, and work out what 1,000 at 5% a year grows to after 10 years.' },
];

// renderStarters shows the agents as chips under an empty chat's composer.
function renderStarters(empty) {
  const box = $('starters');
  box.replaceChildren();
  if (!empty || currentAgent()) return;
  for (const a of state.agents.slice(0, 6)) {
    const b = el('button', { class: 'starter', type: 'button', title: a.description || a.name, onclick: () => startChat(a) }, svg(ICON.agent), a.name);
    b.style.setProperty('--agent', agentColor(a));
    box.append(b);
  }
  box.append(el('button', { class: 'starter', type: 'button', onclick: () => openAgent(null) }, svg(ICON.plus), 'Create an agent'));
}

function messageView(m, last) {
  if (m.role === 'user') {
    const wrap = el('div', { class: 'msg user' + (last ? ' last' : ''), 'data-id': m.id || '' },
      m.attachments && m.attachments.length ? attachmentsView(m.attachments) : null,
      m.content ? el('div', { class: 'bubble' }, m.content) : null);
    if (m.id) {
      wrap.append(el('div', { class: 'msg-actions' },
        actionBtn('Edit message', ICON.edit, () => editMessage(wrap, m)),
        actionBtn('Copy message', ICON.copy, (b) => copy(m.content, b))));
    }
    return wrap;
  }
  const body = el('div', { class: 'body' });
  const parts = m.parts && m.parts.length ? m.parts : m.content ? [{ type: 'text', text: m.content }] : [];
  parts.forEach((p) => placePart(body, partView(p)));
  refreshWork(body);
  const main = el('div', { class: 'msg-main' }, body);
  const wrap = el('div', { class: 'msg assistant' + (last ? ' last' : ''), 'data-id': m.id || '' },
    el('span', { class: 'msg-mark', 'aria-hidden': 'true' }, svg(ICON.sparkle)), main);
  if (m.error) {
    const stopped = m.error === 'Stopped';
    main.append(el('div', { class: 'msg-error' + (stopped ? ' stopped' : '') },
      el('span', {}, stopped ? 'Stopped before the reply finished.' : m.error),
      m.id && !state.streaming ? el('button', { class: 'btn sm', onclick: () => regenerate(m) }, svg(ICON.redo), stopped ? 'Regenerate' : 'Try again') : null));
  }
  const stats = m.id && statsView(m.usage, m.model);
  if (stats) main.append(stats);
  if (m.id && m.content) {
    main.append(el('div', { class: 'msg-actions' },
      actionBtn('Copy reply', ICON.copy, (b) => copy(m.content, b)),
      actionBtn('Regenerate reply', ICON.redo, () => regenerate(m))));
  }
  return wrap;
}

// statsView is a reply's token and timing stats: a short line that opens
// the full list in a popover. Nothing when the model reported no usage.
function statsView(usage, model) {
  const line = statsSummary(usage);
  if (!line.length) return null;
  if (model) line.unshift(modelName(model));
  const b = el('button', { type: 'button', class: 'msg-stats', 'aria-haspopup': 'dialog', title: 'Reply stats' }, ...line.map((s) => el('span', {}, s)));
  b.addEventListener('pointerdown', (e) => e.stopPropagation()); // its click toggles
  b.addEventListener('click', () => {
    if (menuEl && menuEl.anchor === b) { closeMenu(); return; }
    closeMenu();
    const rows = [...(model ? [['Model', modelName(model)]] : []), ...statsDetail(usage)];
    const pop = el('div', { class: 'menu stats-pop', role: 'dialog', 'aria-label': 'Reply stats', tabindex: '-1' },
      el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
    popUp(pop, b);
    pop.focus({ preventScroll: true });
  });
  return b;
}

// attachmentsView shows a message's files: pictures as thumbnails, other
// files as chips. Each opens the saved copy in the workspace.
function attachmentsView(atts) {
  return el('div', { class: 'attachments' }, atts.map((a) => {
    const href = fileURL(a.path);
    if (isPicture(a.type)) {
      return el('a', { class: 'att-thumb', href, target: '_blank', rel: 'noopener', title: a.name },
        el('img', { src: href, alt: a.name, loading: 'lazy' }));
    }
    return el('a', { class: 'att-chip', href, target: '_blank', rel: 'noopener', title: a.path },
      fileIcon(a.type, a.name), el('span', { class: 'att-name' }, a.name), el('span', { class: 'att-size' }, fmtSize(a.size)));
  }));
}
const isPicture = (type) => /^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(type || '');
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- reply parts ----------
// A reply is text plus the steps the agent took (thinking, tool calls).
// Steps that follow one another share one list, drawn like a CI job's steps.
// streaming marks a part still being written: half-written markers at its
// end are hidden until they close.
function partView(p, open, streaming) {
  if (p.type === 'text') {
    const d = el('div', { class: 'md' });
    d.innerHTML = renderMarkdown(streaming ? settle(p.text || '') : p.text || '', mdHooks()); // escaped by renderMarkdown and the plugins' hooks
    decorateCode(d);
    mountFrames(d);
    d.addEventListener('click', jumpToFootnote);
    return d;
  }
  if (p.type === 'thinking') {
    const text = (p.text || '').trim();
    return step('think', open, svg(ICON.idea), 'Thought', text ? el('span', { class: 'peek' }, plainPeek(text)) : null, 0,
      () => [el('div', { class: 'think-text' }, text || 'No thinking shown.')]);
  }
  const t = p.tool || {};
  const { label, detail } = describeTool(t);
  const status = t.status === 'error' ? 'error' : t.status === 'done' ? 'done' : 'running';
  const li = step(status, open, svg(toolIcon(t)), label, detail ? el('span', { class: 'arg' }, detail) : null, t.ms || 0,
    () => {
      const out = [];
      const args = toolArgs(t);
      if (args) out.push(t.name === 'bash' ? logView('Command', args, false, 'bash') : logView('Input', args, false, 'json'));
      // A file Pi read is coloured in its own language.
      const read = t.name === 'read' ? langOf(parseArgs(t.args).path) : '';
      if (t.output) out.push(logView(status === 'error' ? 'Error' : 'Output', t.output, status === 'error', status === 'error' ? '' : read));
      else if (status === 'running') out.push(el('div', { class: 'think-text' }, 'Waiting for output…'));
      return out;
    });
  // An image the step wrote is shown under it, without opening the step.
  const img = state.web.has('workspace-images') && toolImage(t, state.workspace);
  if (img) li.append(mediaCard('Image', detail.split('/').pop(), el('a', { href: img, target: '_blank', rel: 'noopener' }, el('img', { src: img, alt: `Image written to ${detail}`, loading: 'lazy' }))));
  const made = state.web.has('agent-card') && savedAgent(t);
  if (made) li.append(agentCard(made));
  return li;
}

// agentCard shows an agent a chat saved, with a key to chat with it.
function agentCard(saved) {
  const a = agentById(saved.id) || saved;
  const facts = [a.model ? modelName(a.model) : 'Each chat’s model', Array.isArray(a.tools) ? (a.tools.length ? a.tools.join(', ') : 'No tools') : 'Default tools'];
  if (Array.isArray(a.mcp)) facts.push(a.mcp.length ? `MCP: ${a.mcp.join(', ')}` : 'No MCP servers');
  const go = el('button', { type: 'button', class: 'btn sm primary' }, svg(ICON.chat), 'Start chat');
  go.addEventListener('click', async () => {
    try { state.agents = await api('GET', 'api/agents'); } catch {}
    const now = agentById(saved.id);
    if (now) startChat(now); else toast(`${a.name} was deleted`);
  });
  const c = el('div', { class: 'agent-card' },
    el('div', { class: 'agent-text' }, el('b', {}, a.name), el('p', {}, a.description || facts.join(' · ')), a.description ? el('p', {}, facts.join(' · ')) : null),
    go);
  c.style.setProperty('--agent', agentColor(a));
  return c;
}

// mdHooks are the Markdown hooks of the plugins that are on. Charts are
// drawn at the reply's width, so their text stays at reading size.
function mdHooks() {
  const w = $('thread').clientWidth - (innerWidth <= 820 ? 32 : 64) - 34;
  return markdownHooks(state.web, { workspace: state.workspace, width: Math.min(w > 0 ? w : 640, 760) });
}

// step draws one row of a card of steps: an icon tile, the verb, what it
// worked on and how long it took. Its body is built on first open, so a
// long reply does not render every tool's output up front.
function step(kind, open, tileIcon, verb, arg, ms, body) {
  const det = el('details', { open: !!open },
    el('summary', {}, el('span', { class: 'tile' }, tileIcon), el('span', { class: 'verb' }, verb),
      el('span', { class: 'step-what' }, arg), el('span', { class: 'step-time' }, stepTime(ms))));
  const fill = () => {
    if (det.dataset.filled) return;
    det.dataset.filled = '1';
    det.append(el('div', { class: 'step-body' }, body()));
  };
  if (open) fill();
  det.addEventListener('toggle', () => { if (det.open) fill(); });
  return el('li', { class: 'step ' + kind, 'data-ms': String(ms || 0) }, det);
}
const isOpen = (n) => !!(n && n.querySelector && n.querySelector('details') && n.querySelector('details').open);

// placePart puts a part's node at the end of a reply body: steps join the
// card of steps they follow, text starts a new block.
function placePart(body, node) {
  if (node.tagName !== 'LI') { body.append(node); return; }
  let card = body.lastElementChild;
  if (!card || !card.classList.contains('work')) body.append(card = workCard());
  card.querySelector('.steps').append(node);
}

// workCard holds a run of steps under a header that folds them away.
function workCard() {
  const head = el('button', { type: 'button', class: 'work-head', 'aria-expanded': 'true' },
    el('span', { class: 'work-icon', 'aria-hidden': 'true' }), el('span', { class: 'work-text' }), svg(ICON.chevUp));
  const card = el('div', { class: 'work' }, head, el('ol', { class: 'steps' }));
  head.addEventListener('click', () => {
    const folded = card.classList.toggle('folded');
    head.setAttribute('aria-expanded', String(!folded));
  });
  return card;
}

// refreshWork rewrites the header of every card of steps under root from
// the steps it holds.
function refreshWork(root) {
  for (const card of root.querySelectorAll('.work')) {
    const steps = [...card.querySelectorAll('.steps > .step')].map((li) => ({
      status: ['running', 'error', 'think'].find((k) => li.classList.contains(k)) || 'done',
      ms: Number(li.dataset.ms) || 0,
    }));
    const { state, text } = workSummary(steps);
    if (card.dataset.state !== state) {
      card.dataset.state = state;
      card.querySelector('.work-icon').replaceChildren(svg({ running: ICON.sparkle, error: ICON.alert, done: ICON.check }[state]));
    }
    card.querySelector('.work-text').textContent = text;
  }
}

// mediaCard frames a picture with its title and its file's name.
function mediaCard(title, file, media, extra = '') {
  return el('span', { class: ('media-card ' + extra).trim() },
    el('span', { class: 'media-head' }, el('span', { class: 'media-title' }, title), file ? el('span', { class: 'media-file' }, file) : null),
    media);
}

// toolIcon is what a step's tile shows: what kind of work it was. Its
// state (running, done, failed) is drawn around it by style.css.
function toolIcon(t) {
  const name = t.name || '';
  if (name === 'bash') return ICON.terminal;
  if (name === 'read') return ICON.file;
  if (name === 'write') return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(describeTool(t).detail) ? ICON.chart : ICON.filePlus;
  if (name === 'edit') return ICON.edit;
  if (/_agents?$/.test(name)) return ICON.agent;
  return ICON.tool;
}

function describeTool(t) {
  const a = parseArgs(t.args);
  const raw = a.path || a.file_path || '';
  const path = workspacePath(raw, state.workspace) || raw; // shorter inside the workspace
  switch (t.name) {
    case 'bash': return { label: 'Ran', detail: firstLine(a.command) };
    case 'read': return { label: 'Read', detail: path };
    case 'edit': return { label: 'Edited', detail: path };
    case 'write': return { label: 'Created', detail: path };
    case 'create_agent': return { label: 'Created agent', detail: a.name || '' };
    case 'update_agent': return { label: 'Updated agent', detail: a.name || (agentById(a.id) || {}).name || '' };
    case 'list_agents': return { label: 'Listed agents', detail: '' };
    default: {
      const m = mcpTool(t.name);
      return m ? { label: m.tool, detail: m.server } : { label: t.name || 'Tool', detail: '' };
    }
  }
}
function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}
function toolArgs(t) {
  const a = parseArgs(t.args);
  if (t.name === 'bash' && a.command) return a.command;
  if (!Object.keys(a).length) return '';
  return JSON.stringify(a, null, 2);
}
const firstLine = (s) => String(s || '').trim().split('\n')[0];
// logView shows a step's input or output; with lang it is syntax coloured
// (highlight escapes everything it does not mark up).
function logView(title, text, error, lang) {
  const body = String(text).replace(/\n$/, '');
  const pre = el('pre', {});
  if (lang) pre.innerHTML = highlight(body, lang); else pre.textContent = body;
  const b = el('button', { class: 'code-copy', 'aria-label': `Copy ${title.toLowerCase()}`, title: 'Copy' }, svg(ICON.copy));
  b.addEventListener('click', () => copy(text, b));
  return el('div', { class: 'logview' + (error ? ' error' : '') }, el('div', { class: 'logview-head' }, title, b), pre);
}

function actionBtn(label, icon, fn) {
  const b = el('button', { class: 'icon-btn', 'aria-label': label, title: label }, svg(icon));
  b.addEventListener('click', () => fn(b));
  return b;
}

// decorateCode frames each code block: a header naming its file (or its
// language) with a Copy key, and line numbers in a gutter beside it. A
// reply's pictures get a title and their file's name.
function decorateCode(root) {
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.parentElement.classList.contains('code-body')) continue;
    const lang = pre.dataset.lang || '', file = pre.dataset.file || '';
    const code = pre.querySelector('code');
    const b = el('button', { type: 'button', class: 'code-copy text', 'aria-label': 'Copy code', 'data-label': 'Copy' }, svg(ICON.copy), 'Copy');
    b.addEventListener('click', () => copy(code.textContent, b));
    const lines = code.textContent.split('\n').length;
    const gutter = el('span', { class: 'code-gutter', 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, i) => i + 1).join('\n'));
    const box = el('div', { class: 'codeblock' },
      el('div', { class: 'code-head' }, el('span', { class: 'code-file' }, file || lang || 'code'), file && lang ? el('span', { class: 'code-lang' }, lang) : null, b));
    pre.replaceWith(box);
    box.append(el('div', { class: 'code-body' }, gutter, pre));
  }
  for (const img of root.querySelectorAll('img')) {
    if (img.closest('.drawing, .media-card')) continue;
    const src = img.getAttribute('src') || '';
    let file = src.split('/').pop() || '';
    try { file = decodeURIComponent(file); } catch {}
    const card = mediaCard(img.alt || file, img.alt ? file : '', img.cloneNode());
    img.replaceWith(card);
  }
}

// jumpToFootnote scrolls a footnote link to its note (or back) in the same
// reply, instead of letting the #fn link change the page's route.
function jumpToFootnote(e) {
  const a = e.target.closest('a[href^="#fn"]');
  if (!a) return;
  e.preventDefault();
  const id = a.getAttribute('href').slice(1);
  const to = [...e.currentTarget.querySelectorAll('[id]')].find((n) => n.id === id);
  if (to) to.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = el('textarea', { style: 'position:fixed;opacity:0' });
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  if (btn) {
    const label = btn.dataset.label;
    btn.replaceChildren(svg(ICON.check), ...(label ? ['Copied'] : []));
    btn.classList.add('done');
    setTimeout(() => { btn.replaceChildren(svg(ICON.copy), ...(label ? [label] : [])); btn.classList.remove('done'); }, 1400);
  }
}

function editMessage(wrap, m) {
  if (state.streaming) return;
  const ta = el('textarea', { 'aria-label': 'Edit message' });
  ta.value = m.content;
  const cancel = () => renderThread();
  const save = () => {
    const v = ta.value.trim();
    if (!v || v === m.content) return cancel();
    send(v, m.id, { attachments: m.attachments });
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  });
  wrap.replaceChildren(el('div', { class: 'edit-box' }, ta,
    el('div', { class: 'acts' },
      el('button', { class: 'btn ghost', onclick: cancel }, svg(ICON.cancel), 'Cancel'),
      el('button', { class: 'btn primary', onclick: save }, svg(ICON.arrowUp), 'Send'))));
  autosize(ta);
  ta.addEventListener('input', () => autosize(ta));
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function regenerate(m) {
  if (state.streaming || !m.id) return;
  send('', m.id);
}

// ---------- sending ----------
// send asks for a reply. files are the tray's picked files to upload
// first, each showing its progress there; attachments are files already in
// the workspace (an edited message's).
async function send(content, from, { files = [], attachments = [] } = {}) {
  if (state.streaming) return false;
  if (!state.chat) {
    const model = currentModel();
    if (!model) { toast('No models yet. Sign in to a provider with pi, then reload.'); return false; }
    try {
      const c = await api('POST', 'api/chats', { model, agentId: state.draftAgent ? state.draftAgent.id : '' });
      state.chat = c;
      upsertChat(c);
      history.replaceState(null, '', '#c=' + c.id);
    } catch (e) { toast(e.message); return false; }
  }
  const chat = state.chat;
  if (files.length) {
    setStreaming(true, 'Attaching');
    state.uploading = true;
    renderTray();
    try {
      attachments = [...attachments, ...(await Promise.all(files.map((p) =>
        uploadFile(chat.id, p.file, (sent) => { p.sent = sent; renderTray(); }))))];
    } catch (e) {
      toast(e.message);
      return false;
    } finally {
      state.uploading = false;
      for (const p of files) delete p.sent;
      setStreaming(false);
    }
    state.pending = [];
    renderTray();
  }

  // Show the conversation as the server will have it.
  if (from) {
    const i = chat.messages.findIndex((x) => x.id === from);
    if (i >= 0) chat.messages = chat.messages.slice(0, i);
  }
  if (content || attachments.length) chat.messages.push({ role: 'user', content, attachments });
  const reply = { role: 'assistant', content: '', parts: [], model: chat.model };
  chat.messages.push(reply);
  await streamReply(chat, reply, (signal) => fetch(`api/chats/${chat.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, from: from || '', attachments }),
    signal,
  }));
  return true;
}

// follow shows the reply the server is still writing for a chat that was
// opened mid-reply, from its start.
function follow(chat) {
  const reply = { role: 'assistant', content: '', parts: [], model: chat.model };
  chat.messages.push(reply);
  streamReply(chat, reply, (signal) => fetch(`api/chats/${chat.id}/stream`, { signal }));
}

// streamReply paints reply as its events arrive. The reply runs on the
// server: leaving the chat only stops watching it, and Stop asks the server
// to end it.
async function streamReply(chat, reply, open) {
  state.follow = true;
  renderThread();
  renderChats();

  const view = $('thread').lastElementChild;
  const body = view.querySelector('.body');
  const waiting = () => el('span', { class: 'waiting', role: 'status' }, waitingSpark(), el('span', { class: 'waiting-text' }, 'Thinking'));
  body.replaceChildren(waiting());

  const ctrl = new AbortController();
  state.streaming = ctrl;
  state.streamingChat = chat.id;
  setStreaming(true);

  // Each part has its own node; a paint redraws only the parts that
  // changed since the last frame, keeping folds the reader opened.
  // Text arrives in bursts, so each frame shows a little more of it
  // (shown[i] characters), and the parts after a text wait until it is
  // all shown. With reduced motion, text shows as it arrives.
  const nodes = [];
  const dirty = new Set();
  const shown = [];
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pending = false;
  let last = 0;
  const paint = (now) => {
    pending = false;
    if (ctrl.signal.aborted || state.streaming !== ctrl) return;
    const dt = last ? now - last : 16;
    last = now;
    let upTo = reply.parts.length - 1;
    for (let i = 0; i <= upTo; i++) {
      const p = reply.parts[i];
      if (!p || p.type !== 'text') continue;
      const len = (p.text || '').length;
      const was = shown[i] || 0;
      shown[i] = smooth ? revealNext(was, len, dt) : len;
      if (shown[i] !== was) dirty.add(i);
      if (shown[i] < len) upTo = i;
    }
    if (!nodes.length && reply.parts.length) body.replaceChildren();
    for (const i of dirty) {
      const p = reply.parts[i];
      if (!p || i > upTo) continue;
      const old = nodes[i];
      const live = p.type === 'thinking' && i === reply.parts.length - 1;
      const n = partView(p.type === 'text' ? { ...p, text: shownText(p.text, shown[i]) } : p, old ? isOpen(old) : live, true);
      if (old) old.replaceWith(n); else placePart(body, n);
      nodes[i] = n;
      dirty.delete(i);
    }
    refreshWork(body);
    scrollToEnd();
    if (dirty.size || upTo < reply.parts.length - 1 || reply.parts.some((p, i) => p && p.type === 'text' && shown[i] < (p.text || '').length)) schedule();
    else last = 0;
  };
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(paint); } };

  // A cut stream is opened again and replays the reply from its start, so
  // what was shown is cleared first.
  const status = el('p', { class: 'reconnecting', role: 'status', hidden: true });
  view.append(status);
  try {
    await watchReply({
      open,
      reopen: (signal) => fetch(`api/chats/${chat.id}/stream`, { signal }),
      loadSaved: () => loadSaved(chat.id),
      signal: ctrl.signal,
      onStatus: (s) => {
        status.hidden = s === 'live';
        status.textContent = s === 'unreachable'
          ? 'Harf can\'t be reached right now; the reply keeps going and will appear when it reconnects.'
          : 'Reconnecting';
      },
      onRestart: () => {
        reply.parts = [];
        delete reply.error;
        nodes.length = 0;
        shown.length = 0;
        dirty.clear();
        body.replaceChildren(waiting());
      },
      onEvent: (event, data) => {
        if (event === 'part') {
          if (data.part) reply.parts[data.index] = data.part;
          if (data.delta && reply.parts[data.index]) reply.parts[data.index].text = (reply.parts[data.index].text || '') + data.delta;
          dirty.add(data.index);
          schedule();
        } else if (event === 'done') {
          Object.assign(reply, data);
          done();
        } else if (event === 'title') {
          chat.title = data.title;
          upsertChat({ ...chat, updatedAt: new Date().toISOString() });
          renderChats();
          if (state.chat && state.chat.id === chat.id) renderTitle();
        } else if (event === 'error') {
          reply.error = data.error;
        }
      },
    });
  } catch (e) {
    reply.error = e.message; // the server refused the request
  }
  done();

  function done() {
    if (state.streaming !== ctrl) return;
    state.streaming = null;
    state.streamingChat = null;
    setStreaming(false);
    if (ctrl.signal.aborted) return; // left the chat; the reply goes on
    if ((reply.parts || []).some((p) => savedAgent(p.tool))) {
      api('GET', 'api/agents').then((list) => { state.agents = list; renderAgents(); }).catch(() => {});
    }
    upsertChat({ ...chat, updatedAt: new Date().toISOString() });
    renderChats();
    if (state.chat && state.chat.id === chat.id) renderThread();
  }
}

// stopReply asks the server to end the reply; what arrived so far is saved
// and comes back as the reply's done event.
function stopReply() {
  if (state.streamingChat) api('POST', `api/chats/${state.streamingChat}/stop`, {}).catch((e) => toast(e.message));
}

// leaveReply stops watching the reply on screen; the server keeps writing it.
function leaveReply() {
  state.streaming?.abort();
}

// uploadFile sends one picked file to the chat's uploads as it is, the
// name in a header, calling progress with the bytes sent so far. XHR, not
// fetch, because only XHR reports how much of a body has gone.
function uploadFile(chatID, file, progress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `api/chats/${chatID}/files`);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.setRequestHeader('X-Harf-Name', encodeURIComponent(file.name));
    x.responseType = 'json';
    x.upload.onprogress = (e) => progress(e.loaded);
    x.onload = () => {
      if (x.status === 201) resolve(x.response);
      else reject(new Error(`${file.name}: ${(x.response && x.response.error) || `${x.status} ${x.statusText}`}`));
    };
    x.onerror = () => reject(new Error(`${file.name}: the upload did not finish`));
    x.send(file);
  });
}

// loadSaved shows the saved copy of a chat whose reply has ended. It throws
// only when the server cannot be reached, so the caller tries again.
async function loadSaved(id) {
  let c;
  try {
    c = await api('GET', `api/chats/${id}`);
  } catch (e) {
    if (e instanceof TypeError) throw e;
    return;
  }
  if (state.chat && state.chat.id === id) state.chat = c;
}

function setStreaming(on, busy) {
  $('composer').classList.toggle('streaming', on && !busy);
  $('composer').classList.toggle('busy', !!busy);
  $('sendBtn').setAttribute('aria-label', busy || (on ? 'Stop' : 'Send'));
  updateSend();
}

function updateSend() {
  const busy = $('composer').classList.contains('busy');
  $('sendBtn').disabled = busy || (!state.streaming && !$('input').value.trim() && !state.pending.length);
}

// ---------- scrolling ----------
const scroller = $('scroller');
function scrollToEnd(force) {
  if (force) state.follow = true;
  if (state.follow) scroller.scrollTop = scroller.scrollHeight;
  showJump();
}
const atEnd = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
// showJump shows the jump-to-latest key only in a chat taller than the
// screen, scrolled away from its end.
function showJump() {
  const tall = scroller.scrollHeight > scroller.clientHeight + 40;
  $('jump').hidden = !state.chat || !tall || atEnd();
}
scroller.addEventListener('scroll', () => {
  state.follow = atEnd();
  showJump();
});
$('jump').addEventListener('click', () => { state.follow = true; scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }); });

// ---------- composer ----------
const input = $('input');
function autosize(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, innerHeight * 0.4) + 'px';
}
input.addEventListener('input', () => { autosize(input); updateSend(); store.set('draft', input.value); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.streaming) { stopReply(); return; }
  if ($('composer').classList.contains('busy')) return;
  const text = input.value.trim();
  const picked = state.pending;
  if (!text && !picked.length) return;
  input.value = '';
  store.set('draft', '');
  autosize(input);
  updateSend();
  // The tray keeps the files, with their progress, until they are uploaded.
  if (!(await send(text, '', { files: picked }))) {
    // Nothing was sent: give the message back to edit or retry.
    input.value = text;
    state.pending = picked;
    renderTray();
    autosize(input);
    updateSend();
    return;
  }
  for (const p of picked) if (p.url) URL.revokeObjectURL(p.url);
});

// ---------- attachments ----------
const MAX_FILES = 10;
const attachOn = () => state.web.has('attach');

function addFiles(list) {
  if (!attachOn()) return;
  for (const file of list) {
    if (state.pending.length >= MAX_FILES) { toast(`A message can carry at most ${MAX_FILES} files.`); break; }
    if (state.maxUpload && file.size > state.maxUpload) {
      toast(`${file.name} is ${fmtSize(file.size)}: a file can be at most ${fmtSize(state.maxUpload)}.`);
      continue;
    }
    if (unseen(file)) toast(`${file.name} is over ${fmtSize(state.maxModelImage)}: Pi's tools can open it, but the model will not see it.`);
    const url = isPicture(file.type) ? URL.createObjectURL(file) : '';
    state.pending.push({ file, url });
  }
  renderTray();
  updateSend();
  input.focus();
}

// unseen is a picture the model would see, but too big to send it.
function unseen(file) {
  if (!state.maxModelImage || file.size <= state.maxModelImage || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return false;
  const m = state.models.find((x) => x.id === currentModel());
  return !!(m && m.images);
}

function renderTray() {
  const tray = $('tray');
  tray.replaceChildren(...state.pending.map((p, i) => {
    const remove = state.uploading ? null : el('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${p.file.name}`, title: 'Remove',
      onclick: () => { if (p.url) URL.revokeObjectURL(p.url); state.pending.splice(i, 1); renderTray(); updateSend(); input.focus(); } }, svg(ICON.x));
    const face = p.url ? el('img', { class: 'tray-thumb', src: p.url, alt: '' }) : el('span', { class: 'tray-icon' }, fileIcon(p.file.type, p.file.name));
    const sending = p.sent !== undefined;
    const pct = sending ? Math.min(100, Math.floor((p.sent / (p.file.size || 1)) * 100)) : 0;
    const note = sending ? `${fmtSize(p.sent)} of ${fmtSize(p.file.size)}`
      : unseen(p.file) ? `${fmtSize(p.file.size)}, model won't see it` : fmtSize(p.file.size);
    const item = el('li', { class: unseen(p.file) ? 'tray-item unseen' : 'tray-item', title: unseen(p.file) ? 'Too big to show the model. It is saved in the workspace, where Pi\'s tools can open it.' : null }, face,
      el('span', { class: 'tray-text' }, el('span', { class: 'att-name' }, p.file.name), el('span', { class: 'att-size' }, note)),
      remove);
    if (sending) {
      item.classList.add('sending');
      item.append(el('span', { class: 'tray-bar', role: 'progressbar', 'aria-label': `Uploading ${p.file.name}`,
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), style: `width: ${pct}%` }));
    }
    return item;
  }));
  tray.hidden = !state.pending.length;
}

function renderAttach() {
  $('attachBtn').hidden = !attachOn();
  if (!attachOn() && state.pending.length) { state.pending = []; renderTray(); updateSend(); }
}

// The + turns a quarter before the file picker opens, then turns back.
$('attachBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (!files.length || !attachOn()) return;
  if (!e.clipboardData.getData('text')) e.preventDefault();
  addFiles(files);
});
// Dropping files anywhere on the chat attaches them. A file dropped
// anywhere else, or while attaching is off, is refused rather than left to
// the browser, which would open it in place of the page.
let dragDepth = 0;
const dragsFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
function showDrop(on) {
  const hint = $('dropHint');
  hint.hidden = !on;
  if (!on) { dragDepth = 0; return; }
  hint.classList.toggle('off', !attachOn());
  $('dropText').textContent = attachOn() ? 'Drop files to attach them' : 'Turn on the Attachments plugin in Settings to attach files';
}
$('main').addEventListener('dragenter', (e) => { if (!dragsFiles(e)) return; e.preventDefault(); dragDepth++; showDrop(true); });
$('main').addEventListener('dragover', (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = attachOn() ? 'copy' : 'none';
});
$('main').addEventListener('dragleave', (e) => { if (dragsFiles(e) && --dragDepth <= 0) showDrop(false); });
$('main').addEventListener('drop', (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  showDrop(false);
  if (!attachOn()) { toast('Turn on the Attachments plugin in Settings to attach files.'); return; }
  addFiles([...e.dataTransfer.files]);
});
document.addEventListener('dragover', (e) => {
  if (!dragsFiles(e) || $('main').contains(e.target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
});
document.addEventListener('drop', (e) => { if (dragsFiles(e)) { e.preventDefault(); showDrop(false); } });
document.addEventListener('dragend', () => showDrop(false));

function renderComposerAgent() {
  const box = $('composerAgent');
  box.replaceChildren();
  const agent = currentAgent();
  input.placeholder = agent ? `Ask ${agent.name} anything` : state.chat ? 'Reply…' : 'Ask anything, or describe a task';
  if (!agent) return;
  box.append(el('span', {}, agent.name));
  if (!state.chat) box.append(el('button', { class: 'chip-x', type: 'button', 'aria-label': 'Chat without this agent', title: 'Chat without this agent', onclick: () => startChat(null) }, svg(ICON.x)));
}

// ---------- navigation ----------
function startChat(agent) {
  leaveReply();
  state.chat = null;
  state.draftAgent = agent;
  state.draftModel = (agent && agent.model) || store.get('model', '') || state.defaultModel;
  if (state.draftModel && state.models.length && !hasModel(state.draftModel) && !(agent && agent.model)) state.draftModel = '';
  if (location.hash) history.pushState(null, '', location.pathname + location.search);
  closeNav();
  showView('chat');
  renderThread();
  renderAgents();
  renderChats();
  input.focus();
}

// showView shows the chat, the Agents page or the settings page, and marks
// the sidebar entry for where the reader is.
function showView(view) {
  $('main').hidden = view !== 'chat';
  $('agentsPage').hidden = view !== 'agents';
  $('settingsPage').hidden = view !== 'settings';
  $('settingsNav').classList.toggle('active', view === 'settings');
  $('settingsNav').toggleAttribute('aria-current', view === 'settings');
  $('agentsHead').toggleAttribute('aria-current', view === 'agents');
  document.querySelector('.top').classList.toggle('bare', view !== 'chat');
  if (view !== 'chat') { closeDropdown(false); showDrop(false); }
  renderTitle();
}

// backTo is the chat the reader was on before the Agents or settings page.
let backTo = '';

async function route() {
  closeMenu();
  if (location.hash === '#settings/agents') { history.replaceState(null, '', '#agents'); }
  if (location.hash === '#agents') {
    closeNav(); showView('agents'); renderAgentsPage(); document.title = 'Agents · Harf';
    // Whether an agent's chat is replying comes from the server, fresh.
    api('GET', 'api/chats').then((list) => { state.chats = list; renderChats(); }).catch(() => {});
    return;
  }
  const s = location.hash.match(/^#settings(?:\/([a-z]+))?$/);
  if (s) { closeNav(); renderSettings(s[1] || 'appearance'); showView('settings'); return; }
  backTo = /^#c=/.test(location.hash) ? location.hash : '';
  showView('chat');
  const m = location.hash.match(/^#c=([0-9a-f]+)$/);
  if (!m) { if (state.chat) startChat(null); else { renderThread(); showView('chat'); } return; }
  if (state.chat && state.chat.id === m[1]) return;
  leaveReply();
  try {
    state.chat = await api('GET', `api/chats/${m[1]}`);
    state.draftAgent = null;
  } catch {
    toast('That chat no longer exists.');
    history.replaceState(null, '', location.pathname + location.search);
    state.chat = null;
  }
  closeNav();
  renderThread();
  renderChats();
  renderAgents();
  showView('chat');
  if (state.chat && state.chat.replying) follow(state.chat);
}
addEventListener('hashchange', route);
addEventListener('popstate', route);

const newChat = (e) => { if (e) e.preventDefault(); startChat(null); };
$('newChat').addEventListener('click', newChat);
document.querySelector('.brand-home').addEventListener('click', newChat);
$('scrim').addEventListener('click', closeNav);
function closeNav() { $('app').classList.remove('nav-open'); }

// ---------- sidebar: whole, an icon rail, or hidden ----------
// On a phone it is a drawer behind the menu button instead.
const phone = matchMedia('(max-width: 760px)');
const sidebar = () => document.documentElement.dataset.sidebar || 'open';
function setSidebar(v) {
  if (v === 'open') delete document.documentElement.dataset.sidebar;
  else document.documentElement.dataset.sidebar = v;
  store.set('sidebar', v);
  renderSidebarControls();
  if (!$('settingsPage').hidden && settingsSection === 'appearance') renderSettings('appearance');
}
function toggleSidebar() {
  if (phone.matches) { $('app').classList.toggle('nav-open'); return; }
  setSidebar(sidebar() === 'hidden' ? 'open' : 'hidden');
}
function renderSidebarControls() {
  const rail = sidebar() === 'rail';
  const c = $('collapseBtn');
  c.replaceChildren(svg(ICON.panel));
  c.setAttribute('aria-label', rail ? 'Expand sidebar' : 'Collapse sidebar');
  c.title = rail ? 'Expand sidebar' : `Collapse sidebar (${keyName('B')} hides it)`;
  c.setAttribute('aria-expanded', String(!rail));
  const m = $('menuBtn');
  m.replaceChildren(svg(phone.matches ? ICON.menu : ICON.panel));
  m.setAttribute('aria-label', phone.matches ? 'Open menu' : 'Show sidebar');
  m.title = phone.matches ? 'Open menu' : `Show sidebar (${keyName('B')})`;
  m.setAttribute('aria-expanded', String(phone.matches ? $('app').classList.contains('nav-open') : sidebar() !== 'hidden'));
}
$('collapseBtn').addEventListener('click', () => setSidebar(sidebar() === 'rail' ? 'open' : 'rail'));
$('menuBtn').addEventListener('click', () => {
  if (phone.matches) $('app').classList.add('nav-open');
  else setSidebar('open');
  renderSidebarControls();
});
phone.addEventListener('change', () => { closeNav(); renderSidebarControls(); });

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const keyName = (k, shift) => (mac ? `⌘${shift ? '⇧' : ''}${k}` : `Ctrl+${shift ? 'Shift+' : ''}${k}`);
const keyCaps = (...keys) => el('span', { class: 'keys-list' }, keys.map((k) => el('kbd', { class: 'kbd' }, k)));
// The sidebar's quiet key hints. Browsers keep Cmd/Ctrl+N for a new window
// and never pass it to a page, so a new chat is Cmd/Ctrl+Shift+O.
$('newChatKeys').textContent = keyName('O', true);
$('searchKeys').textContent = keyName('K');
$('settingsKeys').textContent = keyName(',');
$('newChat').title = `New chat (${keyName('O', true)})`;
$('searchBtn').setAttribute('aria-label', `Search (${keyName('K')})`);
$('settingsNav').title = `Settings (${keyName(',')})`;
$('searchBtn').addEventListener('click', () => palette.open());
document.addEventListener('keydown', (e) => {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && !e.shiftKey && k === 'k') { e.preventDefault(); closeMenu(); closeDropdown(false); palette.isOpen() ? palette.close() : palette.open(); }
  else if (mod && !e.shiftKey && e.key === ',') { e.preventDefault(); closeMenu(); location.hash = '#settings'; }
  else if (mod && !e.shiftKey && k === 'b') { e.preventDefault(); toggleSidebar(); }
  else if (mod && e.shiftKey && k === 'o') { e.preventDefault(); startChat(null); }
  else if (e.key === 'Escape' && (menuEl || palette.isOpen())) closeMenu();
  else if (e.key === 'Escape' && state.streaming) stopReply();
  else if (e.key === 'Escape') closeNav();
});

// ---------- agents ----------
const dialog = $('agentDialog');

// closeOnBackdrop closes a modal dialog when a click starts and ends
// outside its box, so a text selection dragged out of a field keeps it open.
function closeOnBackdrop(d) {
  let outside = false;
  const out = (e) => {
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  d.addEventListener('pointerdown', (e) => { outside = e.target === d && out(e); });
  d.addEventListener('click', (e) => { if (outside && e.target === d && out(e)) d.close(); outside = false; });
}
closeOnBackdrop(dialog);
const form = $('agentForm');
let editing = null;
const TOOLS = ['read', 'bash', 'edit', 'write']; // Pi's built-in tools

// openAgent edits agent, or makes a new one, its fields prefilled from draft.
function openAgent(agent, draft = {}) {
  editing = agent;
  $('agentDialogTitle').textContent = agent ? `Edit ${agent.name}` : 'New agent';
  $('agentDelete').hidden = !agent;
  form.elements.name.value = agent ? agent.name : draft.name || '';
  form.elements.description.value = agent ? agent.description || '' : '';
  form.elements.systemPrompt.value = agent ? agent.systemPrompt || '' : '';
  form.elements.thinking.value = agent ? agent.thinking || '' : '';
  const tools = agent && Array.isArray(agent.tools) ? agent.tools : TOOLS;
  for (const t of TOOLS) form.elements['tool-' + t].checked = tools.includes(t);
  setAgentModel(agent ? agent.model || '' : '');
  renderAgentMcp(agent ? agent.mcp : null);
  closeNav();
  dialog.showModal();
  form.elements.name.focus();
}

// The agent's model: a dropdown like the composer's, with a first entry
// that leaves the choice to each chat.
const CHAT_MODEL = 'Use the chat’s model';
function setAgentModel(id) {
  form.elements.model.value = id;
  $('agentModelValue').textContent = id ? modelName(id) : CHAT_MODEL;
  $('agentModelLogo').replaceChildren(...(id ? [modelLogo(id, modelName(id))] : []));
}
dropdownTrigger($('agentModelBtn'), () => {
  const cur = form.elements.model.value;
  return {
    noun: 'model',
    current: cur,
    groups: (q) => {
      const own = !q.trim() || CHAT_MODEL.toLowerCase().includes(q.trim().toLowerCase()) ? [{ provider: 'Default', models: [{ id: '', name: CHAT_MODEL }] }] : [];
      return [...own, ...groupModels(state.models, q, cur)];
    },
    onPick: setAgentModel,
  };
});

// The agent's MCP servers: every enabled one (also those added later), or
// the ones ticked, which may be none.
function renderAgentMcp(chosen) {
  const box = $('agentMcp');
  if (!state.mcp.length) {
    box.replaceChildren(el('p', { class: 'field-note' }, 'No MCP servers yet. ',
      el('a', { href: '#settings/mcp', onclick: () => dialog.close() }, 'Add one in Settings'), '.'));
    return;
  }
  const all = el('input', { type: 'checkbox', name: 'mcp-all' });
  all.checked = chosen == null;
  const checks = state.mcp.map((m) => {
    const c = el('input', { type: 'checkbox', name: 'mcp-server', value: m.name });
    c.checked = chosen == null ? m.enabled : chosen.includes(m.name);
    c.disabled = all.checked;
    return el('label', { class: 'check' }, c, el('span', {}, el('b', {}, m.name), m.enabled ? '' : ' (off)'));
  });
  all.addEventListener('change', () => {
    for (const l of checks) { const c = l.querySelector('input'); c.disabled = all.checked; if (all.checked) c.checked = state.mcp.find((m) => m.name === c.value).enabled; }
  });
  box.replaceChildren(el('label', { class: 'check' }, all, el('span', {}, el('b', {}, 'Every enabled server'), ', also ones added later')), ...checks);
}
function agentMcpValue() {
  const all = form.querySelector('input[name="mcp-all"]');
  if (!all) return editing ? editing.mcp ?? null : null;
  if (all.checked) return null;
  return [...form.querySelectorAll('input[name="mcp-server"]:checked')].map((c) => c.value);
}

$('newAgent').addEventListener('click', () => openAgent(null));
$('agentCancel').addEventListener('click', () => dialog.close());
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const body = {
    name: f.name.value.trim(),
    icon: editing ? editing.icon || '' : '', // kept as saved; the avatar comes from the name
    description: f.description.value.trim(),
    systemPrompt: f.systemPrompt.value.trim(),
    model: f.model.value,
    thinking: f.thinking.value,
    // Tools the form does not show (an agent made in a chat may list
    // grep, find or ls) are kept.
    tools: [...TOOLS.filter((t) => f['tool-' + t].checked), ...(editing && Array.isArray(editing.tools) ? editing.tools.filter((t) => !TOOLS.includes(t)) : [])],
    mcp: agentMcpValue(),
  };
  if (!body.name) { f.name.focus(); return; }
  try {
    const saved = editing ? await api('PUT', `api/agents/${editing.id}`, body) : await api('POST', 'api/agents', body);
    state.agents = await api('GET', 'api/agents');
    dialog.close();
    toast(editing ? 'Agent saved' : 'Agent created');
    if (!editing) startChat(saved);
    else { if (state.draftAgent && state.draftAgent.id === saved.id) state.draftAgent = saved; renderAgents(); renderThread(); renderChats(); }
    if (!$('settingsPage').hidden) renderSettings(settingsSection);
  } catch (err) { toast(err.message); }
});
$('agentDelete').addEventListener('click', () => {
  if (!editing) return;
  showMenu($('agentDelete'), [
    [`Delete ${editing.name}`, ICON.trash, async () => {
      try {
        await api('DELETE', `api/agents/${editing.id}`);
        state.agents = state.agents.filter((a) => a.id !== editing.id);
        if (state.draftAgent && state.draftAgent.id === editing.id) state.draftAgent = null;
        dialog.close();
        toast('Agent deleted. Its chats stay, without its instructions.');
        renderAgents(); renderThread(); renderChats();
        if (!$('settingsPage').hidden) renderSettings(settingsSection);
      } catch (err) { toast(err.message); }
    }, 'danger'],
    ['Keep it', ICON.cancel, () => {}],
  ]);
  // The menu must sit above the modal dialog.
  dialog.append(menuEl.m);
});

// ---------- the Agents page ----------
// A card for each agent: what it does, the tools and servers it may use,
// how many chats it has and whether one is replying now. A card starts a
// chat with its agent; its pencil edits it.
function renderAgentsPage() {
  const grid = $('agentGrid');
  if ($('agentsPage').hidden) return;
  const enabled = state.mcp.filter((m) => m.enabled).map((m) => m.name);
  const cards = state.agents.map((a) => {
    const { chats, running } = agentActivity(a.id, state.chats.map((c) => (c.id === state.streamingChat ? { ...c, replying: true } : c)));
    const go = el('button', { type: 'button', class: 'agent-card-go', onclick: () => startChat(a) },
      el('span', { class: 'agent-name' }, a.name));
    const edit = el('button', { type: 'button', class: 'icon-btn agent-card-edit', 'aria-label': `Edit ${a.name}`, title: `Edit ${a.name}`, onclick: () => openAgent(a) }, svg(ICON.edit));
    return el('li', { class: 'agent-tile' },
      el('div', { class: 'agent-tile-top' },
        el('span', { class: 'agent-icon', 'aria-hidden': 'true' }, svg(ICON.bot)),
        el('span', { class: 'agent-state' + (running ? ' running' : '') }, el('span', { class: 'state-dot', 'aria-hidden': 'true' }), running ? 'running' : 'idle'),
        edit),
      go,
      el('p', { class: 'agent-desc' }, a.description || 'No description'),
      el('ul', { class: 'agent-tags', 'aria-label': 'Tools and servers' }, agentTags(a, enabled).map((t) => el('li', {}, t))),
      el('div', { class: 'agent-foot' }, el('span', {}, `${chats} ${chats === 1 ? 'chat' : 'chats'}`), el('span', {}, editedLabel(a.updatedAt))));
  });
  const add = el('li', { class: 'agent-tile add' },
    el('button', { type: 'button', class: 'agent-add', onclick: () => openAgent(null) },
      el('span', { class: 'add-box', 'aria-hidden': 'true' }, svg(ICON.plus)),
      el('span', { class: 'add-title' }, 'Create an agent'),
      el('span', { class: 'add-line' }, 'Give it instructions, a model and tools, then chat with it anytime.')));
  grid.replaceChildren(...cards, add);
  // While a chat is replying, look again shortly so its card settles to idle.
  clearTimeout(agentsPoll);
  if (state.chats.some((c) => c.replying)) {
    agentsPoll = setTimeout(() => api('GET', 'api/chats').then((list) => { state.chats = list; renderChats(); }).catch(() => {}), 5000);
  }
}
let agentsPoll = 0;
$('createAgentBtn').addEventListener('click', () => openAgent(null));

// ---------- plugins ----------
const PART = { attach: 'Attach button', 'workspace-images': 'Images in replies', chart: 'Chart blocks', svg: 'SVG blocks', 'agent-card': 'Agent cards in replies' };

function setPlugins(list) {
  state.plugins = list;
  state.web = new Set(list.filter((p) => p.enabled).flatMap((p) => p.web || []));
}

// setPlugin turns a plugin on or off on the server, then redraws what it
// changes. It returns whether the change was saved.
async function setPlugin(p, on) {
  try {
    const saved = await api('PUT', `api/plugins/${p.id}`, { enabled: on });
    setPlugins(state.plugins.map((x) => (x.id === saved.id ? { ...x, enabled: saved.enabled } : x)));
    toast(`${saved.name} ${saved.enabled ? 'on' : 'off'}`);
    renderAttach();
    renderThread();
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

// switchButton draws a switch: a button with role switch.
function switchButton(on, labelledBy, onToggle) {
  const b = el('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-labelledby': labelledBy },
    el('span', { class: 'switch-track', 'aria-hidden': 'true' }, el('span', { class: 'switch-thumb' })));
  b.addEventListener('click', () => onToggle(b));
  return b;
}

function pluginRows() {
  if (!state.plugins.length) return el('p', { class: 'empty-note' }, 'This server has no plugins.');
  return el('ul', { class: 'plugin-list' }, state.plugins.map((p) => {
    const adds = [...(p.system ? ['Instructions for the model'] : []), ...(p.web || []).map((w) => PART[w] || w)];
    const sw = switchButton(p.enabled, `plugin-${p.id}`, async (b) => {
      if (p.unavailable) return;
      b.disabled = true;
      await setPlugin(p, !p.enabled);
      renderSettings('plugins');
      const again = $('settingsBody').querySelector(`[aria-labelledby="plugin-${p.id}"]`);
      if (again) again.focus();
    });
    return el('li', { class: 'plugin' + (p.enabled ? '' : ' off') },
      el('div', { class: 'plugin-text' },
        el('b', { id: `plugin-${p.id}` }, p.name),
        el('p', {}, p.description),
        el('ul', { class: 'plugin-adds', 'aria-label': 'Adds' }, adds.map((a) => el('li', {}, a))),
        p.unavailable ? el('p', { class: 'plugin-note' }, p.unavailable) : null,
        p.id === 'images' && !p.unavailable ? imageModelPicker() : null),
      sw);
  }));
}

// imageModelPicker chooses the model image generation uses.
function imageModelPicker() {
  const name = (id) => (state.imageModels.find((m) => m.id === id) || {}).name || id || 'None chosen';
  const value = el('span', { class: 'select-value' }, name(state.imageModel));
  const logo = el('span', { class: 'select-logo' }, state.imageModel ? modelLogo(state.imageModel, name(state.imageModel)) : null);
  const b = el('button', { type: 'button', class: 'select-trigger boxed', id: 'imageModelBtn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-labelledby': 'imageModelLabel imageModelBtn', disabled: !state.imageModels.length },
    logo, value, svg(ICON.chevDown));
  b.lastChild.classList.add('select-chev');
  dropdownTrigger(b, () => ({
    noun: 'image model',
    current: state.imageModel,
    groups: (q) => groupModels(state.imageModels, q, state.imageModel),
    onPick: async (id) => {
      try {
        state.imageModel = (await api('PUT', 'api/image-model', { model: id })).imageModel;
        value.textContent = name(state.imageModel);
        logo.replaceChildren(...(state.imageModel ? [modelLogo(state.imageModel, name(state.imageModel))] : []));
        toast(`Images are made with ${name(state.imageModel)}`);
      } catch (e) { toast(e.message); }
    },
  }));
  return el('div', { class: 'plugin-field' }, el('span', { class: 'plugin-field-label', id: 'imageModelLabel' }, 'Image model'), b);
}

// ---------- settings ----------
const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: ICON.swatch },
  { id: 'plugins', label: 'Plugins', icon: ICON.plug },
  { id: 'mcp', label: 'MCP servers', icon: ICON.server },
  { id: 'about', label: 'About', icon: ICON.info },
];
let settingsSection = 'appearance';

function renderSettings(section) {
  if (!SECTIONS.some((s) => s.id === section)) section = 'appearance';
  settingsSection = section;
  document.title = `${SECTIONS.find((s) => s.id === section).label} · Settings · Harf`;
  $('settingsNavTabs').replaceChildren(...SECTIONS.map((s) => el('a', { href: `#settings/${s.id}`, 'aria-current': s.id === section ? 'page' : null },
    svg(s.icon), s.label)));
  const body = { appearance: appearanceCard, plugins: pluginsCard, mcp: mcpCard, about: aboutCard }[section]();
  $('settingsBody').replaceChildren(...[body].flat());
}

// card holds one settings section: a line on what it holds with an
// optional action at its right, then its rows. The tab names the section,
// so the card does not repeat it.
function card({ title, sub, action }, ...kids) {
  return el('section', { class: 'card', 'aria-label': title },
    sub || action ? el('div', { class: 'card-head' }, sub ? el('p', { class: 'card-sub' }, sub) : null, action) : null,
    ...kids);
}

// seg draws segmented keys as a radio group.
function seg(label, options, value, onPick) {
  return el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, options.map((o) => {
    const on = o.id === value;
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : '', style: o.style || null },
      o.icon ? svg(o.icon) : null, o.label);
    b.addEventListener('click', () => onPick(o.id));
    return b;
  }));
}

function setRow(label, hint, control) {
  return el('li', { class: 'set-row' },
    el('div', { class: 'set-label' }, label, hint ? el('small', {}, hint) : null),
    el('div', { class: 'set-control' }, control));
}

function appearanceCard() {
  const prefs = loadAppearance();
  const save = (patch) => { applyAppearance({ ...prefs, ...patch }); renderAgents(); renderChats(); renderThread(); renderSettings('appearance'); };
  const fontKeys = FONTS.map((f) => ({ ...f, style: `font-family: ${f.stack || "'Google Sans', sans-serif"}` }));
  const presets = ACCENTS.some((a) => a.id === prefs.accent);
  const custom = presets ? '' : prefs.accent;
  const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' }, ACCENTS.map((a) => {
    const b = el('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(prefs.accent === a.id), 'aria-label': a.label, title: a.label, style: `--sw: ${a.color}` }, svg(ICON.check));
    b.addEventListener('click', () => save({ accent: a.id }));
    return b;
  }));
  const picker = el('input', { type: 'color', value: custom || '#3f6212', 'aria-label': 'Custom accent colour' });
  picker.addEventListener('change', () => save({ accent: picker.value }));
  swatches.append(el('label', { class: 'custom-color' + (custom ? ' on' : ''), title: 'Pick any colour' }, picker, custom ? custom : 'Custom'));
  return card({ title: 'Appearance', sub: 'Changes apply at once and are kept in this browser.' },
    el('ul', { class: 'set-rows' },
      setRow('Theme', 'System follows your computer.', seg('Theme', [
        { id: 'system', label: 'System', icon: ICON.monitor }, { id: 'light', label: 'Light', icon: ICON.sun }, { id: 'dark', label: 'Dark', icon: ICON.moon },
      ], store.get('theme', 'system'), (t) => { setTheme(t); renderSettings('appearance'); })),
      setRow('Font', 'For all text but code.', seg('Font', fontKeys, prefs.font, (font) => save({ font }))),
      setRow('Sidebar font', 'For everything in the sidebar.', seg('Sidebar font', fontKeys, prefs.sideFont, (sideFont) => save({ sideFont }))),
      setRow('Text size', null, seg('Text size', SIZES, prefs.size, (size) => save({ size }))),
      setRow('Accent colour', 'Links, focus rings, switches and highlights.', swatches)));
}

function pluginsCard() {
  return card({ title: 'Plugins', sub: 'Plugins add to what the model is told and to how replies are shown. Turning one off takes it out of new replies; old replies show plain text where it drew something.' },
    pluginRows());
}

function aboutCard() {
  const providers = new Set(state.models.map((m) => m.provider)).size;
  const facts = [
    ['App', 'Harf, a chat for the Pi coding agent'],
    state.version ? ['Version', el('code', {}, state.version)] : null,
    ['Default model', state.defaultModel ? modelName(state.defaultModel) : 'None set'],
    ['Models', `${state.models.length} from ${providers} provider${providers === 1 ? '' : 's'}`],
    state.workspace ? ['Workspace', el('code', {}, state.workspace)] : null,
    ['Shortcuts', [
      el('span', {}, keyCaps(...(mac ? ['⌘', 'K'] : ['Ctrl', 'K'])), ' Search'),
      el('span', {}, keyCaps(...(mac ? ['⌘', '⇧', 'O'] : ['Ctrl', 'Shift', 'O'])), ' New chat'),
      el('span', {}, keyCaps(...(mac ? ['⌘', 'B'] : ['Ctrl', 'B'])), ' Sidebar'),
      el('span', {}, keyCaps('Esc'), ' Stop a reply'),
    ]],
  ].filter(Boolean);
  return card({ title: 'About' }, el('dl', { class: 'about-list' }, facts.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v)))));
}

// ---------- MCP servers ----------
const mcpDialog = $('mcpDialog');
closeOnBackdrop(mcpDialog);
const mcpForm = $('mcpForm');
let mcpEditing = null;
const mcpChecks = {}; // the last test of each server, by name

function mcpCard() {
  const add = el('button', { type: 'button', class: 'btn sm primary', onclick: () => openMCP(null) }, svg(ICON.plus), 'Add server');
  const rows = state.mcp.length
    ? el('ul', { class: 'plugin-list' }, state.mcp.map((m) => {
      const id = `mcp-${m.name}`;
      const sw = switchButton(m.enabled, id, async (b) => {
        b.disabled = true;
        await setMCPEnabled(m, !m.enabled);
        renderSettings('mcp');
        const again = $('settingsBody').querySelector(`[aria-labelledby="${id}"]`);
        if (again) again.focus();
      });
      const check = mcpChecks[m.name];
      return el('li', { class: 'plugin' + (m.enabled ? '' : ' off') },
        el('div', { class: 'plugin-text' },
          el('b', { id }, m.name),
          el('p', {}, el('code', { class: 'mcp-where' }, m.url || [m.command, ...(m.args || [])].join(' '))),
          check ? mcpCheckView(check) : null,
          el('div', { class: 'mcp-actions' },
            el('button', { type: 'button', class: 'btn sm', onclick: (e) => testSaved(m, e.currentTarget) }, svg(ICON.plugZap), 'Test'),
            el('button', { type: 'button', class: 'btn sm ghost', onclick: () => openMCP(m), 'aria-label': `Edit ${m.name}` }, svg(ICON.edit), 'Edit'))),
        sw);
    }))
    : el('p', { class: 'empty-note' }, 'No MCP servers yet. An MCP server adds tools, such as search, a database or an issue tracker.');
  return card({ title: 'MCP servers', sub: 'Every chat connects to the servers that are on, unless an agent picks its own. A server started by a command runs on this machine as the user running Harf, with that user’s files and environment.', action: add }, rows);
}

// mcpCheckView shows what a test found: the tools, or why it failed.
function mcpCheckView(c) {
  const ok = c.state === 'connected';
  const text = ok
    ? `Connected: ${c.tools.length} tool${c.tools.length === 1 ? '' : 's'}${c.tools.length ? ': ' + c.tools.map((t) => t.name).join(', ') : ''}`
    : `${c.state[0].toUpperCase() + c.state.slice(1)}${c.error ? ': ' + c.error : ''}`;
  return el('p', { class: 'mcp-check ' + (ok ? 'ok' : 'bad') }, svg(ok ? ICON.check : ICON.alert), el('span', {}, text));
}

async function setMCPEnabled(m, on) {
  try {
    const saved = await api('PUT', `api/mcp/${encodeURIComponent(m.name)}`, { ...m, enabled: on });
    state.mcp = state.mcp.map((x) => (x.name === saved.name ? saved : x));
    toast(`${saved.name} ${saved.enabled ? 'on' : 'off'}`);
  } catch (e) { toast(e.message); }
}

async function testSaved(m, b) {
  b.disabled = true;
  b.replaceChildren(svg(ICON.plugZap), 'Testing…');
  try { mcpChecks[m.name] = await api('POST', 'api/mcp/test', m); } catch (e) { mcpChecks[m.name] = { state: 'failed', error: e.message, tools: [] }; }
  if (!$('settingsPage').hidden && settingsSection === 'mcp') renderSettings('mcp');
}

function mcpKind(kind) {
  for (const g of mcpForm.querySelectorAll('.mcp-kind')) g.hidden = g.dataset.kind !== kind;
}
mcpForm.elements.kind.addEventListener('change', () => mcpKind(mcpForm.elements.kind.value));

function openMCP(m) {
  mcpEditing = m;
  const f = mcpForm.elements;
  $('mcpDialogTitle').textContent = m ? `Edit ${m.name}` : 'Add MCP server';
  $('mcpDelete').hidden = !m;
  f.name.value = m ? m.name : '';
  f.name.readOnly = !!m;
  f.kind.value = m && m.url ? 'url' : 'stdio';
  f.command.value = m ? m.command || '' : '';
  f.args.value = m ? (m.args || []).join('\n') : '';
  f.env.value = m ? formatPairs(m.env, '=') : '';
  f.url.value = m ? m.url || '' : '';
  f.headers.value = m ? formatPairs(m.headers, ':') : '';
  mcpKind(f.kind.value);
  $('mcpResult').hidden = true;
  closeNav();
  mcpDialog.showModal();
  (m ? f.command : f.name).focus();
}

// mcpBody reads the form as the API takes it; it throws on a bad line.
function mcpBody() {
  const f = mcpForm.elements;
  const body = { name: f.name.value.trim(), enabled: mcpEditing ? mcpEditing.enabled : true };
  if (f.kind.value === 'url') {
    body.url = f.url.value.trim();
    body.headers = parsePairs(f.headers.value, ':');
  } else {
    body.command = f.command.value.trim();
    body.args = f.args.value.split('\n').map((a) => a.trim()).filter(Boolean);
    body.env = parsePairs(f.env.value, '=');
  }
  return body;
}

function mcpResult(node) {
  $('mcpResult').replaceChildren(node);
  $('mcpResult').hidden = false;
}

$('mcpCancel').addEventListener('click', () => mcpDialog.close());
$('mcpTest').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  let body;
  try { body = mcpBody(); } catch (err) { mcpResult(mcpCheckView({ state: 'not tested', error: err.message, tools: [] })); return; }
  b.disabled = true;
  b.replaceChildren(svg(ICON.plugZap), 'Testing…');
  mcpResult(el('p', { class: 'mcp-check' }, el('span', {}, 'Starting the server…')));
  try { mcpResult(mcpCheckView(await api('POST', 'api/mcp/test', body))); } catch (err) { mcpResult(mcpCheckView({ state: 'not tested', error: err.message, tools: [] })); }
  b.disabled = false;
  b.replaceChildren(svg(ICON.plugZap), 'Test');
});
mcpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let body;
  try { body = mcpBody(); } catch (err) { toast(err.message); return; }
  try {
    const saved = mcpEditing ? await api('PUT', `api/mcp/${encodeURIComponent(mcpEditing.name)}`, body) : await api('POST', 'api/mcp', body);
    state.mcp = await api('GET', 'api/mcp');
    delete mcpChecks[saved.name];
    mcpDialog.close();
    toast(mcpEditing ? 'Server saved' : 'Server added');
    if (!$('settingsPage').hidden) renderSettings(settingsSection);
  } catch (err) { toast(err.message); }
});
$('mcpDelete').addEventListener('click', () => {
  if (!mcpEditing) return;
  showMenu($('mcpDelete'), [
    [`Delete ${mcpEditing.name}`, ICON.trash, async () => {
      try {
        await api('DELETE', `api/mcp/${encodeURIComponent(mcpEditing.name)}`);
        state.mcp = state.mcp.filter((m) => m.name !== mcpEditing.name);
        state.agents = await api('GET', 'api/agents'); // agents that used it no longer do
        mcpDialog.close();
        toast('Server deleted');
        if (!$('settingsPage').hidden) renderSettings(settingsSection);
      } catch (e) { toast(e.message); }
    }, 'danger'],
  ]);
  // The menu must sit above the modal dialog.
  mcpDialog.append(menuEl.m);
});

const mcpItems = (m) => [
  { id: 'x-' + m.name, label: `Edit ${m.name}`, detail: 'MCP server', keywords: ['mcp', 'server', m.name], meta: m.enabled ? 'On' : 'Off', icon: icon(ICON.server), run: () => openMCP(m) },
  { id: 'y-' + m.name, label: `${m.enabled ? 'Turn off' : 'Turn on'} ${m.name}`, detail: 'MCP server', keywords: ['mcp', 'toggle', m.name], icon: icon(ICON.server),
    run: async () => { await setMCPEnabled(m, !m.enabled); if (!$('settingsPage').hidden && settingsSection === 'mcp') renderSettings('mcp'); } },
];

// ---------- the signed-in person ----------
// api/me answers 200 with { username, name }, or 204 when nobody is known;
// then, or on any error, the sidebar shows no one. The card shows the
// person's generated face, the name, and the username under it when the
// two differ.
async function loadMe() {
  try {
    const res = await fetch('api/me');
    if (res.status !== 200) return;
    const p = await res.json();
    const name = p && (p.name || p.username);
    if (!name) return;
    // The same generated face as on the platform it runs behind, from the
    // username (stable) or the name.
    $('userAvatar').replaceChildren(beam(p.username || name));
    $('userName').textContent = name;
    const sub = p.username && p.username !== name ? p.username : '';
    $('userSub').textContent = sub;
    $('userSub').hidden = !sub;
    $('userCard').title = sub ? `${name} (${sub})` : name;
    $('userCard').hidden = false;
  } catch {}
}

// ---------- command palette ----------
const icon = (paths) => () => svg(paths);
const THEME_NAME = { system: 'System', light: 'Light', dark: 'Dark' };

function actionItems() {
  const side = sidebar();
  return [
    { id: 'a-new', label: 'New chat', icon: icon(ICON.newChat), meta: keyCaps(...(mac ? ['⌘', '⇧', 'O'] : ['Ctrl', 'Shift', 'O'])), run: () => startChat(null) },
    { id: 'a-agent', label: 'New agent', keywords: ['create agent'], icon: icon(ICON.plus), run: () => openAgent(null) },
    { id: 'a-mcp', label: 'Add MCP server', keywords: ['mcp', 'tools', 'connect server'], icon: icon(ICON.server), run: () => openMCP(null) },
    { id: 'a-settings', label: 'Settings', keywords: ['preferences', 'options'], icon: icon(ICON.settings), run: () => { location.hash = '#settings'; } },
    { id: 'a-plugins', label: 'Plugins', keywords: ['extensions', 'attachments', 'charts'], icon: icon(ICON.plug), run: () => { location.hash = '#settings/plugins'; } },
    { id: 'a-theme', label: 'Toggle theme', keywords: ['dark mode', 'light mode', 'appearance'], detail: `now ${THEME_NAME[store.get('theme', 'system')]}`, icon: icon(ICON.sun), run: cycleTheme },
    side === 'rail'
      ? { id: 'a-rail', label: 'Expand sidebar', keywords: ['collapse sidebar'], icon: icon(ICON.panelOpen), run: () => setSidebar('open') }
      : { id: 'a-rail', label: 'Collapse sidebar', keywords: ['icons', 'rail'], icon: icon(ICON.panelClose), run: () => setSidebar('rail') },
    side === 'hidden'
      ? { id: 'a-hide', label: 'Show sidebar', icon: icon(ICON.panelOpen), meta: keyCaps(...(mac ? ['⌘', 'B'] : ['Ctrl', 'B'])), run: () => setSidebar('open') }
      : { id: 'a-hide', label: 'Hide sidebar', icon: icon(ICON.panel), meta: keyCaps(...(mac ? ['⌘', 'B'] : ['Ctrl', 'B'])), run: () => setSidebar('hidden') },
  ];
}
const chatItem = (c) => {
  const agent = agentById(c.agentId);
  return { id: 'c-' + c.id, label: c.title || 'New chat', detail: agent ? agent.name : '', meta: c.pinned ? 'Pinned' : dayGroup(c.updatedAt), icon: icon(ICON.chat), run: () => { location.hash = '#c=' + c.id; } };
};
const agentItem = (a) => ({ id: 'g-' + a.id, label: a.name, detail: a.description || '', keywords: ['agent', 'chat with'], meta: 'Start a chat', icon: icon(ICON.agent), run: () => startChat(a) });
function settingItems() {
  return [
    { id: 's-appearance', label: 'Appearance', keywords: ['theme', 'font', 'text size', 'accent colour', 'color', 'sidebar'], icon: icon(ICON.swatch), run: () => { location.hash = '#settings/appearance'; } },
    { id: 's-plugins', label: 'Plugins settings', keywords: ['plugins'], icon: icon(ICON.plug), run: () => { location.hash = '#settings/plugins'; } },
    { id: 's-images', label: 'Image generation', keywords: ['image model', 'pictures', 'images'], icon: icon(ICON.image), run: () => { location.hash = '#settings/plugins'; setTimeout(() => { const b = $('imageModelBtn'); if (b) b.focus(); }); } },
    { id: 's-agents', label: 'Manage agents', keywords: ['agents', 'edit agent'], icon: icon(ICON.agent), run: () => { location.hash = '#agents'; } },
    { id: 's-mcp', label: 'MCP servers', keywords: ['mcp', 'servers', 'tools'], icon: icon(ICON.server), run: () => { location.hash = '#settings/mcp'; } },
    { id: 's-about', label: 'About Harf', keywords: ['version', 'shortcuts', 'workspace'], icon: icon(ICON.info), run: () => { location.hash = '#settings/about'; } },
  ];
}
const pluginItem = (p) => ({ id: 'p-' + p.id, label: `${p.enabled ? 'Turn off' : 'Turn on'} ${p.name}`, keywords: [p.name, 'plugin', 'toggle'], meta: p.enabled ? 'On' : 'Off', icon: icon(ICON.plug),
  run: async () => { await setPlugin(p, !p.enabled); if (!$('settingsPage').hidden && settingsSection === 'plugins') renderSettings('plugins'); } });

const modelItem = (m) => ({ id: 'm-' + m.id, label: m.name || m.id, detail: providerName(m.provider), keywords: [m.id, 'model', 'switch model'],
  meta: m.id === currentModel() ? 'In use' : 'Use for this chat', icon: () => modelLogo(m.id, m.name),
  run: () => { store.set('model', m.id); if (state.chat) patchChat(state.chat.id, { model: m.id }); else state.draftModel = m.id; renderModels(); } });

const palette = createPalette({
  dialog: $('palette'), input: $('palInput'), list: $('palList'),
  sources: () => [
    { heading: 'Actions', items: actionItems() },
    { heading: 'Chats', items: state.chats.map(chatItem) },
    { heading: 'Agents', items: state.agents.map(agentItem) },
    { heading: 'Settings', items: settingItems() },
    { heading: 'Plugins', items: state.plugins.map(pluginItem) },
    { heading: 'MCP servers', items: state.mcp.flatMap(mcpItems) },
    { heading: 'Models', items: state.models.map(modelItem) },
  ],
  idle: () => [
    { heading: 'Actions', items: actionItems().slice(0, 5) },
    { heading: 'Recent chats', items: state.chats.slice(0, 5).map(chatItem) },
    { heading: 'Agents', items: state.agents.slice(0, 5).map(agentItem) },
  ].filter((s) => s.items.length),
  // Nothing matches: offer to make an agent of that name.
  fallback: (q) => ({ heading: 'Agents', items: [{ id: 'g-new', label: `Create agent: ${q}`, icon: icon(ICON.plus), run: () => openAgent(null, { name: q }) }] }),
});

// ---------- export ----------
async function exportChat(id) {
  try {
    const c = await api('GET', `api/chats/${id}`);
    const agent = agentById(c.agentId);
    let md = `# ${c.title || 'Chat'}\n\n`;
    if (agent) md += `_Agent: ${agent.name}_\n\n`;
    for (const m of c.messages) {
      md += m.role === 'user' ? `**You**\n\n${m.content}\n\n` : `**${m.model || 'Assistant'}**\n\n${m.content}\n\n`;
    }
    const a = el('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: slug(c.title || 'chat') + '.md' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { toast(e.message); }
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chat';
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// ---------- theme ----------
// One key at the top right shows the current appearance and moves to the
// next on click.
const THEMES = ['system', 'light', 'dark'];
function renderTheme() {
  const t = store.get('theme', 'system');
  const b = $('themeBtn');
  b.replaceChildren(svg({ system: ICON.monitor, light: ICON.sun, dark: ICON.moon }[t]));
  b.setAttribute('aria-label', `Appearance: ${THEME_NAME[t]}`);
  b.title = `Appearance: ${THEME_NAME[t]}`;
}
function setTheme(t) {
  store.set('theme', t);
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  renderTheme();
  renderAgents(); renderChats(); renderThread();
}
const cycleTheme = () => setTheme(THEMES[(THEMES.indexOf(store.get('theme', 'system')) + 1) % THEMES.length]);
$('themeBtn').addEventListener('click', cycleTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderAgents(); renderChats(); renderThread(); });

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- start ----------
function applyConfig(cfg) {
  state.listed = true;
  // Image models make an image for each message; they are listed after
  // the chat models, under their own heading.
  const chat = cfg.models || [];
  state.models = [...chat, ...(cfg.imageModels || []).filter((m) => !chat.some((c) => c.id === m.id)).map((m) => ({ ...m, provider: `${m.provider} images` }))];
  state.imageModels = cfg.imageModels || [];
  state.imageModel = cfg.imageModel || '';
  state.defaultModel = cfg.defaultModel || '';
  state.workspace = cfg.workspace || '';
  state.maxUpload = cfg.maxUpload || 0;
  state.maxModelImage = cfg.maxModelImage || 0;
  state.version = cfg.version || '';
  if (state.version) { $('sideVersion').textContent = state.version; $('sideVersion').hidden = false; }
  if (cfg.warning) { $('warning').hidden = false; $('warning').textContent = 'Some models could not be listed: ' + cfg.warning; }
  const saved = store.get('model', '');
  if (!state.draftModel && hasModel(saved)) state.draftModel = saved;
  renderModels();
  renderAttach();
  if (state.chat && !state.streaming) renderThread();
}

async function boot() {
  renderTheme();
  renderSidebarControls();
  applyAppearance(loadAppearance());
  loadMe();
  input.value = store.get('draft', '');
  autosize(input);
  updateSend();
  // The model list can take a while to come from Pi: everything else
  // shows at once, and the models fill in when they arrive.
  // The plugin list waits on the same model list (image generation needs
  // an image model), so it fills in the same way.
  const config = api('GET', 'api/config');
  const plugins = api('GET', 'api/plugins');
  try {
    const [chats, agents, mcp] = await Promise.all([api('GET', 'api/chats'), api('GET', 'api/agents'), api('GET', 'api/mcp')]);
    state.mcp = mcp;
    state.chats = chats;
    state.agents = agents;
  } catch (e) {
    toast('Could not reach the server: ' + e.message);
  }
  config.then(applyConfig, (e) => toast('Could not list the models: ' + e.message));
  config.then(function later(cfg) {
    // Image models can come long after the chat models; fill them in, and
    // the image plugin's state, once Pi has listed them.
    if (!cfg.imagesLoading) return;
    setTimeout(async () => {
      try {
        const next = await api('GET', 'api/config');
        if (!next.imagesLoading) { applyConfig(next); setPlugins(await api('GET', 'api/plugins')); }
        later(next);
      } catch {}
    }, 3000);
  }, () => {});
  plugins.then((p) => { setPlugins(p); renderAttach(); if (state.chat && !state.streaming) renderThread(); }, (e) => toast('Could not list the plugins: ' + e.message));
  renderAttach();
  renderAgents();
  renderChats();
  await route();
  input.focus();
}
boot();
