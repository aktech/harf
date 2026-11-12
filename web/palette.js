import { rank } from './match.js';

// createPalette drives the command palette: a modal dialog with one search
// box over grouped results. sources() gives every section that can be
// searched; idle() gives what shows before anything is typed; fallback(q)
// may give a section to offer when nothing matches. An item is
// { id, label, detail?, meta?, icon?, keywords?, run }.
//
// The box is a combobox over a listbox: the arrow keys move the highlight
// (aria-activedescendant), Enter runs it, Escape closes, and focus stays in
// the box (the dialog is modal) until it closes and returns where it was.
export function createPalette({ dialog, input, list, sources, idle, fallback }) {
  let rows = [];
  let at = 0;
  let before = null;

  const optId = (i) => `pal-opt-${i}`;

  function marked(item) {
    const span = document.createElement('span');
    span.className = 'pal-title';
    const text = item.label;
    let from = 0;
    for (const [a, b] of item.ranges || []) {
      if (a > from) span.append(text.slice(from, a));
      const m = document.createElement('mark');
      m.textContent = text.slice(a, b);
      span.append(m);
      from = b;
    }
    span.append(text.slice(from));
    return span;
  }

  function render() {
    const q = input.value.trim();
    let sections = q ? rank(sources(), q) : idle();
    if (q && !sections.length && fallback) sections = [fallback(q)];
    rows = [];
    list.replaceChildren();
    if (!sections.length) {
      const empty = document.createElement('div');
      empty.className = 'pal-empty';
      const b = document.createElement('b');
      b.textContent = `No matches for “${q}”`;
      const hint = document.createElement('span');
      hint.textContent = 'Try a chat title, an agent, or a word such as theme, plugins or model.';
      empty.append(b, hint);
      list.append(empty);
    }
    sections.forEach((s, si) => {
      const group = document.createElement('div');
      group.className = 'pal-group';
      group.setAttribute('role', 'group');
      const head = document.createElement('div');
      head.className = 'pal-heading';
      head.id = `pal-sec-${si}`;
      head.textContent = s.heading;
      group.setAttribute('aria-labelledby', head.id);
      group.append(head);
      for (const item of s.items) {
        const i = rows.length;
        const opt = document.createElement('div');
        opt.className = 'pal-item';
        opt.id = optId(i);
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', 'false');
        const icon = document.createElement('span');
        icon.className = 'pal-icon';
        icon.setAttribute('aria-hidden', 'true');
        if (item.icon) icon.append(item.icon());
        const label = document.createElement('span');
        label.className = 'pal-label';
        label.append(marked(item));
        if (item.detail) {
          const d = document.createElement('span');
          d.className = 'pal-detail';
          d.textContent = item.detail;
          label.append(d);
        }
        opt.append(icon, label);
        if (item.meta) {
          const m = document.createElement('span');
          m.className = 'pal-meta';
          m.append(item.meta);
          opt.append(m);
        }
        opt.addEventListener('pointermove', () => { if (at !== i) highlight(i, false); });
        opt.addEventListener('click', () => run(i));
        group.append(opt);
        rows.push({ item, node: opt });
      }
      list.append(group);
    });
    highlight(0, true);
  }

  function highlight(i, scroll) {
    if (rows[at]) { rows[at].node.classList.remove('on'); rows[at].node.setAttribute('aria-selected', 'false'); }
    at = i;
    const r = rows[at];
    if (!r) { input.removeAttribute('aria-activedescendant'); return; }
    r.node.classList.add('on');
    r.node.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', r.node.id);
    if (scroll) r.node.scrollIntoView({ block: 'nearest' });
  }

  function run(i) {
    const r = rows[i];
    if (!r) return;
    close(false);
    r.item.run();
  }

  function open() {
    if (dialog.open) { input.select(); return; }
    before = document.activeElement;
    input.value = '';
    render();
    dialog.showModal();
    input.focus();
  }

  // close hides the palette; focus goes back to where it was unless the
  // item that ran moves it on.
  function close(restore = true) {
    if (!dialog.open) return;
    dialog.close();
    if (restore && before && before.isConnected && before !== document.body) before.focus();
  }

  input.addEventListener('input', render);
  dialog.addEventListener('keydown', (e) => {
    const n = rows.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); highlight((at + 1) % n, true); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); highlight((at - 1 + n) % n, true); }
    else if (e.key === 'Home' && n && e.ctrlKey) { e.preventDefault(); highlight(0, true); }
    else if (e.key === 'End' && n && e.ctrlKey) { e.preventDefault(); highlight(n - 1, true); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(at); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); } // the box is the one stop
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // A click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

  return { open, close, isOpen: () => dialog.open };
}
