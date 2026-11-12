// Pure helpers for MCP servers and the agent builder in the web UI.

// parsePairs reads one name and value per line, split at the first sep:
// KEY=value for env, Name: value for headers. Blank lines are skipped; a
// line without a name or sep is an error that names its line.
export function parsePairs(text, sep) {
  const out = {};
  String(text || '').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const at = line.indexOf(sep);
    const name = at < 0 ? '' : line.slice(0, at).trim();
    if (!name) throw new Error(`line ${i + 1} needs a name, then ${sep}, then a value`);
    out[name] = line.slice(at + 1).trim();
  });
  return out;
}

// formatPairs writes pairs back as parsePairs reads them.
export function formatPairs(pairs, sep) {
  return Object.entries(pairs || {}).map(([k, v]) => (sep === ':' ? `${k}: ${v}` : `${k}${sep}${v}`)).join('\n');
}

// mcpTool splits a tool name Pi gives an MCP tool, mcp__<server>__<tool>;
// null for any other tool.
export function mcpTool(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name || '');
  return m ? { server: m[1], tool: m[2] } : null;
}

// savedAgent is the agent a finished create_agent or update_agent step
// saved, as its output reports it; null otherwise.
export function savedAgent(t) {
  if (!t || t.status !== 'done' || (t.name !== 'create_agent' && t.name !== 'update_agent')) return null;
  try {
    const a = JSON.parse(t.output).agent;
    return a && a.id && a.name ? a : null;
  } catch {
    return null;
  }
}
