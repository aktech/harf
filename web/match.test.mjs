import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match, rank } from './match.js';

const score = (t, q) => (match(t, q) || { score: 0 }).score;

test('a prefix beats a word start, which beats a match inside a word', () => {
  assert.ok(score('Settings', 'set') > score('Reset settings', 'set'));
  assert.ok(score('Reset settings', 'set') > score('Asset list', 'set'));
  assert.ok(score('Asset list', 'set') > 0);
});

test('word initials find a title, and unrelated text does not match', () => {
  assert.ok(match('New chat', 'nc'));
  assert.ok(match('Toggle theme', 'tog the'));
  assert.equal(match('New chat', 'xyz'), null);
  assert.equal(match('New chat', '   '), null);
});

test('case and accents are ignored, and the matched letters are given', () => {
  const m = match('Café notes', 'cafe');
  assert.ok(m);
  assert.deepEqual(m.ranges, [[0, 4]]);
  assert.deepEqual(match('Weekly report', 'rep').ranges, [[7, 10]]);
});

test('rank orders rows best first and sections by their best row', () => {
  const sections = [
    { heading: 'Chats', items: [{ id: 'c1', label: 'Theme ideas for the launch' }, { id: 'c2', label: 'Lunch' }] },
    { heading: 'Actions', items: [{ id: 'a1', label: 'Toggle theme' }, { id: 'a2', label: 'Theme' }] },
  ];
  const out = rank(sections, 'theme');
  assert.deepEqual(out.map((s) => s.heading), ['Actions', 'Chats']);
  assert.deepEqual(out[0].items.map((i) => i.id), ['a2', 'a1']);
  assert.deepEqual(out[1].items.map((i) => i.id), ['c1']);
});

test('a keyword finds a row, below rows whose title matches', () => {
  const sections = [{ heading: 'Settings', items: [
    { id: 's1', label: 'Appearance', keywords: ['font', 'theme'] },
    { id: 's2', label: 'Font size' },
  ] }];
  assert.deepEqual(rank(sections, 'font')[0].items.map((i) => i.id), ['s2', 's1']);
});

test('an empty query ranks nothing', () => {
  assert.deepEqual(rank([{ heading: 'A', items: [{ id: 'x', label: 'x' }] }], ''), []);
});
