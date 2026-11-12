import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTime, workSummary, plainPeek } from './work.js';

test('a step takes tenths of a second, then minutes and seconds', () => {
  assert.equal(stepTime(400), '0.4s');
  assert.equal(stepTime(11800), '11.8s');
  assert.equal(stepTime(30), '0.0s');
  assert.equal(stepTime(65000), '1m 5s');
  assert.equal(stepTime(0), '');
});

test('finished steps say how long they worked and how many there were', () => {
  const s = workSummary([{ status: 'done', ms: 400 }, { status: 'done', ms: 11800 }, { status: 'done', ms: 1800 }]);
  assert.deepEqual(s, { state: 'done', text: 'Worked for 14s · 3 steps' });
});

test('one step is a step, and work under a second still reads as time', () => {
  assert.equal(workSummary([{ status: 'done', ms: 300 }]).text, 'Worked for 0.3s · 1 step');
});

test('while a step runs the card says it is working', () => {
  const s = workSummary([{ status: 'done', ms: 400 }, { status: 'running' }]);
  assert.deepEqual(s, { state: 'running', text: 'Working · 2 steps' });
});

test('failed steps are counted', () => {
  const s = workSummary([{ status: 'done', ms: 1000 }, { status: 'error', ms: 1000 }]);
  assert.deepEqual(s, { state: 'error', text: 'Worked for 2s · 2 steps · 1 failed' });
});

test('thinking counts as a step without time', () => {
  const s = workSummary([{ status: 'think' }, { status: 'done', ms: 2000 }]);
  assert.equal(s.text, 'Worked for 2s · 2 steps');
  assert.equal(workSummary([{ status: 'think' }]).text, 'Thought · 1 step');
});

test('a thinking peek drops Markdown marks', () => {
  assert.equal(plainPeek('**Planning the chart**\nThen more'), 'Planning the chart');
  assert.equal(plainPeek('  ## A `code` _word_ and [a link](https://x.example)'), 'A code word and a link');
  assert.equal(plainPeek(''), '');
});
