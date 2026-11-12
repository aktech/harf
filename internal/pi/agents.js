// A Pi extension, shipped inside Harf, that lets the model create, change
// and list Harf agents from a chat.
//
// Pi's RPC mode has no way for a tool to call its host, so each tool asks
// Harf through an editor dialog: the title is harf:<tool>, the prefill
// the call's arguments as JSON, and Harf answers with
// {"result": ...} or {"error": "..."}. Harf checks every value and saves
// the agent; the tool's result is that JSON, which Harf's UI also reads to
// show the agent.
import { Type } from "@earendil-works/pi-ai";

async function ask(ctx, tool, params) {
  const answer = await ctx.ui.editor(`harf:${tool}`, JSON.stringify(params));
  if (answer === undefined) throw new Error("Harf did not answer. Agents can only be made in Harf.");
  const r = JSON.parse(answer);
  if (r.error) throw new Error(r.error);
  return r.result;
}

const fields = {
  description: Type.Optional(Type.String({ description: "One line on what the agent is for" })),
  systemPrompt: Type.Optional(Type.String({ description: "The agent's instructions, added to the system prompt of its chats" })),
  model: Type.Optional(Type.String({ description: "Model as provider/id, exactly as list_agents lists it; leave out to use each chat's model" })),
  thinking: Type.Optional(Type.String({ description: "Thinking level: off, minimal, low, medium, high, xhigh or max" })),
  tools: Type.Optional(Type.Array(Type.String(), { description: "Pi tools the agent may use, from list_agents; leave out for Pi's defaults (read, bash, edit, write), [] for none" })),
  mcp: Type.Optional(Type.Array(Type.String(), { description: "MCP servers the agent may use, by name; leave out for every enabled server, [] for none" })),
  icon: Type.Optional(Type.String({ description: "One emoji" })),
};

function tool(pi, name, label, description, parameters) {
  pi.registerTool({
    name,
    label,
    description,
    parameters,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await ask(ctx, name, params);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
}

export default function (pi) {
  tool(pi, "list_agents", "List agents",
    "List the user's Harf agents, and the models, tools and MCP servers an agent can use.",
    Type.Object({}));
  tool(pi, "create_agent", "Create agent",
    "Save a new Harf agent: a reusable assistant with its own instructions, model and tools. Returns the saved agent.",
    Type.Object({ name: Type.String({ description: "Short name, such as Go reviewer" }), ...fields }));
  tool(pi, "update_agent", "Update agent",
    "Change a Harf agent. Only the fields given change. Returns the saved agent.",
    Type.Object({ id: Type.String({ description: "The agent's id, from list_agents or create_agent" }), name: Type.Optional(Type.String()), ...fields }));
}
