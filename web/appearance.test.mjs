import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearanceVars, ACCENTS, choices, withDefaults } from './appearance.js';

test('the defaults change nothing: Fira Sans, IBM Plex Sans in the sidebar, the normal size, ink', () => {
  assert.deepEqual(appearanceVars({}), {});
  assert.deepEqual(appearanceVars({ font: 'fira', sideFont: 'plex', size: 'default', accent: 'default' }), {});
  assert.equal(ACCENTS.find((a) => a.id === 'default').label, 'Ink');
});

test('Geist and the forest green are choices', () => {
  assert.match(appearanceVars({ font: 'geist' })['--font-sans'], /^'Geist',/);
  assert.equal(appearanceVars({ accent: 'forest' })['--accent-pick'], ACCENTS.find((a) => a.id === 'forest').color);
});

test('Google Sans is a choice', () => {
  assert.match(appearanceVars({ font: 'google' })['--font-sans'], /^'Google Sans',/);
});

test('the old default accent, cobalt, is still a choice', () => {
  const cobalt = ACCENTS.find((a) => a.id === 'cobalt');
  assert.equal(appearanceVars({ accent: 'cobalt' })['--accent-pick'], cobalt.color);
});

test('Google Sans is a choice in the sidebar too', () => {
  assert.match(appearanceVars({ sideFont: 'google' })['--font-side'], /^'Google Sans',/);
});

test('a font and a size choice become custom properties', () => {
  const v = appearanceVars({ font: 'plex', size: 'large' });
  assert.match(v['--font-sans'], /^'IBM Plex Sans',/);
  assert.ok(Number(v['--fs-scale']) > 1);
  assert.match(appearanceVars({ font: 'system' })['--font-sans'], /^-apple-system,/);
});

test('a preset or a custom colour sets the accent', () => {
  const preset = ACCENTS.find((a) => a.id !== 'default');
  assert.equal(appearanceVars({ accent: preset.id })['--accent-pick'], preset.color);
  assert.equal(appearanceVars({ accent: '#12AB9f' })['--accent-pick'], '#12ab9f');
});

test('unknown or malformed values fall back to the defaults', () => {
  assert.deepEqual(appearanceVars({ font: 'comic', size: 'huge', accent: 'red;background:url(x)' }), {});
  assert.deepEqual(appearanceVars({ accent: '#12ab9' }), {});
});

test('only choices that differ from the defaults are kept, so a new default reaches everyone else', () => {
  assert.deepEqual(choices({ font: 'fira', sideFont: 'plex', size: 'default', accent: 'default' }), {});
  assert.deepEqual(choices({ font: 'geist', size: 'default', accent: '#12ab9f' }), { font: 'geist', accent: '#12ab9f' });
});

test('a sidebar font choice sets its own property and leaves the main font alone', () => {
  const v = appearanceVars({ font: 'fira', sideFont: 'urbanist' });
  assert.match(v['--font-side'], /^'Urbanist',/);
  assert.equal(v['--font-sans'], undefined);
  // IBM Plex Sans is the sidebar's default, so choosing it sets nothing.
  assert.deepEqual(appearanceVars({ sideFont: 'plex' }), {});
  assert.match(appearanceVars({ sideFont: 'geist' })['--font-side'], /^'Geist',/);
  assert.deepEqual(appearanceVars({ sideFont: 'comic' }), {});
});

test('a saved font with no sidebar font keeps the sidebar in that font', () => {
  assert.equal(withDefaults({ font: 'fira' }).sideFont, 'fira');
  assert.equal(withDefaults({ font: 'fira', sideFont: 'plex' }).sideFont, 'plex');
  assert.equal(withDefaults({}).sideFont, 'plex');
});
