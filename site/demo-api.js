// A pretend Harf server for the landing page's demo. The demo is Harf's own
// page (web/, copied by build.sh); this file, loaded before app.js, answers
// its calls to api/ in the browser. Replies are scripted and streamed as the
// same server-sent events the real server sends, so the page shows them
// exactly as it shows a real reply. Nothing leaves the browser.
(() => {
  const now = () => new Date().toISOString();
  const id = () => Math.random().toString(16).slice(2, 18).padEnd(16, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const WORKSPACE = '/home/user/workspace';

  const MODELS = [
    ['anthropic/claude-fable-5.2', 'Anthropic: Claude Fable 5.2'],
    ['anthropic/claude-opus-5.5', 'Anthropic: Claude Opus 5.5'],
    ['anthropic/claude-sonnet-5.5', 'Anthropic: Claude Sonnet 5.5'],
    ['openai/gpt-6-astra', 'OpenAI: GPT-6 Astra'],
    ['openai/gpt-6.1-sol', 'OpenAI: GPT-6.1 Sol'],
    ['google/gemini-4-carbon', 'Google: Gemini 4 Carbon'],
    ['google/gemini-4-argon', 'Google: Gemini 4 Argon'],
    ['x-ai/grok-4.7', 'xAI: Grok 4.7'],
    ['qwen/qwen3.8-max-0902', 'Qwen: Qwen3.8 Max'],
    ['z-ai/glm-5.3', 'Z.ai: GLM 5.3'],
    ['moonshotai/kimi-k3.1-pro', 'MoonshotAI: Kimi K3.1 Pro'],
    ['deepseek/deepseek-v4.1-flash', 'DeepSeek: DeepSeek V4.1 Flash'],
    ['mistralai/mistral-large-4-0', 'Mistral: Mistral Large 4'],
    ['meta/muse-wonder', 'Meta: Muse Wonder'],
    ['minimax/minimax-m3.1-flash', 'MiniMax: MiniMax M3.1 Flash'],
  ].map(([mid, name]) => ({ id: `openrouter/${mid}`, name, provider: 'openrouter', reasoning: true, images: true }));
  const modelName = (m) => (MODELS.find((x) => x.id === m) || { name: m }).name.replace(/^[^:]*: /, '');

  const PLUGINS = [
    { id: 'attachments', name: 'Attachments', description: 'Attach files and images to a message. Files are saved in the workspace under uploads.', web: ['attach'], enabled: true },
    { id: 'workspace', name: 'Workspace images', description: 'Show images from the workspace in replies, and under the step that wrote them.', web: ['workspace-images'], enabled: true },
    { id: 'charts', name: 'Charts and drawings', description: 'Draw line, bar and scatter charts from a small JSON block, and show SVG drawings.', web: ['chart', 'svg'], enabled: true },
    { id: 'web-pages', name: 'Web pages', description: 'Show HTML pages Pi writes, such as interactive charts and diagrams, in replies.', web: ['web-pages'], enabled: true },
    { id: 'images', name: 'Image generation', description: 'Make pictures with an image model, such as FLUX or Gemini image models on OpenRouter.', web: [], enabled: false },
    { id: 'agent-builder', name: 'Agent builder', description: 'Create and change agents by asking in any chat, such as: make me an agent that reviews pull requests.', web: ['agent-card'], enabled: true },
  ];

  let agents = [{
    id: 'a1', name: 'Data analyst', description: 'Answers questions about CSV files in the workspace, with charts.',
    systemPrompt: 'You answer questions about the CSV files in the workspace. Show numbers as a chart when it helps.',
    model: 'openrouter/google/gemini-4-carbon', tools: [], mcp: [], createdAt: now(), updatedAt: now(),
  }];

  // ---------- scripted replies ----------
  const tool = (name, args, output, ms) => ({ name, args, output, ms });
  const POP = { type: 'bar', title: 'Population, 2024 (millions)', y: { label: 'Millions' },
    labels: ['India', 'China', 'United States', 'Indonesia', 'Pakistan', 'Nigeria', 'Brazil', 'Bangladesh', 'Russia', 'Ethiopia'],
    series: [{ name: 'Population', data: [1451, 1419, 345, 284, 251, 233, 212, 174, 145, 132] }] };
  const PRIMES = 'primes = []\nn = 2\nwhile len(primes) < 20:\n    if all(n % p for p in primes if p * p <= n):\n        primes.append(n)\n    n += 1\nprint(primes)\n';
  const PACKING = '# Packing list: three day hike\n\n## Wear\n- Hiking boots, broken in\n- Wool socks, three pairs\n- Rain jacket\n\n## Carry\n- Backpack, 40 to 50 litres\n- Tent, sleeping bag and mat\n- Stove, fuel and a lighter\n- Water filter and two bottles\n- Map, compass and a head torch\n\n## Food\n- Three breakfasts, lunches and dinners\n- Snacks: nuts, dried fruit, bars\n\n## Safety\n- First aid kit\n- Sun cream and a hat\n- Whistle\n';
  const SCRIPTS = [
    { match: /populous|population|largest countries/i, title: 'Most Populous Countries',
      thinking: 'A bar chart of the ten largest countries, from the UN estimates.',
      text: 'Here are the ten most populous countries:\n\n```chart\n' + JSON.stringify(POP) + '\n```\n\nThe numbers are the UN World Population Prospects 2024 estimates for mid-2024.' },
    { match: /prime/i, title: 'First 20 Prime Numbers',
      thinking: 'Write the script, run it, show the output.',
      tools: [tool('write', { path: `${WORKSPACE}/primes.py`, content: PRIMES }, 'Wrote 158 bytes to primes.py', 40),
        tool('bash', { command: 'python3 primes.py' }, '[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71]', 61)],
      text: 'I wrote `primes.py` and ran it. The first 20 primes are:\n\n```\n[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71]\n```\n\nThe script checks each number against the primes found so far, up to its square root.' },
    { match: /packing|file/i, title: 'Hiking Packing List',
      thinking: 'Make the file, then show it.',
      tools: [tool('write', { path: `${WORKSPACE}/packing-list.md`, content: PACKING }, 'Wrote 431 bytes to packing-list.md', 35)],
      text: 'I created `packing-list.md` in the workspace:\n\n' + PACKING.replace(/^# .*\n\n/, '') + '\nTell me the season and I can add what the weather needs.' },
    { match: /interest|formula/i, title: 'Compound Interest Explained',
      thinking: 'Two paragraphs, the formula, then the worked example.',
      text: 'Compound interest is interest on interest. Each year the interest is added to what you have, so the next year earns interest on a bigger amount, and the growth speeds up over time.\n\nThe amount after $n$ years at a yearly rate $r$ is\n\n$$A = P(1 + r)^n$$\n\nwhere $P$ is what you start with. For 1,000 at 5% for 10 years: $A = 1000 \\times 1.05^{10} \\approx 1628.89$, so it grows by about 629.' },
    { match: /agent/i, title: 'Release Notes Agent',
      tools: [tool('create_agent', { name: 'Release notes', description: 'Writes release notes from the git log.' }, '{"id":"a2","name":"Release notes"}', 30)],
      text: 'I made an agent called **Release notes**. It reads the git log since the last tag and writes the notes in plain English. You will find it in the sidebar under Agents.',
      after: () => { agents = [...agents, { id: 'a2', name: 'Release notes', description: 'Writes release notes from the git log.', systemPrompt: 'Read the git log since the last tag and write release notes in plain English.', model: '', tools: [], mcp: [], createdAt: now(), updatedAt: now() }]; } },
  ];
  const fallback = (model) => ({ title: null,
    text: `This is a demo of Harf running in your browser, so this reply is scripted. In your own Harf, **${modelName(model)}** answers here, and Pi can read and write files and run commands in your workspace.\n\nTry one of the suggestions on a new chat: a chart, a script, a file or a formula.` });

  // ---------- chats ----------
  const usage = (out, ms) => ({ input: 2400, output: out, calls: 2, firstMs: 900, ms, streamMs: Math.round(ms * 0.6), cost: 0.004 });
  const reply = (script, model) => {
    const parts = [];
    if (script.thinking) parts.push({ type: 'thinking', text: script.thinking });
    for (const t of script.tools || []) parts.push({ type: 'tool', tool: { id: id(), name: t.name, args: t.args, output: t.output, status: 'done', ms: t.ms } });
    parts.push({ type: 'text', text: script.text });
    return { id: id(), role: 'assistant', content: script.text, parts, model, usage: usage(380, 4200), createdAt: now() };
  };
  const seed = (title, ask, script, model, minutes) => {
    const t = new Date(Date.now() - minutes * 60000).toISOString();
    return { id: id(), title, model, pinned: false, replying: false, createdAt: t, updatedAt: t,
      messages: [{ id: id(), role: 'user', content: ask, createdAt: t }, { ...reply(script, model), createdAt: t }] };
  };
  const chats = [
    seed('Most Populous Countries', 'Make a bar chart of the population of the ten most populous countries, then say in one line where the numbers come from.', SCRIPTS[0], 'openrouter/google/gemini-4-carbon', 30),
    seed('First 20 Prime Numbers', 'Write a Python script that prints the first 20 prime numbers, run it, and show me the output.', SCRIPTS[1], 'openrouter/moonshotai/kimi-k3.1-pro', 90),
  ];
  const find = (cid) => chats.find((c) => c.id === cid);
  const listed = () => [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((c) => ({ ...c, messages: null }));

  // ---------- responses ----------
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const none = () => new Response(null, { status: 204 });
  const refuse = (msg) => json({ error: msg }, 400);
  let stopping = null;

  // stream plays a scripted reply as server-sent events: part events as
  // the reply grows, a title for a new chat, then done with the saved reply.
  function stream(chat, script) {
    const enc = new TextEncoder();
    return new Response(new ReadableStream({
      async start(ctl) {
        const send = (event, data) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        const started = Date.now();
        const parts = [];
        let stopped = false;
        stopping = () => { stopped = true; };
        await sleep(650);
        if (script.thinking && !stopped) {
          parts.push({ type: 'thinking', text: script.thinking });
          send('part', { index: parts.length - 1, part: parts[parts.length - 1] });
          await sleep(700);
        }
        for (const t of script.tools || []) {
          if (stopped) break;
          const part = { type: 'tool', tool: { id: id(), name: t.name, args: t.args, status: 'running' } };
          parts.push(part);
          const i = parts.length - 1;
          send('part', { index: i, part });
          await sleep(500 + t.ms * 4);
          part.tool = { ...part.tool, status: 'done', output: t.output, ms: t.ms };
          send('part', { index: i, part });
          await sleep(250);
        }
        if (!stopped) {
          parts.push({ type: 'text', text: '' });
          const i = parts.length - 1;
          send('part', { index: i, part: { type: 'text', text: '' } });
          const words = script.text.match(/\S+\s*/g) || [];
          for (let w = 0; w < words.length && !stopped; w += 3) {
            const delta = words.slice(w, w + 3).join('');
            parts[i].text += delta;
            send('part', { index: i, delta });
            await sleep(45);
          }
        }
        if (script.after && !stopped) script.after();
        const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
        const saved = { id: id(), role: 'assistant', content: text, parts, model: chat.model, usage: usage(Math.max(40, Math.round(text.length / 4)), Date.now() - started), createdAt: now() };
        if (stopped) saved.error = 'Stopped';
        chat.messages.push(saved);
        chat.replying = false;
        chat.updatedAt = now();
        if (chat.messages.length <= 2) { chat.title = script.title || chat.title; send('title', { title: chat.title }); }
        send('done', saved);
        stopping = null;
        ctl.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  async function handle(method, path, body) {
    let m;
    if (method === 'GET' && path === 'config') return json({ defaultModel: MODELS[0].id, imageModel: '', imageModels: [], maxModelImage: 10 << 20, maxUpload: 100 << 20, models: MODELS, workspace: WORKSPACE });
    if (method === 'GET' && path === 'me') return json({ name: 'alex', username: 'alex' });
    if (method === 'GET' && path === 'chats') return json(listed());
    if (method === 'POST' && path === 'chats') {
      const c = { id: id(), title: '', model: body.model || MODELS[0].id, pinned: false, replying: false, messages: [], createdAt: now(), updatedAt: now() };
      if (body.agentId) c.agentId = body.agentId;
      chats.push(c);
      return json(c, 201);
    }
    if ((m = path.match(/^chats\/([^/]+)$/))) {
      const c = find(m[1]);
      if (!c) return json({ error: 'no such chat' }, 404);
      if (method === 'GET') return json(c);
      if (method === 'PATCH') { Object.assign(c, body, { updatedAt: now() }); return json(c); }
      if (method === 'DELETE') { chats.splice(chats.indexOf(c), 1); return none(); }
    }
    if ((m = path.match(/^chats\/([^/]+)\/messages$/)) && method === 'POST') {
      const c = find(m[1]);
      if (!c) return json({ error: 'no such chat' }, 404);
      if (body.from) { const i = c.messages.findIndex((x) => x.id === body.from); if (i >= 0) c.messages = c.messages.slice(0, i); }
      const ask = body.content || '';
      if (ask) c.messages.push({ id: id(), role: 'user', content: ask, createdAt: now() });
      if (!c.title) c.title = ask.split(/\s+/).slice(0, 4).join(' ');
      c.replying = true;
      const last = [...c.messages].reverse().find((x) => x.role === 'user');
      const text = last ? last.content : '';
      return stream(c, SCRIPTS.find((s) => s.match.test(text)) || fallback(c.model));
    }
    if (/^chats\/[^/]+\/stream$/.test(path)) return none();
    if (/^chats\/[^/]+\/stop$/.test(path)) { if (stopping) stopping(); return none(); }
    if (method === 'GET' && path === 'agents') return json(agents);
    if (method === 'POST' && path === 'agents') { const a = { ...body, id: id(), createdAt: now(), updatedAt: now() }; agents.push(a); return json(a, 201); }
    if ((m = path.match(/^agents\/([^/]+)$/))) {
      const i = agents.findIndex((a) => a.id === m[1]);
      if (method === 'PUT' && i >= 0) { agents[i] = { ...agents[i], ...body, updatedAt: now() }; return json(agents[i]); }
      if (method === 'DELETE' && i >= 0) { agents.splice(i, 1); return none(); }
      return json({ error: 'no such agent' }, 404);
    }
    if (method === 'GET' && path === 'mcp') return json([]);
    if (path.startsWith('mcp')) return refuse('MCP servers run in your own Harf. This demo runs in your browser.');
    if (method === 'GET' && path === 'plugins') return json(PLUGINS);
    if ((m = path.match(/^plugins\/([^/]+)$/)) && method === 'PUT') {
      const p = PLUGINS.find((x) => x.id === m[1]);
      if (!p) return json({ error: 'no such plugin' }, 404);
      if (p.id === 'images' && body.enabled) return refuse('Image generation needs an OpenRouter key in your own Harf.');
      p.enabled = !!body.enabled;
      return json(p);
    }
    if (path === 'image-model') return refuse('Image generation needs an OpenRouter key in your own Harf.');
    return json({ error: 'not in this demo' }, 404);
  }

  const real = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const at = url.pathname.indexOf('/api/');
    if (url.origin !== location.origin || at < 0) return real(input, init);
    const path = url.pathname.slice(at + 5);
    const method = (init.method || 'GET').toUpperCase();
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch {}
    return handle(method, path, body);
  };

  // Harf focuses its message box on load. Inside the landing page that
  // would pull the page down to the demo, so focus waits for the first
  // click or key press in the demo.
  if (window.top !== window) {
    let touched = false;
    const touch = () => { touched = true; };
    addEventListener('pointerdown', touch, true);
    addEventListener('keydown', touch, true);
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (opts) { if (touched) focus.call(this, opts); };
  }

  // Uploads go through XMLHttpRequest; in the demo they are refused plainly.
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (/\/files$/.test(String(url))) url = 'data:,';
    return open.call(this, method, url, ...rest);
  };
})();
