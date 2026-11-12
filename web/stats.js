// Stats for a finished reply, from the usage Harf saves with it: what
// Pi reported in tokens and cost, and how long the reply took.

const num = (n) => Math.round(n).toLocaleString('en-US');
const tokens = (n) => `${num(n)} ${n === 1 ? 'token' : 'tokens'}`;
const cost = (c) => `$${c.toFixed(3)}`;

function duration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 59950) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// prompt is every input token: Pi counts cached ones apart from input.
const prompt = (u) => u.input + (u.cacheRead || 0) + (u.cacheWrite || 0);

// speed is output tokens per second of streaming, or '' when unknown.
function speed(u) {
  if (!u.streamMs || !u.output) return '';
  const r = u.output / (u.streamMs / 1000);
  return `${r >= 10 ? Math.round(r) : r.toFixed(1)} tok/s`;
}

// statsSummary is the short line shown under a reply.
export function statsSummary(u) {
  if (!u) return [];
  return [`${num(prompt(u))} in`, `${num(u.output)} out`, speed(u), u.ms ? duration(u.ms) : '', u.cost ? cost(u.cost) : '']
    .filter(Boolean);
}

// statsDetail is every stat as [label, value], for the reply's popover.
export function statsDetail(u) {
  if (!u) return [];
  const rows = [['Input', tokens(prompt(u))]];
  if (u.cacheRead || u.cacheWrite) {
    rows.push(['Not cached', tokens(u.input)]);
    if (u.cacheRead) rows.push(['Cache read', tokens(u.cacheRead)]);
    if (u.cacheWrite) rows.push(['Cache write', tokens(u.cacheWrite)]);
  }
  rows.push(['Output', tokens(u.output) + (u.reasoning ? `, ${num(u.reasoning)} reasoning` : '')]);
  if (u.cost) rows.push(['Cost', cost(u.cost)]);
  if (u.calls) rows.push(['Model calls', String(u.calls)]);
  if (u.firstMs) rows.push(['First token', duration(u.firstMs)]);
  if (u.ms) rows.push(['Total time', duration(u.ms)]);
  if (speed(u)) rows.push(['Output speed', speed(u)]);
  return rows;
}
