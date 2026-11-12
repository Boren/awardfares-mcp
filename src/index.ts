#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AwardFaresApi } from "./api.js";
import { Session } from "./session.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerJourneyTools } from "./tools/journeys.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerSearchTools } from "./tools/search.js";
import { registerSeatTools } from "./tools/seats.js";

const session = new Session();
const api = new AwardFaresApi(session);

const server = new McpServer({ name: "awardfares", version: "0.1.0" });

registerMetaTools(server, api, session);
registerSearchTools(server, api);
registerAlertTools(server, api);
registerJourneyTools(server, api);
registerSeatTools(server, api);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Never outlive the client: force-exit if the browser refuses to close promptly.
  setTimeout(() => process.exit(0), 5000).unref();
  await session.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", () => void shutdown());
process.stdin.on("close", () => void shutdown());

const transport = new StdioServerTransport();
await server.connect(transport);
// connect() installs its own transport.onclose; hook the server-level event instead.
server.server.onclose = () => void shutdown();
console.error("[awardfares] MCP server ready");
