// Who made a model, for its logo: read from the model's id and name, not
// from the provider that serves it (github-copilot/claude-haiku-4.5 is
// Anthropic's). Logos are in logos/, from @lobehub/icons-static-svg.

// MAKERS, in the order they are tried: a model whose name holds two makers'
// words (deepseek-r1-distill-qwen) is the first one's. mono logos are drawn
// in the text colour; the others keep their own colours.
export const MAKERS = [
  { id: 'anthropic', label: 'Claude', logo: 'claude-color', words: ['claude', 'anthropic'] },
  { id: 'openai', label: 'OpenAI', logo: 'openai', mono: true, words: ['gpt', 'openai', 'chatgpt', 'codex', 'dall', 'sora', 'whisper'], pattern: /^o\d+$/ },
  { id: 'gemini', label: 'Google Gemini', logo: 'gemini-color', words: ['gemini'] },
  { id: 'gemma', label: 'Google Gemma', logo: 'gemma-color', words: ['gemma'] },
  { id: 'google', label: 'Google', logo: 'google-color', words: ['imagen', 'google', 'palm', 'veo'] },
  { id: 'deepseek', label: 'DeepSeek', logo: 'deepseek-color', words: ['deepseek'] },
  { id: 'zai', label: 'Z.ai', logo: 'zai', mono: true, words: ['glm', 'chatglm', 'zhipu', 'zai', 'cogview'] },
  { id: 'mistral', label: 'Mistral', logo: 'mistral-color', words: ['mistral', 'mixtral', 'codestral', 'devstral', 'magistral', 'pixtral', 'ministral'] },
  { id: 'xai', label: 'xAI', logo: 'xai', mono: true, words: ['grok', 'xai'] },
  { id: 'meta', label: 'Meta', logo: 'meta-color', words: ['llama', 'meta'] },
  { id: 'qwen', label: 'Qwen', logo: 'qwen-color', words: ['qwen', 'qwq'] },
  { id: 'kimi', label: 'Kimi', logo: 'kimi-color', words: ['kimi', 'moonshot', 'moonshotai'] },
  { id: 'minimax', label: 'MiniMax', logo: 'minimax-color', words: ['minimax', 'abab'] },
  { id: 'bfl', label: 'Black Forest Labs', logo: 'bfl', mono: true, words: ['flux', 'bfl'] },
  { id: 'microsoft', label: 'Microsoft', logo: 'microsoft-color', words: ['phi', 'microsoft', 'mai'] },
  { id: 'nvidia', label: 'NVIDIA', logo: 'nvidia-color', words: ['nemotron', 'nvidia'] },
  { id: 'cohere', label: 'Cohere', logo: 'cohere-color', words: ['cohere', 'aya'] },
  { id: 'amazon', label: 'Amazon', logo: 'nova-color', words: ['nova', 'amazon'] },
  { id: 'perplexity', label: 'Perplexity', logo: 'perplexity-color', words: ['sonar', 'perplexity'] },
  { id: 'tencent', label: 'Tencent Hunyuan', logo: 'hunyuan-color', words: ['hunyuan', 'hy', 'tencent'] },
  { id: 'meituan', label: 'Meituan LongCat', logo: 'longcat-color', words: ['longcat', 'meituan'] },
  { id: 'stepfun', label: 'StepFun', logo: 'stepfun-color', words: ['step', 'stepfun'] },
];

// Organisation names in ids (OpenRouter's middle part) that are not one of
// a maker's words.
const ORGS = { 'z-ai': 'zai', 'zai-org': 'zai', thudm: 'zai', 'x-ai': 'xai', 'meta-llama': 'meta', 'black-forest-labs': 'bfl', mistralai: 'mistral', alibaba: 'qwen' };

const byId = (id) => MAKERS.find((m) => m.id === id) || null;

// says reports whether a word is the maker's word, alone or with a version
// after it (qwen3, llama4), but not as part of another word (metaphor).
const says = (m, word) => (m.pattern && m.pattern.test(word)) ||
  m.words.some((w) => word === w || (word.startsWith(w) && /^\d/.test(word.slice(w.length))));

function fromText(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return MAKERS.find((m) => words.some((w) => says(m, w))) || null;
}

// makerOf names the maker of a model, or null when it is not known.
export function makerOf(id, name) {
  const parts = String(id || '').toLowerCase().split('/');
  const model = parts[parts.length - 1];
  const org = parts.length > 2 ? parts[parts.length - 2] : '';
  // The model's own name decides first, so a family keeps its own logo
  // (google/gemma-3 is Gemma); the organisation in the id is the fallback.
  return fromText(model) || (org && (byId(ORGS[org]) || fromText(org))) || fromText(name);
}

const PROVIDERS = {
  'github-copilot': 'GitHub Copilot', openrouter: 'OpenRouter', openai: 'OpenAI', 'openai-codex': 'OpenAI Codex',
  anthropic: 'Anthropic', google: 'Google', 'google-vertex': 'Google Vertex', 'google-gemini-cli': 'Gemini CLI',
  'google-antigravity': 'Antigravity', xai: 'xAI', groq: 'Groq', cerebras: 'Cerebras', mistral: 'Mistral',
  deepseek: 'DeepSeek', 'amazon-bedrock': 'Amazon Bedrock', 'azure-openai-responses': 'Azure OpenAI',
  'vercel-ai-gateway': 'Vercel AI Gateway', zai: 'Z.ai', minimax: 'MiniMax', 'minimax-cn': 'MiniMax China',
  huggingface: 'Hugging Face', 'kimi-coding': 'Kimi Coding', opencode: 'OpenCode', ollama: 'Ollama', 'opencode-go': 'OpenCode Go',
};

// PROVIDER_LOGOS are the logos of the services that serve models, for the
// model list's group headings.
const PROVIDER_LOGOS = {
  'github-copilot': { logo: 'githubcopilot', mono: true }, openrouter: { logo: 'openrouter', mono: true },
  opencode: { logo: 'opencode', mono: true }, 'opencode-go': { logo: 'opencode', mono: true },
  openai: { logo: 'openai', mono: true }, 'openai-codex': { logo: 'openai', mono: true },
  anthropic: { logo: 'anthropic', mono: true }, google: { logo: 'google-color' },
  'google-vertex': { logo: 'google-color' }, 'google-gemini-cli': { logo: 'gemini-color' },
  'google-antigravity': { logo: 'antigravity-color' }, xai: { logo: 'xai', mono: true },
  groq: { logo: 'groq', mono: true }, cerebras: { logo: 'cerebras-color' }, mistral: { logo: 'mistral-color' },
  deepseek: { logo: 'deepseek-color' }, 'amazon-bedrock': { logo: 'bedrock-color' },
  'azure-openai-responses': { logo: 'azure-color' }, 'vercel-ai-gateway': { logo: 'vercel', mono: true },
  zai: { logo: 'zai', mono: true }, minimax: { logo: 'minimax-color' }, 'minimax-cn': { logo: 'minimax-color' },
  huggingface: { logo: 'huggingface-color' }, 'kimi-coding': { logo: 'kimi-color' }, ollama: { logo: 'ollama', mono: true },
};

// providerLogo is a provider's logo ("<provider> images" counts as the
// provider), or null when it has none.
export function providerLogo(p) {
  return PROVIDER_LOGOS[String(p || '').replace(/ images$/, '')] || null;
}

// providerName is a provider's readable name; "<provider> images" keeps
// its suffix.
export function providerName(p) {
  const m = String(p || '').match(/^(.*?)( images)?$/);
  return (PROVIDERS[m[1]] || m[1]) + (m[2] || '');
}
