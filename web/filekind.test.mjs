import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind } from './filekind.js';

test('the MIME type decides the kind', () => {
  assert.equal(fileKind('application/pdf', 'a.bin'), 'text');
  assert.equal(fileKind('text/plain', 'notes'), 'text');
  assert.equal(fileKind('text/markdown', 'readme'), 'text');
  assert.equal(fileKind('text/x-markdown', 'readme'), 'text');
  assert.equal(fileKind('text/x-python', 'x'), 'code');
  assert.equal(fileKind('text/csv', 'x'), 'sheet');
  assert.equal(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x'), 'sheet');
  assert.equal(fileKind('image/png', 'x'), 'image');
  assert.equal(fileKind('application/json', 'x'), 'code');
  assert.equal(fileKind('text/javascript', 'x'), 'code');
  assert.equal(fileKind('application/zip', 'x'), 'archive');
  assert.equal(fileKind('application/gzip', 'x'), 'archive');
  assert.equal(fileKind('audio/mpeg', 'x'), 'audio');
  assert.equal(fileKind('video/mp4', 'x'), 'video');
});

test('the extension decides when the type is missing or generic', () => {
  assert.equal(fileKind('', 'Report.PDF'), 'text');
  assert.equal(fileKind('application/octet-stream', 'data.csv'), 'sheet');
  assert.equal(fileKind(undefined, 'book.xlsx'), 'sheet');
  assert.equal(fileKind('', 'main.go'), 'code');
  assert.equal(fileKind('', 'app.tsx'), 'code');
  assert.equal(fileKind('', 'site.tar.gz'), 'archive');
  assert.equal(fileKind('', 'song.flac'), 'audio');
  assert.equal(fileKind('', 'clip.mov'), 'video');
  assert.equal(fileKind('', 'photo.heic'), 'image');
  assert.equal(fileKind('', 'notes.md'), 'text');
});

test('anything else is a plain file', () => {
  assert.equal(fileKind('application/octet-stream', 'blob.bin'), 'file');
  assert.equal(fileKind('', 'Makefile'), 'file');
  assert.equal(fileKind(undefined, undefined), 'file');
});
