import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beamSVG, PALETTE } from './avatar.js';

// What boring-avatars 2.0.4 renders (React 19, renderToStaticMarkup) for
// <Avatar variant="beam" colors={PALETTE} size="100%" title name={...} />,
// React named the mask _R_0_.
const RENDERED = {
  "alice":
    "<svg viewBox=\"0 0 36 36\" fill=\"none\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"100%\" height=\"100%\"><title>alice</title><mask id=\"_R_0_\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"36\" height=\"36\"><rect width=\"36\" height=\"36\" rx=\"72\" fill=\"#FFFFFF\"></rect></mask><g mask=\"url(#_R_0_)\"><rect width=\"36\" height=\"36\" fill=\"#f4a261\"></rect><rect x=\"0\" y=\"0\" width=\"36\" height=\"36\" transform=\"translate(4 4) rotate(0 18 18) scale(1)\" fill=\"#264653\" rx=\"36\"></rect><g transform=\"translate(0 -6) rotate(0 18 18)\"><path d=\"M15 19c2 1 4 1 6 0\" stroke=\"#FFFFFF\" fill=\"none\" stroke-linecap=\"round\"></path><rect x=\"14\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#FFFFFF\"></rect><rect x=\"20\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#FFFFFF\"></rect></g></g></svg>",
  "Code reviewer":
    "<svg viewBox=\"0 0 36 36\" fill=\"none\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"100%\" height=\"100%\"><title>Code reviewer</title><mask id=\"_R_0_\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"36\" height=\"36\"><rect width=\"36\" height=\"36\" rx=\"72\" fill=\"#FFFFFF\"></rect></mask><g mask=\"url(#_R_0_)\"><rect width=\"36\" height=\"36\" fill=\"#e9c46a\"></rect><rect x=\"0\" y=\"0\" width=\"36\" height=\"36\" transform=\"translate(0 0) rotate(64 18 18) scale(1.1)\" fill=\"#e76f51\" rx=\"36\"></rect><g transform=\"translate(0 0) rotate(4 18 18)\"><path d=\"M15 20c2 1 4 1 6 0\" stroke=\"#000000\" fill=\"none\" stroke-linecap=\"round\"></path><rect x=\"10\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#000000\"></rect><rect x=\"24\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#000000\"></rect></g></g></svg>",
  "Data analyst":
    "<svg viewBox=\"0 0 36 36\" fill=\"none\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"100%\" height=\"100%\"><title>Data analyst</title><mask id=\"_R_0_\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"36\" height=\"36\"><rect width=\"36\" height=\"36\" rx=\"72\" fill=\"#FFFFFF\"></rect></mask><g mask=\"url(#_R_0_)\"><rect width=\"36\" height=\"36\" fill=\"#2a9d8f\"></rect><rect x=\"0\" y=\"0\" width=\"36\" height=\"36\" transform=\"translate(-4 8) rotate(308 18 18) scale(1.2)\" fill=\"#f4a261\" rx=\"36\"></rect><g transform=\"translate(-4 4) rotate(-8 18 18)\"><path d=\"M13,21 a1,0.75 0 0,0 10,0\" fill=\"#000000\"></path><rect x=\"11\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#000000\"></rect><rect x=\"23\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#000000\"></rect></g></g></svg>",
  "bob.example":
    "<svg viewBox=\"0 0 36 36\" fill=\"none\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"100%\" height=\"100%\"><title>bob.example</title><mask id=\"_R_0_\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"36\" height=\"36\"><rect width=\"36\" height=\"36\" rx=\"72\" fill=\"#FFFFFF\"></rect></mask><g mask=\"url(#_R_0_)\"><rect width=\"36\" height=\"36\" fill=\"#e9c46a\"></rect><rect x=\"0\" y=\"0\" width=\"36\" height=\"36\" transform=\"translate(-5 -5) rotate(89 18 18) scale(1.2)\" fill=\"#e76f51\" rx=\"36\"></rect><g transform=\"translate(-1 -3) rotate(-9 18 18)\"><path d=\"M15 21c2 1 4 1 6 0\" stroke=\"#000000\" fill=\"none\" stroke-linecap=\"round\"></path><rect x=\"10\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#000000\"></rect><rect x=\"24\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#000000\"></rect></g></g></svg>",
  "u-1":
    "<svg viewBox=\"0 0 36 36\" fill=\"none\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"100%\" height=\"100%\"><title>u-1</title><mask id=\"_R_0_\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"36\" height=\"36\"><rect width=\"36\" height=\"36\" rx=\"72\" fill=\"#FFFFFF\"></rect></mask><g mask=\"url(#_R_0_)\"><rect width=\"36\" height=\"36\" fill=\"#e76f51\"></rect><rect x=\"0\" y=\"0\" width=\"36\" height=\"36\" transform=\"translate(3 3) rotate(121 18 18) scale(1.1)\" fill=\"#2a9d8f\" rx=\"36\"></rect><g transform=\"translate(-1 -5) rotate(1 18 18)\"><path d=\"M15 20c2 1 4 1 6 0\" stroke=\"#FFFFFF\" fill=\"none\" stroke-linecap=\"round\"></path><rect x=\"13\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#FFFFFF\"></rect><rect x=\"21\" y=\"14\" width=\"1.5\" height=\"2\" rx=\"1\" stroke=\"none\" fill=\"#FFFFFF\"></rect></g></g></svg>",
};

test('the palette is the five design colours', () => {
  assert.deepEqual(PALETTE, ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51']);
});

test('a beam avatar is the same SVG boring-avatars draws for the same name', () => {
  for (const [name, svg] of Object.entries(RENDERED)) {
    assert.equal(beamSVG(name, { id: '_R_0_', title: true }), svg, name);
  }
});

test('names are escaped in the title', () => {
  assert.ok(beamSVG('<b>&"', { id: 'x', title: true }).includes('<title>&lt;b&gt;&amp;&quot;</title>'));
});
