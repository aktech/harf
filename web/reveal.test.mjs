import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealNext, shownText } from './reveal.js';

// run plays frames of dt ms and returns how many were shown after ms.
function run(shown, total, ms, dt = 16) {
  for (let t = 0; t < ms; t += dt) shown = revealNext(shown, total, dt);
  return shown;
}

test('a burst is shown a little at a time, not all at once', () => {
  const after1 = revealNext(0, 400, 16);
  assert.ok(after1 > 0 && after1 < 100, `first frame showed ${after1}`);
});

test('a big burst is caught up within about half a second', () => {
  assert.equal(run(0, 3000, 500), 3000);
  assert.equal(run(0, 40, 500), 40);
});

test('a few trailing characters still finish', () => {
  assert.equal(run(98, 100, 100), 100);
});

test('never shows more than arrived, and a long pause catches up at once', () => {
  assert.equal(revealNext(100, 100, 16), 100);
  assert.equal(revealNext(0, 500, 2000), 500);
});

test('a cut never splits a character made of two code units', () => {
  const s = 'ab😀c';
  assert.equal(shownText(s, 3), 'ab');
  assert.equal(shownText(s, 4), 'ab😀');
  assert.equal(shownText(s, 2), 'ab');
});
