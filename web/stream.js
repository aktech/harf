// watchReply follows a reply's server-sent events until the reply ends. A
// proxy or a network drop can cut the stream while the reply goes on in the
// server, so a cut stream is opened again (reopen), which replays the reply
// from its start: onRestart tells the page to clear what it showed. When the
// reply has ended meanwhile (204), loadSaved shows the saved copy. While the
// server cannot be reached it keeps trying, waiting longer each time, and
// tells onStatus it is 'reconnecting', or 'unreachable' once that has
// lasted unreachableAfter ms; 'live' when a stream answers again.
//
// It returns 'done' when the stream ended the reply, 'saved' after
// loadSaved and 'aborted' once signal is aborted (the page left the chat),
// and throws when the server refuses the request.
export async function watchReply({ open, reopen, loadSaved, onEvent, onRestart, onStatus = () => {}, signal, sleep = wait, now = Date.now, unreachableAfter = 60000 }) {
  let opener = open;
  let failures = 0;
  let since = null; // when the server stopped answering
  const retry = async () => {
    if (signal.aborted) return;
    since ??= now();
    // A first quick retry after a proxy cut usually works: say nothing yet.
    if (failures > 0) onStatus(now() - since >= unreachableAfter ? 'unreachable' : 'reconnecting');
    await sleep(backoff(failures++), signal);
  };
  for (let streams = 0; ; ) {
    if (signal.aborted) return 'aborted';
    let res;
    const first = opener === open;
    try {
      res = await opener(signal);
    } catch {
      await retry();
      continue;
    } finally {
      opener = reopen;
    }
    // After a cut the browser may send the message again, which the server
    // refuses while the first one's reply runs: follow that reply.
    if (first && res.status === 409) continue;
    if (res.status === 204) {
      try {
        await loadSaved();
        return 'saved';
      } catch {
        await retry();
        continue;
      }
    }
    if ([502, 503, 504].includes(res.status)) { // a proxy that cannot reach the server
      await retry();
      continue;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `${res.status} ${res.statusText}`);
    }
    failures = 0;
    since = null;
    onStatus('live');
    if (streams++ > 0) onRestart();
    let ended = false;
    try {
      await readEvents(res.body, (event, data) => {
        if (event === 'done' || event === 'error') ended = true;
        onEvent(event, data);
      });
    } catch {}
    if (ended) return 'done';
    await retry();
  }
}

// backoff is how long to wait before the try after n failed ones.
const backoff = (n) => Math.min(250 * 2 ** n, 5000);

// wait ends after ms, or sooner when the browser comes back online or the
// watching is aborted.
const wait = (ms, signal) => new Promise((r) => {
  const end = () => {
    clearTimeout(t);
    globalThis.removeEventListener?.('online', end);
    signal?.removeEventListener('abort', end);
    r();
  };
  const t = setTimeout(end, ms);
  globalThis.addEventListener?.('online', end);
  signal?.addEventListener('abort', end);
});

// readEvents calls onEvent with each event of a server-sent event stream.
// Comment lines, such as the server's pings, are skipped.
async function readEvents(stream, onEvent) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}
