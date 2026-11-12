import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchReply } from './stream.js';

const sse = (...events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const ok = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

// watch runs watchReply with a clock that only moves when it waits, and
// records what it reported.
async function watch({ open, reopen, loadSaved = async () => {}, signal = new AbortController().signal }) {
  let clock = 0;
  const log = { events: [], restarts: 0, status: [], statusAt: [], waited: [] };
  const result = await watchReply({
    open, reopen, loadSaved, signal,
    onEvent: (e, d) => log.events.push([e, d]),
    onRestart: () => { log.restarts++; log.events = []; },
    onStatus: (s) => { log.status.push(s); log.statusAt.push(clock); },
    now: () => clock,
    sleep: async (ms) => { log.waited.push(ms); clock += ms; },
  });
  return { result, ...log };
}

test('a stream cut before its done event is reopened and replayed from the start', async () => {
  const got = await watch({
    open: async () => ok(sse(['part', { index: 0, delta: 'hel' }])),
    reopen: async () => ok(sse(['part', { index: 0, delta: 'hello' }], ['done', { id: 'm1' }])),
  });
  assert.equal(got.result, 'done');
  assert.equal(got.restarts, 1);
  assert.ok(!got.status.includes('reconnecting'), 'a cut that reconnects at once is not shown');
  assert.deepEqual(got.events, [['part', { index: 0, delta: 'hello' }], ['done', { id: 'm1' }]]);
});

test('while the server is unreachable it keeps trying, then shows the saved reply once the reply has ended', async () => {
  let tries = 0, saved = 0;
  const got = await watch({
    open: offline,
    reopen: () => (++tries < 3 ? offline() : Promise.resolve(new Response(null, { status: 204 }))),
    loadSaved: async () => { saved++; },
  });
  assert.equal(got.result, 'saved');
  assert.equal(saved, 1);
  assert.equal(got.status.at(-1), 'reconnecting');
  assert.ok(got.waited.length >= 3 && got.waited.every((ms, i) => i === 0 || ms >= got.waited[i - 1]), `waited ${got.waited}`);
});

test('after a minute without the server it says so, and keeps trying until it answers', async () => {
  let tries = 0;
  const got = await watch({
    open: offline,
    reopen: () => (++tries < 30 ? offline() : Promise.resolve(ok(sse(['done', { id: 'm1' }])))),
  });
  assert.equal(got.result, 'done');
  const first = got.status.indexOf('unreachable');
  assert.ok(first > 0, `status ${got.status}`);
  const at = got.statusAt[first];
  assert.ok(at >= 60000 && at < 70000, `said unreachable after ${at}ms`);
  assert.equal(got.status.at(-1), 'live');
});

test('a request the server refuses is an error with its reason', async () => {
  await assert.rejects(
    watch({ open: async () => Response.json({ error: 'message is empty' }, { status: 400 }), reopen: offline }),
    { message: 'message is empty' },
  );
});

test('a proxy that cannot reach the server is waited out like a dropped connection', async () => {
  let tries = 0;
  const got = await watch({
    open: async () => new Response('Bad Gateway', { status: 502 }),
    reopen: async () => (++tries < 2 ? new Response('', { status: 504 }) : ok(sse(['done', { id: 'm1' }]))),
  });
  assert.equal(got.result, 'done');
  assert.ok(got.status.includes('reconnecting'));
});

test('leaving the chat stops the watching, even while it waits to reconnect', async () => {
  const ctrl = new AbortController();
  let opens = 0;
  const got = await watch({
    open: () => { opens++; ctrl.abort(); return offline(); },
    reopen: () => { opens++; return offline(); },
    signal: ctrl.signal,
  });
  assert.equal(got.result, 'aborted');
  assert.equal(opens, 1);
});

test('an error event from the server ends the reply without reconnecting', async () => {
  const got = await watch({
    open: async () => ok(sse(['error', { error: 'disk full' }])),
    reopen: () => assert.fail('reopened'),
  });
  assert.equal(got.result, 'done');
  assert.deepEqual(got.events, [['error', { error: 'disk full' }]]);
});

test('a send the browser repeated after a cut follows the reply the first one started', async () => {
  const got = await watch({
    open: async () => Response.json({ error: 'this chat is still replying' }, { status: 409 }),
    reopen: async () => ok(sse(['part', { index: 0, delta: 'hi' }], ['done', { id: 'm1' }])),
  });
  assert.equal(got.result, 'done');
  assert.deepEqual(got.events.at(-1), ['done', { id: 'm1' }]);
});
