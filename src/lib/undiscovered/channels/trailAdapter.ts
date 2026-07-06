import type { DiscoveryChannelAdapter, ChannelFetchContext, RawDiscoveryItem } from "./types.js";
import {
  itemsToChannelCandidates,
  isRegionRelevant,
} from "./placeCandidateExtractor.js";
import type { DiscoveryCandidate } from "../../../contracts/surfaces/undiscovered-candidate.contract.js";
import { normalizeDiscoveryCategory } from "../../../contracts/surfaces/undiscovered-candidate.contract.js";

/**
 * Trail-source channel — trail/outdoor databases that already carry structured
 * names + coordinates (so extraction is trivial and coordinates are trusted).
 *
 * Strategy: pull trails within the Vermont bbox from a trail DB. Because trail
 * items usually have a clean name + lat/lng, we build a candidate directly rather
 * than parsing prose. Fed via `rawItems` (from a trail source / MCP / fixture).
 */
export const trailAdapter: DiscoveryChannelAdapter = {
  channel: "trail_db",
  label: "Trail sources",
  strategy: "Import named trails with coordinates from a trail DB, bbox-filtered to Vermont.",
  liveFetchSupported: false,
  async fetchCandidates(ctx: ChannelFetchContext) {
    const items = ctx.rawItems ?? [];
    const now = new Date().toISOString();
    const structured: DiscoveryCandidate[] = [];
    const prose: RawDiscoveryItem[] = [];

    for (const item of items) {
      const name = String(item.extra?.name ?? "").trim();
      const hasCoords = typeof item.lat === "number" && typeof item.lng === "number";
      // Trust items that already carry a clean name (trail DBs do). Coords are
      // optional — region is confirmed by in-bbox coords or a regional keyword in
      // the item text (e.g. the source's "…, Vermont" location label).
      if (name) {
        if (!isRegionRelevant(item, ctx.region)) continue;
        const rawCat = String(item.extra?.category ?? "hiking_trail");
        const category = normalizeDiscoveryCategory(rawCat);
        const reasons = ["trail_db_structured"];
        if (!hasCoords) reasons.push("coords_pending");
        structured.push({
          id: `trail_db:${item.sourceId}`,
          region: ctx.region,
          sourceChannel: "trail_db",
          kind: "route",
          targetCollection: "unexploredRoutes",
          displayName: name,
          primaryCategory: category,
          categories: [category],
          primaryActivity: "hiking",
          activities: ["hiking"],
          lat: item.lat ?? 0,
          lng: item.lng ?? 0,
          reviewStatus: "candidate",
          qualityGate: { passed: true, reasons },
          provenance: {
            sourceProvider: "trail-db",
            sourceIds: [item.sourceId],
            sourceKeys: [],
            sourceUrl: item.sourceUrl,
          },
          createdAt: now,
          updatedAt: now,
        });
      } else {
        prose.push(item);
      }
    }

    const extracted = itemsToChannelCandidates(prose, {
      channel: "trail_db",
      region: ctx.region,
      sourceProvider: "trail-db",
    });
    return [...structured, ...extracted];
  },
};
