import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChart } from './chart.js';

const count = (s, re) => (s.match(re) || []).length;

test('a line chart draws one line per series with its title, axes and legend', () => {
  const out = renderChart({
    type: 'line', title: 'Monthly sales', x: { label: 'Month' }, y: { label: 'Units' },
    labels: ['Jan', 'Feb', 'Mar'],
    series: [{ name: 'North', data: [12, 19, 15] }, { name: 'South', data: [8, 11, 14] }],
  });
  assert.equal(count(out, /<path class="line s\d"/g), 2, out);
  for (const t of ['Monthly sales', 'Month', 'Units', 'North', 'South', 'Jan', 'Mar']) assert.ok(out.includes(`>${t}<`), t);
  assert.ok(out.startsWith('<figure class="chart"'), out);
});

test('a bar chart draws a bar for every label in every series', () => {
  const out = renderChart({ type: 'bar', labels: ['a', 'b', 'c'], series: [{ name: 'x', data: [1, 2, 3] }, { name: 'y', data: [3, 0, -1] }] });
  assert.equal(count(out, /<rect class="bar s\d"/g), 6, out);
});

test('a scatter chart draws a dot for every point', () => {
  const out = renderChart({ type: 'scatter', series: [{ name: 'p', data: [[1, 2], [3, 4], [5, 1.5]] }] });
  assert.equal(count(out, /<circle class="dot s1"/g), 3, out);
});

test('a line over numeric x takes [x, y] pairs', () => {
  const out = renderChart({ type: 'line', series: [{ name: 'p', data: [[0, 1], [10, 3]] }] });
  assert.equal(count(out, /<path class="line s1"/g), 1, out);
});

test('one series needs no legend', () => {
  const out = renderChart({ type: 'bar', labels: ['a'], series: [{ name: 'only', data: [1] }] });
  assert.ok(!out.includes('chart-legend'), out);
});

test('every hover title and the data table give the values', () => {
  const out = renderChart({ type: 'bar', labels: ['Jan'], series: [{ name: 'North', data: [1234.5] }] });
  assert.ok(out.includes('<title>North, Jan: 1,234.5</title>'), out);
  assert.match(out, /<table>.*<td>1,234.5<\/td>/s);
});

test('text from the spec is escaped everywhere', () => {
  const evil = '"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const out = renderChart({
    type: 'bar', title: evil, x: { label: evil }, y: { label: evil }, labels: [evil, 'b'],
    series: [{ name: evil, data: [1, 2] }, { name: 'two', data: [2, 1] }],
  });
  assert.ok(!out.includes('<img'), out);
  assert.ok(!out.includes('<script'), out);
  const tags = new Set([...out.matchAll(/<(\w+)/g)].map((t) => t[1]));
  const drawn = 'figure figcaption ul li i svg line text rect title details summary div table thead tbody tr th td'.split(' ');
  assert.deepEqual([...tags].filter((t) => !drawn.includes(t)), []);
  const attrs = [...out.matchAll(/\s([\w-]+)="/g)].map((a) => a[1]);
  assert.deepEqual([...new Set(attrs)].filter((a) => !['class', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'rx', 'viewBox', 'role', 'aria-label', 'text-anchor', 'dominant-baseline', 'transform'].includes(a)), []);
  assert.ok(out.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), out);
});

test('only finite numbers reach the drawing', () => {
  const out = renderChart({ type: 'line', labels: ['a', 'b', 'c'], series: [{ name: 's', data: [5, 5, 5] }] });
  assert.ok(!/NaN|Infinity/.test(out), out);
  assert.throws(() => renderChart({ type: 'line', labels: ['a', 'b'], series: [{ data: [1e308, -1e308] }] }), /too large/);
});

test('a spec that cannot be drawn says why', () => {
  const bad = [
    [{ type: 'pie', series: [{ data: [1] }] }, /type/],
    [{ type: 'line', series: [] }, /series/],
    [{ type: 'bar', labels: ['a', 'b'], series: [{ data: [1] }] }, /labels/],
    [{ type: 'bar', labels: ['a'], series: [{ data: ['1; drop'] }] }, /number/],
    [{ type: 'scatter', series: [{ data: [1, 2] }] }, /\[x, y\]/],
    [{ type: 'line', labels: ['a'], series: Array.from({ length: 9 }, () => ({ data: [1] })) }, /8 series/],
    [{ type: 'scatter', series: [{ data: Array.from({ length: 5001 }, (_, i) => [i, i]) }] }, /points/],
    ['not an object', /object/],
  ];
  for (const [spec, why] of bad) assert.throws(() => renderChart(spec), why, JSON.stringify(spec).slice(0, 80));
});
