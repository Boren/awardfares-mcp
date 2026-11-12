import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env } as Record<string, string>, stderr: "inherit" });
const client = new Client({ name: "roundtrip", version: "0.0.0" });
await client.connect(transport);
async function call(name: string, args: Record<string, unknown>, max = 2500) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
  const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
  console.log(`\n=== ${name} ${JSON.stringify(args)} (${Date.now() - t0}ms)${res.isError ? " ERROR" : ""}`);
  console.log(text.length > max ? text.slice(0, max) + "\n...[truncated]" : text);
  return res.isError ? undefined : JSON.parse(text);
}
const status0 = await call("awardfares_status", {});
// cleanup leftovers from the previous run
const list = await call("awardfares_alerts_list", {}, 1500);
for (const a of list?.alerts ?? []) if (a.origin?.includes("airport:CDG") && a.departureDates?.includes("2027-06-28")) await call("awardfares_alerts_delete", { id: a.id });
// alert update path
const created = await call("awardfares_alerts_create", { origin: ["CDG"], destination: ["RUN"], dates: ["2027-06-28"], cabin: ["business"], minSeats: 2 }, 800);
const alertId = created?.created?.id as string;
if (alertId) {
  await call("awardfares_alerts_update", { id: alertId, cabin: ["business", "premeco"], minSeats: 1 }, 1200);
  await call("awardfares_alerts_delete", { id: alertId });
}
// live search on a date not searched recently, to exercise polling
const search = await call("awardfares_search", { origin: ["CDG"], destination: ["RUN"], dates: ["2027-07-20"], live: true, maxWaitSeconds: 120 }, 1500);
const fareId: string | undefined = search?.fares?.[0]?.id;
// journey add/remove
const active = await call("awardfares_journeys_get", {}, 600);
const before = (active?.fares ?? []).map((f: { id: string }) => f.id);
if (fareId && !before.includes(fareId)) {
  await call("awardfares_journeys_add_fare", { fareId }, 600);
  await call("awardfares_journeys_remove_fare", { fareId }, 600);
}
await call("awardfares_schedule", { from: "CDG", to: "RUN", date: "2027-06-28" }, 3000);
await call("awardfares_seatmap", { from: "CDG", to: "RUN", date: "2027-06-28", flight: "AF654", cabin: "premeco", verbose: true }, 3000);
const status1 = await call("awardfares_status", {});
console.log("\nlive searches used:", status0?.liveSearches.usedToday, "->", status1?.liveSearches.usedToday);
console.log("seat maps used:", status0?.seatMaps.used, "->", status1?.seatMaps.used);
await client.close();
process.exit(0);
