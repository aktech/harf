// A Pi extension, shipped inside Harf, that gives Pi the MCP servers Harf
// keeps, without touching the user's own Pi settings.
//
// It adds:
//   - the --harf-mcp flag: a JSON file of servers in mcp.json's mcpServers
//     shape. The file holds secrets, so it is read once and removed; the
//     servers are registered again whenever a session starts (a fork
//     starts a new one).
//   - /harf-mcp-tools <server>, which reports the server's tools as one
//     JSON notification: {"tools": [{"name", "description"}]}.
import { readFileSync, rmSync } from "node:fs";

// Pi names a server's tools mcp__<server>__<tool>, with every character
// other than letters, digits and _ made _.
const prefix = (server) => `mcp__${server.replace(/[^A-Za-z0-9_]/g, "_")}__`;

export default function (pi) {
  pi.registerFlag("harf-mcp", { type: "string", description: "JSON file of MCP servers from Harf; removed once read" });

  let servers;
  pi.on("session_start", (_event, ctx) => {
    const file = pi.getFlag("harf-mcp");
    if (servers === undefined && file) {
      try {
        servers = JSON.parse(readFileSync(file, "utf8"));
      } catch (e) {
        servers = {};
        ctx.ui.notify(`Harf's MCP servers could not be read: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      rmSync(file, { force: true });
    }
    for (const [name, config] of Object.entries(servers ?? {})) {
      try {
        pi.registerMcpServer(name, config);
      } catch (e) {
        ctx.ui.notify(`MCP server ${name}: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    }
  });

  pi.registerCommand("harf-mcp-tools", {
    description: "Report an MCP server's tools as JSON",
    handler: async (args, ctx) => {
      const p = prefix(args.trim());
      const tools = pi
        .getAllTools()
        .filter((t) => t.name.startsWith(p))
        .map((t) => ({ name: t.name.slice(p.length), description: t.description ?? "" }));
      ctx.ui.notify(JSON.stringify({ tools }), "info");
    },
  });
}
