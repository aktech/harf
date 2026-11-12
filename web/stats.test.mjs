import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statsSummary, statsDetail } from './stats.js';

test('a reply without usage shows no stats', () => {
  assert.deepEqual(statsSummary(undefined), []);
  assert.deepEqual(statsDetail(null), []);
});

test('the summary gives tokens, output speed and total time', () => {
  const u = { input: 1204, output: 356, calls: 1, firstMs: 900, ms: 8400, streamMs: 8000 };
  assert.deepEqual(statsSummary(u), ['1,204 in', '356 out', '45 tok/s', '8.4s']);
});

test('input counts the whole prompt, cached or not', () => {
  const u = { input: 23, output: 167, cacheRead: 21202, cacheWrite: 21322, calls: 2, ms: 3576 };
  assert.equal(statsSummary(u)[0], '42,547 in');
});

test('cost shows when Pi priced the reply', () => {
  const u = { input: 10, output: 20, cost: 0.01234, calls: 1, ms: 400 };
  assert.deepEqual(statsSummary(u), ['10 in', '20 out', '400ms', '$0.012']);
});

test('the detail lists cache, reasoning, calls and timing only when reported', () => {
  const u = { input: 2100, output: 100, reasoning: 15, cacheRead: 1400, cacheWrite: 50, cost: 0.015, calls: 2, firstMs: 1250, ms: 72000, streamMs: 4000 };
  assert.deepEqual(statsDetail(u), [
    ['Input', '3,550 tokens'],
    ['Not cached', '2,100 tokens'],
    ['Cache read', '1,400 tokens'],
    ['Cache write', '50 tokens'],
    ['Output', '100 tokens, 15 reasoning'],
    ['Cost', '$0.015'],
    ['Model calls', '2'],
    ['First token', '1.3s'],
    ['Total time', '1m 12s'],
    ['Output speed', '25 tok/s'],
  ]);
  assert.deepEqual(statsDetail({ input: 5, output: 1, calls: 1 }), [
    ['Input', '5 tokens'], ['Output', '1 token'], ['Model calls', '1'],
  ]);
});
