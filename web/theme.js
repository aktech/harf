// Set the theme, the appearance choices and the sidebar before the first
// paint so the page never flashes.
try {
  const r = document.documentElement;
  const t = localStorage.getItem('harf.theme');
  if (t && t !== 'system') r.dataset.theme = t;
  const vars = JSON.parse(localStorage.getItem('harf.look-vars') || '{}');
  for (const k of ['--font-sans', '--font-side', '--fs-scale', '--accent-pick']) if (typeof vars[k] === 'string') r.style.setProperty(k, vars[k]);
  if (vars['--accent-pick']) r.dataset.accent = '';
  const side = localStorage.getItem('harf.sidebar');
  if (side === 'rail' || side === 'hidden') r.dataset.sidebar = side;
} catch {}
