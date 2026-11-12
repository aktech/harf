// The "beam" avatar of boring-avatars 2.0.4, ported from its React
// component to plain JavaScript: the same SVG for the same name and palette.
//
// boring-avatars: https://github.com/boringdesigners/boring-avatars
// MIT License
//
// Copyright (c) 2021 boringdesigners
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// The palette: mid-tone colours that read on both the light and the dark page.
export const PALETTE = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'];

const SIZE = 36;

function hashCode(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash &= hash;
  }
  return Math.abs(hash);
}
const digit = (n, d) => Math.floor((n / 10 ** d) % 10);
const even = (n, d) => !(digit(n, d) % 2);
function unit(n, range, d) {
  const v = n % range;
  return d && digit(n, d) % 2 === 0 ? -v : v;
}
const pick = (n, colors) => colors[n % colors.length];
function contrast(hex) {
  const h = hex.replace(/^#/, '');
  const y = (parseInt(h.slice(0, 2), 16) * 299 + parseInt(h.slice(2, 4), 16) * 587 + parseInt(h.slice(4, 6), 16) * 114) / 1000;
  return y >= 128 ? '#000000' : '#FFFFFF';
}

function beamData(name, colors) {
  const n = hashCode(name);
  const wrapperColor = pick(n, colors);
  const pre = unit(n, 10, 1);
  const tx = pre < 5 ? pre + SIZE / 9 : pre;
  const preY = unit(n, 10, 2);
  const ty = preY < 5 ? preY + SIZE / 9 : preY;
  return {
    wrapperColor,
    faceColor: contrast(wrapperColor),
    backgroundColor: pick(n + 13, colors),
    tx, ty,
    rotate: unit(n, 360),
    scale: 1 + unit(n, SIZE / 12) / 10,
    mouthOpen: even(n, 2),
    circle: even(n, 1),
    eyeSpread: unit(n, 5),
    mouthSpread: unit(n, 3),
    faceRotate: unit(n, 10, 3),
    faceX: tx > SIZE / 6 ? tx / 2 : unit(n, 8, 1),
    faceY: ty > SIZE / 6 ? ty / 2 : unit(n, 7, 2),
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// beamSVG is the avatar for name as SVG markup, the same React renders for
// boring-avatars' beam at size 100%. id names its mask, which must be
// unique in the page; title adds the name as the SVG's title.
export function beamSVG(name, { id, title = false, colors = PALETTE } = {}) {
  const d = beamData(String(name), colors);
  const S = SIZE;
  const mouth = d.mouthOpen
    ? `<path d="M15 ${19 + d.mouthSpread}c2 1 4 1 6 0" stroke="${d.faceColor}" fill="none" stroke-linecap="round"></path>`
    : `<path d="M13,${19 + d.mouthSpread} a1,0.75 0 0,0 10,0" fill="${d.faceColor}"></path>`;
  return `<svg viewBox="0 0 ${S} ${S}" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    (title ? `<title>${esc(name)}</title>` : '') +
    `<mask id="${esc(id)}" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="${S * 2}" fill="#FFFFFF"></rect></mask>` +
    `<g mask="url(#${esc(id)})"><rect width="${S}" height="${S}" fill="${d.backgroundColor}"></rect>` +
    `<rect x="0" y="0" width="${S}" height="${S}" transform="translate(${d.tx} ${d.ty}) rotate(${d.rotate} ${S / 2} ${S / 2}) scale(${d.scale})" fill="${d.wrapperColor}" rx="${d.circle ? S : S / 6}"></rect>` +
    `<g transform="translate(${d.faceX} ${d.faceY}) rotate(${d.faceRotate} ${S / 2} ${S / 2})">${mouth}` +
    `<rect x="${14 - d.eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${d.faceColor}"></rect>` +
    `<rect x="${20 + d.eyeSpread}" y="14" width="1.5" height="2" rx="1" stroke="none" fill="${d.faceColor}"></rect></g></g></svg>`;
}

let seq = 0;

// beam is the avatar as an element for the page, with a mask id of its own.
export function beam(name) {
  const t = document.createElement('template');
  t.innerHTML = beamSVG(name, { id: `beam-${++seq}` }); // markup built above, with the name escaped
  return t.content.firstChild;
}
