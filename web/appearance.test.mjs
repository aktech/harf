import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearanceVars, ACCENTS, choices, withDefaults } from './appearance.js';

test('the defaults change nothing: Geist, the normal size, the theme accent', () => {
  assert.deepEqual(appearanceVars({}), {});
  assert.deepEqual(appearanceVars({ font: 'geist', size: 'default', accent: 'default' }), {});
});

test('Google Sans is a choice', () => {
  assert.match(appearanceVars({ font: 'google' })['--font-sans'], /^'Google Sans',/);
});

test('the old default accent, cobalt, is still a choice', () => {
  const cobalt = ACCENTS.find((a) => a.id === 'cobalt');
  assert.equal(appearanceVars({ accent: 'cobalt' })['--accent-pick'], cobalt.color);
});

test('Fira Sans is a choice', () => {
  assert.match(appearanceVars({ font: 'fira' })['--font-sans'], /^'Fira Sans',/);
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
  assert.deepEqual(choices({ font: 'geist', size: 'default', accent: 'default' }), {});
  assert.deepEqual(choices({ font: 'fira', size: 'default', accent: '#12ab9f' }), { font: 'fira', accent: '#12ab9f' });
});

test('a sidebar font choice sets its own property and leaves the main font alone', () => {
  const v = appearanceVars({ font: 'geist', sideFont: 'urbanist' });
  assert.match(v['--font-side'], /^'Urbanist',/);
  assert.equal(v['--font-sans'], undefined);
  // Geist is the sidebar's default, so choosing it sets nothing; Google
  // Sans there is a choice like any other.
  assert.deepEqual(appearanceVars({ sideFont: 'geist' }), {});
  assert.match(appearanceVars({ sideFont: 'google' })['--font-side'], /^'Google Sans',/);
  assert.deepEqual(appearanceVars({ sideFont: 'comic' }), {});
});

test('a saved font with no sidebar font keeps the sidebar in that font', () => {
  assert.equal(withDefaults({ font: 'fira' }).sideFont, 'fira');
  assert.equal(withDefaults({ font: 'fira', sideFont: 'plex' }).sideFont, 'plex');
  assert.equal(withDefaults({}).sideFont, 'geist');
});
