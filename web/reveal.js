// revealNext is how many characters of a streamed text to show after a
// frame of dt ms, given shown already and total arrived. Text arrives in
// bursts; showing it a little per frame reads as smooth typing. The step
// is a share of what is waiting plus a floor, so a big burst eases out
// within about half a second and the last few characters do not linger.
const TAU = 90; // ms; the share of the backlog shown per ms
const FLOOR = 240; // characters per second, at the least

export function revealNext(shown, total, dt) {
  const behind = total - shown;
  if (behind <= 0) return total;
  const step = behind * Math.min(1, dt / TAU) + (FLOOR * dt) / 1000;
  return Math.min(total, shown + Math.max(1, Math.ceil(step)));
}

// shownText is the first n code units of text, one fewer when the cut
// would split a character made of two.
export function shownText(text, n) {
  const c = text.charCodeAt(n - 1);
  return text.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
}
