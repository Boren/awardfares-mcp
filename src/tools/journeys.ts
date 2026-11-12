import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AwardFaresApi } from "../api.js";
import { compactJourney } from "../format.js";
import { tool } from "./util.js";

export function registerJourneyTools(server: McpServer, api: AwardFaresApi) {
  tool(server, "awardfares_journeys_list", "List saved journeys (itineraries) and which one is active.", {}, async () => {
    const { journeys } = await api.journeys();
    return { count: journeys.length, journeys: journeys.map(compactJourney) };
  });

  tool(
    server,
    "awardfares_journeys_get",
    "Get a journey with its flights. Without id returns the active journey; with id that journey becomes the active one (AwardFares has a single active journey).",
    { id: z.string().optional() },
    async (a) => {
      const j = a.id ? await api.setActiveJourney(a.id) : await api.activeJourney();
      return compactJourney(j);
    },
  );

  tool(
    server,
    "awardfares_journeys_create",
    "Create a new empty journey (it becomes active). Optionally name it.",
    { name: z.string().optional() },
    async (a) => {
      let j = await api.createJourney();
      if (a.name) j = await api.renameJourney(j._id, a.name);
      return compactJourney(j);
    },
  );

  tool(
    server,
    "awardfares_journeys_add_fare",
    "Add a fare (by fare id from awardfares_search) to a journey. Defaults to the active journey; pass journeyId to switch first.",
    { fareId: z.string(), journeyId: z.string().optional() },
    async (a) => {
      if (a.journeyId) await api.setActiveJourney(a.journeyId);
      const j = await api.addFareToJourney(a.fareId);
      return compactJourney(j);
    },
  );

  tool(
    server,
    "awardfares_journeys_remove_fare",
    "Remove a fare from the active journey (pass journeyId to switch first).",
    { fareId: z.string(), journeyId: z.string().optional() },
    async (a) => {
      if (a.journeyId) await api.setActiveJourney(a.journeyId);
      const j = await api.removeFareFromJourney(a.fareId);
      return compactJourney(j);
    },
  );

  tool(
    server,
    "awardfares_journeys_rename",
    "Set a custom name on a journey.",
    { id: z.string(), name: z.string() },
    async (a) => compactJourney(await api.renameJourney(a.id, a.name)),
  );

  tool(
    server,
    "awardfares_journeys_share",
    "Create (or return) a public sharing link for a journey.",
    { id: z.string() },
    async (a) => {
      const r = await api.shareJourney(a.id);
      return { sharingUrl: `https://awardfares.com${r.sharingUrl}` };
    },
  );

  tool(
    server,
    "awardfares_journeys_delete",
    "Permanently delete a journey by id.",
    { id: z.string() },
    async (a) => {
      await api.deleteJourney(a.id);
      return { deleted: a.id };
    },
  );
}
