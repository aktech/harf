// Appearance choices (font, sidebar font, text size, accent colour) and the custom
// properties that apply them. Defaults set nothing, so the theme's own
// tokens stand. theme.js applies the saved properties before first paint.

export const FONTS = [
  { id: 'geist', label: 'Geist', stack: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif" },
  { id: 'google', label: 'Google Sans', stack: "'Google Sans', -apple-system, BlinkMacSystemFont, sans-serif" },
  { id: 'fira', label: 'Fira Sans', stack: "'Fira Sans', -apple-system, BlinkMacSystemFont, sans-serif" },
  { id: 'urbanist', label: 'Urbanist', stack: "'Urbanist', -apple-system, BlinkMacSystemFont, sans-serif" },
  { id: 'plex', label: 'IBM Plex Sans', stack: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif" },
  { id: 'system', label: 'System', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
];

export const SIZES = [
  { id: 'small', label: 'Small', scale: '0.9355' },
  { id: 'default', label: 'Default', scale: '' },
  { id: 'large', label: 'Large', scale: '1.0645' },
  { id: 'larger', label: 'Larger', scale: '1.129' },
];

// Light-theme colours, each at least 4.5:1 on white; the dark theme lightens
// the chosen colour (style.css).
export const ACCENTS = [
  { id: 'default', label: 'Forest', color: '#3f6212' },
  { id: 'cobalt', label: 'Cobalt', color: '#3d63dd' },
  { id: 'ink', label: 'Ink', color: '#141414' },
  { id: 'violet', label: 'Violet', color: '#6e4fd8' },
  { id: 'teal', label: 'Teal', color: '#0b7a75' },
  { id: 'green', label: 'Green', color: '#1d7f45' },
  { id: 'amber', label: 'Amber', color: '#a25a00' },
  { id: 'rose', label: 'Rose', color: '#c22a5c' },
];

const HEX = /^#[0-9a-f]{6}$/i;

// accentColor is the colour an accent choice stands for, '' for the default.
function accentColor(accent) {
  if (!accent || accent === 'default') return '';
  const preset = ACCENTS.find((a) => a.id === accent);
  if (preset) return preset.color;
  return HEX.test(accent) ? accent.toLowerCase() : '';
}

// appearanceVars turns choices into custom properties; unknown or malformed
// values are left out, so they fall back to the defaults.
export function appearanceVars({ font, sideFont, size, accent } = {}) {
  const out = {};
  // The defaults are the stylesheet's own fonts, so they set nothing.
  const f = font !== DEFAULTS.font && FONTS.find((x) => x.id === font);
  if (f) out['--font-sans'] = f.stack;
  const sf = sideFont !== DEFAULTS.sideFont && FONTS.find((x) => x.id === sideFont);
  if (sf) out['--font-side'] = sf.stack;
  const s = SIZES.find((x) => x.id === size);
  if (s && s.scale) out['--fs-scale'] = s.scale;
  const c = accentColor(accent);
  if (c) out['--accent-pick'] = c;
  return out;
}

export const DEFAULTS = { font: 'geist', sideFont: 'geist', size: 'default', accent: 'default' };

// The custom properties appearanceVars can set; theme.js lists the same.
export const VARS = ['--font-sans', '--font-side', '--fs-scale', '--accent-pick'];

// choices are the settings someone changed from the defaults; only these
// are saved, so a later default still applies to everything left alone.
export function choices(prefs) {
  return Object.fromEntries(Object.entries(prefs).filter(([k, v]) => k in DEFAULTS && v !== DEFAULTS[k]));
}

// withDefaults fills in the choices not saved. The font once set the
// sidebar too, so a saved font with no sidebar font keeps the sidebar in it.
export function withDefaults(saved) {
  return { ...DEFAULTS, sideFont: saved.font || DEFAULTS.sideFont, ...saved };
}

export function loadAppearance() {
  try { return withDefaults(JSON.parse(localStorage.getItem('harf.look') || '{}')); } catch { return { ...DEFAULTS }; }
}

// applyAppearance sets the choices on the page now and saves them, with the
// properties theme.js applies on the next load.
export function applyAppearance(prefs) {
  const root = document.documentElement;
  const vars = appearanceVars(prefs);
  for (const k of VARS) {
    if (vars[k]) root.style.setProperty(k, vars[k]); else root.style.removeProperty(k);
  }
  if (vars['--accent-pick']) root.dataset.accent = ''; else delete root.dataset.accent;
  try {
    localStorage.setItem('harf.look', JSON.stringify(choices(prefs)));
    localStorage.setItem('harf.look-vars', JSON.stringify(vars));
  } catch {}
}
