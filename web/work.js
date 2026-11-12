// The card of steps a reply took between its texts: each step's time, and
// the card's header line saying how the work went.

// stepTime is a step's duration: tenths of a second, then minutes and
// seconds; '' when it took no measured time.
export function stepTime(ms) {
  if (!ms) return '';
  if (ms < 50) return '<0.1s';
  if (ms < 59950) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// workTime is the time steps took together: tenths under a second, then
// whole seconds.
function workTime(ms) {
  if (ms < 50) return '<0.1s';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// workSummary is the header of a card of steps, each { status, ms } where
// status is running, done, error or think (a thinking step, untimed).
export function workSummary(steps) {
  const n = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
  if (steps.some((s) => s.status === 'running')) return { state: 'running', text: `Working · ${n}` };
  const ms = steps.reduce((t, s) => t + (s.ms || 0), 0);
  const failed = steps.filter((s) => s.status === 'error').length;
  const head = ms ? `Worked for ${workTime(ms)}` : 'Thought';
  return { state: failed ? 'error' : 'done', text: [head, n, failed ? `${failed} failed` : ''].filter(Boolean).join(' · ') };
}

// plainPeek is the first line of thinking as plain words, without the
// Markdown marks the model wrote.
export function plainPeek(text) {
  const line = String(text || '').trim().split('\n')[0];
  return line
    .replace(/^#+\s*/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .trim();
}
