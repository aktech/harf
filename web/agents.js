// What the Agents page shows about each agent.

// DEFAULT_TOOLS are Pi's built-in tools, which an agent with no tool list uses.
export const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'];

// agentTags lists the tools, then the MCP servers, an agent may use. No
// tool list means Pi's defaults; no server list means every enabled one.
export function agentTags(agent, enabledServers) {
  const tools = Array.isArray(agent.tools) ? agent.tools : DEFAULT_TOOLS;
  const mcp = Array.isArray(agent.mcp) ? agent.mcp : enabledServers;
  return [...tools, ...mcp];
}

// agentActivity counts an agent's chats and says whether one is replying.
export function agentActivity(id, chats) {
  const own = chats.filter((c) => c.agentId === id);
  return { chats: own.length, running: own.some((c) => c.replying) };
}

// editedLabel says, by calendar day, when an agent was last changed.
export function editedLabel(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((day(now) - day(d)) / 864e5);
  if (days <= 0) return 'Edited today';
  if (days === 1) return 'Edited yesterday';
  if (days < 7) return `Edited ${days} days ago`;
  const opts = { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) };
  return `Edited ${d.toLocaleDateString('en-US', opts)}`;
}
