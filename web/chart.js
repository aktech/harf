// Charts for the Charts plugin: a small JSON spec drawn as SVG in the app's
// own colours (the series and text colours are CSS classes, so a theme
// change recolours every chart). Every piece of text from the spec is
// escaped, and only numbers this file computed reach an attribute.
//
//   {"type": "line" | "bar" | "scatter", "title": "...",
//    "x": {"label": "..."}, "y": {"label": "..."},
//    "labels": ["Jan", "Feb"],                       // line and bar
//    "series": [{"name": "North", "data": [12, 19]}]} // or [[x, y], ...]

import { esc } from './md.js';

const MAX_SERIES = 8; // the palette's colours; a 9th would repeat one
const MAX_POINTS = 5000;
const MAX_VALUE = 1e15;

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const num = (v) => fmt.format(v);
const r1 = (v) => Math.round(v * 10) / 10;
const text = (v) => esc(String(v ?? ''));

// check turns a spec into series of [x, y] points, or throws why it cannot.
function check(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('a chart is one JSON object');
  const type = spec.type;
  if (!['line', 'bar', 'scatter'].includes(type)) throw new Error('type must be line, bar or scatter');
  const series = spec.series;
  if (!Array.isArray(series) || !series.length) throw new Error('series must list at least one series');
  if (series.length > MAX_SERIES) throw new Error(`a chart can show at most ${MAX_SERIES} series`);
  const labels = Array.isArray(spec.labels) ? spec.labels.map((l) => String(l ?? '')) : null;
  let points = 0;
  const out = series.map((s, i) => {
    const data = s && Array.isArray(s.data) ? s.data : null;
    if (!data) throw new Error(`series ${i + 1} needs data`);
    points += data.length;
    if (points > MAX_POINTS) throw new Error(`a chart can show at most ${MAX_POINTS} points`);
    const pairs = data.length > 0 && data.every((d) => Array.isArray(d));
    if (type === 'scatter' && !pairs) throw new Error('scatter data must be [x, y] pairs');
    if (!pairs) {
      if (!labels) throw new Error('give labels for the data, or data as [x, y] pairs');
      if (data.length !== labels.length) throw new Error(`series ${i + 1} has ${data.length} values for ${labels.length} labels`);
    }
    if (pairs && type === 'bar') throw new Error('bar data must be one number per label');
    const pts = pairs ? data.map((d) => [finite(d[0]), finite(d[1])]) : data.map((d, j) => [j, finite(d)]);
    return { name: String(s.name ?? `Series ${i + 1}`), pts };
  });
  const categorical = out.every((s) => s.pts.length && !Array.isArray(series[0].data[0]));
  return { type, labels: categorical ? labels : null, series: out };
}

function finite(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('every value must be a number');
  if (Math.abs(v) > MAX_VALUE) throw new Error('a value is too large to draw');
  return v;
}

// ticks picks about n round numbers covering lo..hi.
function ticks(lo, hi, n) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

// renderChart returns the chart as an HTML figure, or throws why it cannot
// be drawn. width is the drawing's width in CSS pixels.
export function renderChart(spec, { width = 640 } = {}) {
  const c = check(spec);
  const W = Math.max(280, Math.min(960, Math.round(width)));
  const H = Math.round(Math.max(220, Math.min(360, W * 0.56)));
  const xLabel = spec.x && spec.x.label, yLabel = spec.y && spec.y.label;
  const m = { top: 14, right: 16, bottom: xLabel ? 52 : 34, left: yLabel ? 70 : 52 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;

  const ys = c.series.flatMap((s) => s.pts.map((p) => p[1]));
  let ylo = Math.min(...ys), yhi = Math.max(...ys);
  if (c.type === 'bar') { ylo = Math.min(0, ylo); yhi = Math.max(0, yhi); }
  const yt = ticks(ylo, yhi, Math.max(3, Math.round(ph / 56)));
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const Y = (v) => r1(m.top + ph - ((v - y0) / (y1 - y0)) * ph);

  const g = [];
  for (const t of yt) {
    g.push(`<line class="grid" x1="${m.left}" x2="${m.left + pw}" y1="${Y(t)}" y2="${Y(t)}"/>`);
    g.push(`<text class="tick" x="${m.left - 8}" y="${Y(t)}" text-anchor="end" dominant-baseline="middle">${text(num(t))}</text>`);
  }

  let X, band = 0, xTicks = [];
  if (c.labels) {
    const n = c.labels.length;
    if (c.type === 'bar') {
      band = pw / n;
      X = (i) => r1(m.left + band * (i + 0.5));
    } else {
      X = (i) => r1(m.left + (n === 1 ? pw / 2 : (pw * i) / (n - 1)));
    }
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 64))));
    xTicks = c.labels.map((l, i) => [i, l]).filter(([i]) => i % every === 0);
  } else {
    const xs = c.series.flatMap((s) => s.pts.map((p) => p[0]));
    const xt = ticks(Math.min(...xs), Math.max(...xs), Math.max(3, Math.round(pw / 90)));
    const x0 = xt[0], x1 = xt[xt.length - 1];
    X = (v) => r1(m.left + ((v - x0) / (x1 - x0)) * pw);
    xTicks = xt.map((t) => [t, num(t)]);
  }
  for (const [v, l] of xTicks) {
    g.push(`<text class="tick" x="${X(v)}" y="${m.top + ph + 18}" text-anchor="middle">${text(l)}</text>`);
  }
  g.push(`<line class="axis" x1="${m.left}" x2="${m.left + pw}" y1="${Y(Math.max(y0, Math.min(0, y1)))}" y2="${Y(Math.max(y0, Math.min(0, y1)))}"/>`);
  if (xLabel) g.push(`<text class="axis-label" x="${m.left + pw / 2}" y="${H - 10}" text-anchor="middle">${text(xLabel)}</text>`);
  if (yLabel) g.push(`<text class="axis-label" transform="translate(16 ${m.top + ph / 2}) rotate(-90)" text-anchor="middle">${text(yLabel)}</text>`);

  const at = (s, p) => c.labels ? `${s.name}, ${c.labels[p[0]]}: ${num(p[1])}` : `${s.name}: ${num(p[0])}, ${num(p[1])}`;
  const marks = [];
  c.series.forEach((s, si) => {
    const cls = `s${si + 1}`;
    if (c.type === 'bar') {
      const gap = 2, inner = Math.max(2, band * 0.72);
      const bw = Math.max(1, (inner - gap * (c.series.length - 1)) / c.series.length);
      for (const p of s.pts) {
        const x = r1(X(p[0]) - inner / 2 + si * (bw + gap));
        const top = Y(Math.max(0, p[1])), bot = Y(Math.min(0, p[1]));
        marks.push(`<rect class="bar ${cls}" x="${x}" y="${top}" width="${r1(bw)}" height="${r1(Math.max(1, bot - top))}" rx="${Math.min(3, r1(bw / 2))}"><title>${text(at(s, p))}</title></rect>`);
      }
      return;
    }
    if (c.type === 'line') {
      const pts = c.labels ? s.pts : [...s.pts].sort((a, b) => a[0] - b[0]);
      marks.push(`<path class="line ${cls}" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])} ${Y(p[1])}`).join('')}"/>`);
      if (pts.length > 40) return;
    }
    const r = c.type === 'scatter' ? 4.5 : 4;
    for (const p of s.pts) marks.push(`<circle class="dot ${cls}" cx="${X(p[0])}" cy="${Y(p[1])}" r="${r}"><title>${text(at(s, p))}</title></circle>`);
  });

  const legend = c.series.length > 1
    ? `<ul class="chart-legend">${c.series.map((s, i) => `<li><i class="s${i + 1}"></i>${text(s.name)}</li>`).join('')}</ul>`
    : '';
  const title = spec.title ? `<figcaption>${text(spec.title)}</figcaption>` : '';
  const label = text(spec.title || `${c.type} chart`);
  return `<figure class="chart">${title}${legend}` +
    `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${g.join('')}${marks.join('')}</svg>` +
    table(c) + '</figure>';
}

// table lists the values, for reading exact numbers and for screen readers.
function table(c) {
  const head = c.labels
    ? `<tr><th></th>${c.series.map((s) => `<th>${text(s.name)}</th>`).join('')}</tr>`
    : '<tr><th>Series</th><th>x</th><th>y</th></tr>';
  const rows = c.labels
    ? c.labels.map((l, i) => `<tr><th>${text(l)}</th>${c.series.map((s) => `<td>${text(num(s.pts[i][1]))}</td>`).join('')}</tr>`)
    : c.series.flatMap((s) => s.pts.map((p) => `<tr><th>${text(s.name)}</th><td>${text(num(p[0]))}</td><td>${text(num(p[1]))}</td></tr>`));
  return `<details class="chart-data"><summary>Data</summary><div class="table"><table><thead>${head}</thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}
