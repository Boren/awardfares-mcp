/**
 * Spawns the built server over stdio and exercises read-only tools.
 * Usage: npm run build && npm run smoke [-- --live]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const live = process.argv.includes("--live");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env } as Record<string, string>,
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

async function call(name: string, args: Record<string, unknown>) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
  const text = (res.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
  console.log(`\n=== ${name} ${JSON.stringify(args)} (${Date.now() - t0}ms)${res.isError ? " ERROR" : ""}`);
  console.log(text.length > 3000 ? text.slice(0, 3000) + "\n...[truncated]" : text);
  return text;
}

await call("awardfares_status", {});
await call("awardfares_locations", { q: "reunion" });
await call("awardfares_search", { origin: ["CDG"], destination: ["RUN"], dateStart: "2027-06-20", dateEnd: "2027-06-30", live: false });
await call("awardfares_calendar", { origin: ["CDG"], destination: ["RUN"], dateStart: "2027-06-07", dateEnd: "2027-07-12" });
await call("awardfares_journeys_list", {});
await call("awardfares_alerts_list", {});
if (live) {
  await call("awardfares_search", { origin: ["CDG"], destination: ["RUN"], dates: ["2027-06-28"], live: true, maxWaitSeconds: 90 });
  await call("awardfares_status", {});
}

await client.close();
process.exit(0);
