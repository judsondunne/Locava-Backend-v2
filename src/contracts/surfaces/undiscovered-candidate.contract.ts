import { z } from "zod";

/**
 * Undiscovered Spots — unified discovery-candidate contract (Dashboard v1).
 *
 * A channel-agnostic review record. OSM PBF v2 is the first source, but the
 * same shape carries Wikimedia/Reddit/Instagram/blog/trail candidates so every
 * source feeds one review queue and, once approved, the same two collections
 * (`unexploredSpots` / `unexploredRoutes`). This never writes `/posts`.
 */

/** Where a candidate came from. OSM is live; the rest are staged for June 26–27. */
export const DiscoverySourceChannelSchema = z.enum([
  "osm_pbf",
  "wikimedia",
  "reddit",
  "instagram",
  "web_blog",
  "trail_db",
  "outdoor_db",
  "manual",
]);
export type DiscoverySourceChannel = z.infer<typeof DiscoverySourceChannelSchema>;

/**
 * Review workflow status. A candidate moves candidate → reviewed → approved,
 * then `written` once it has been copied into unexploredSpots/unexploredRoutes.
 * `rejected` is terminal-ish (can be reopened to `candidate`).
 */
export const DiscoveryReviewStatusSchema = z.enum([
  "candidate",
  "reviewed",
  "approved",
  "rejected",
  "written",
]);
export type DiscoveryReviewStatus = z.infer<typeof DiscoveryReviewStatusSchema>;

/** Allowed status transitions. Anything not listed here is rejected by the store. */
export const DISCOVERY_STATUS_TRANSITIONS: Record<DiscoveryReviewStatus, DiscoveryReviewStatus[]> = {
  candidate: ["reviewed", "approved", "rejected"],
  reviewed: ["approved", "rejected", "candidate"],
  approved: ["written", "reviewed", "rejected"],
  rejected: ["candidate"],
  written: ["approved"], // allow re-opening a mistaken write for re-review
};

export function canTransitionDiscoveryStatus(
  from: DiscoveryReviewStatus,
  to: DiscoveryReviewStatus,
): boolean {
  if (from === to) return false;
  return DISCOVERY_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whether a candidate is eligible to be written to the undiscovered collections. */
export function isWritableDiscoveryStatus(status: DiscoveryReviewStatus): boolean {
  return status === "approved";
}

/** Popularity ranking computed on top of the quality filter (no AI — metadata + web authority). */
export const DiscoveryRankingSchema = z.object({
  /** 0–100 combined score (local metadata signals + web authority). */
  score: z.number().min(0).max(100),
  tier: z.enum(["S", "A", "B", "C"]),
  /** Authority-weighted Google organic hits (absent until web ranking ran). */
  webAuthority: z.number().optional(),
  /** High local quality but ~zero web presence — a true "undiscovered" candidate. */
  hiddenGem: z.boolean().optional(),
  signals: z.array(z.string()),
  rankedAt: z.string(),
});
export type DiscoveryRanking = z.infer<typeof DiscoveryRankingSchema>;

export const DiscoveryQualityGateSchema = z.object({
  /** Passed the quality gate (would be shown), independent of human review. */
  passed: z.boolean(),
  /** Machine reasons it was hidden/flagged, e.g. ["unnamed_path", "service_road"]. */
  reasons: z.array(z.string()),
});
export type DiscoveryQualityGate = z.infer<typeof DiscoveryQualityGateSchema>;

export const DiscoveryCandidateSchema = z.object({
  /** Deterministic id, e.g. `osm_pbf:node:12345` — stable across re-scans. */
  id: z.string().min(1),
  /** Two-letter region/state code. Vermont ("VT") is the first test region. */
  region: z.string().min(1),
  sourceChannel: DiscoverySourceChannelSchema,
  kind: z.enum(["spot", "route"]),
  targetCollection: z.enum(["unexploredSpots", "unexploredRoutes"]),

  displayName: z.string(),
  primaryCategory: z.string(),
  categories: z.array(z.string()).default([]),
  primaryActivity: z.string().nullable().optional(),
  activities: z.array(z.string()).default([]),

  lat: z.number(),
  lng: z.number(),

  reviewStatus: DiscoveryReviewStatusSchema.default("candidate"),
  qualityGate: DiscoveryQualityGateSchema,
  ranking: DiscoveryRankingSchema.optional(),

  /** Provenance for dedupe/audit. */
  provenance: z.object({
    sourceProvider: z.string(),
    sourceIds: z.array(z.string()).default([]),
    sourceKeys: z.array(z.string()).default([]),
    sourceUrl: z.string().optional(),
    importRunId: z.string().optional(),
  }),

  reviewNotes: z.string().optional(),
  reviewedBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidateSchema>;

/**
 * Curated spot categories the dashboard groups and filters by. Free-form
 * source categories are normalized into these buckets (unknown → "other").
 */
export const DISCOVERY_SPOT_CATEGORIES = [
  "waterfall",
  "swimming_hole",
  "summit_viewpoint",
  "scenic_overlook",
  "hiking_trail",
  "lake_pond",
  "river_stream",
  "gorge_canyon",
  "cave",
  "forest_natural",
  "beach",
  "campsite",
  "historic_landmark",
  "park",
  "other",
] as const;
export type DiscoverySpotCategory = (typeof DISCOVERY_SPOT_CATEGORIES)[number];

/** Map a raw source category/activity string onto a curated bucket. */
export function normalizeDiscoveryCategory(raw: string | null | undefined): DiscoverySpotCategory {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "other";
  if (s.includes("waterfall")) return "waterfall";
  if (s.includes("swim") || s.includes("swimming_hole")) return "swimming_hole";
  if (s.includes("summit") || s.includes("peak") || s.includes("viewpoint")) return "summit_viewpoint";
  if (s.includes("overlook") || s.includes("vista") || s.includes("scenic")) return "scenic_overlook";
  if (s.includes("hik") || s.includes("trail") || s.includes("path")) return "hiking_trail";
  if (s.includes("lake") || s.includes("pond") || s.includes("reservoir")) return "lake_pond";
  if (s.includes("river") || s.includes("stream") || s.includes("brook") || s.includes("creek")) return "river_stream";
  if (s.includes("gorge") || s.includes("canyon") || s.includes("ravine")) return "gorge_canyon";
  if (s.includes("cave") || s.includes("cavern")) return "cave";
  if (s.includes("beach")) return "beach";
  if (s.includes("camp")) return "campsite";
  if (s.includes("historic") || s.includes("landmark") || s.includes("monument")) return "historic_landmark";
  if (s.includes("park")) return "park";
  if (s.includes("forest") || s.includes("wood") || s.includes("nature") || s.includes("natural")) return "forest_natural";
  return "other";
}

/**
 * Quality-rule catalog. Each rule mirrors a PBF quality-filter key (same names)
 * plus a human label and the default action. This is the shared, editable
 * definition of "what counts as a good spot" that the dashboard surfaces.
 */
export type DiscoveryQualityAction = "reject" | "review" | "allow";

export interface DiscoveryQualityRule {
  key: string;
  label: string;
  description: string;
  defaultAction: DiscoveryQualityAction;
}

export const DISCOVERY_QUALITY_RULES: DiscoveryQualityRule[] = [
  { key: "infrastructure", label: "Infrastructure", description: "Utilities, towers, pipelines — not a destination.", defaultAction: "reject" },
  { key: "service_road", label: "Service road", description: "Access/service roads, driveways, parking aisles.", defaultAction: "reject" },
  { key: "administrative", label: "Administrative boundary", description: "Admin/political boundaries, not a place to visit.", defaultAction: "reject" },
  { key: "railway", label: "Railway", description: "Rail lines and rail infrastructure.", defaultAction: "reject" },
  { key: "broad_geography", label: "Broad geography", description: "Whole regions/counties — too coarse to be a spot.", defaultAction: "reject" },
  { key: "unnamed_land", label: "Unnamed land", description: "Unnamed landuse polygons with no destination value.", defaultAction: "reject" },
  { key: "unnamed_path", label: "Unnamed path", description: "Unnamed paths/tracks; keep only named trails.", defaultAction: "review" },
  { key: "non_destination_amenity", label: "Non-destination amenity", description: "ATMs, benches, waste baskets, etc.", defaultAction: "reject" },
  { key: "place_of_worship", label: "Place of worship", description: "Churches/temples — usually not outdoor spots.", defaultAction: "review" },
  { key: "generic_lodging", label: "Generic lodging", description: "Hotels/motels without destination character.", defaultAction: "review" },
  { key: "generic_retail", label: "Generic retail", description: "Shops/retail — not an undiscovered spot.", defaultAction: "reject" },
  { key: "healthcare", label: "Healthcare", description: "Clinics/hospitals/pharmacies.", defaultAction: "reject" },
  { key: "residential_land", label: "Residential land", description: "Residential parcels and housing.", defaultAction: "reject" },
  { key: "map_junk", label: "Map junk", description: "Rendering artifacts and low-signal tags.", defaultAction: "reject" },
];

export const undiscoveredDashboardContract = {
  pagePath: "/admin/undiscovered/dashboard-v1",
  apiBase: "/admin/undiscovered/api/dashboard-v1",
  routeNames: {
    health: "admin.undiscovered.dashboard_v1.health",
    listCandidates: "admin.undiscovered.dashboard_v1.list_candidates",
    setStatus: "admin.undiscovered.dashboard_v1.set_status",
    seedSample: "admin.undiscovered.dashboard_v1.seed_sample",
    seedFromPbf: "admin.undiscovered.dashboard_v1.seed_from_pbf",
    seedFromChannel: "admin.undiscovered.dashboard_v1.seed_from_channel",
    channels: "admin.undiscovered.dashboard_v1.channels",
    categories: "admin.undiscovered.dashboard_v1.categories",
  },
} as const;

export const SeedFromChannelBodySchema = z.object({
  channel: DiscoverySourceChannelSchema,
  region: z.string().default("VT"),
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  /** Optional pre-fetched raw items (fixtures / manual paste / channels without live fetch). */
  rawItems: z
    .array(
      z.object({
        sourceId: z.string(),
        text: z.string(),
        sourceUrl: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        extra: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

export const SetStatusBodySchema = z.object({
  status: DiscoveryReviewStatusSchema,
  reviewNotes: z.string().max(2000).optional(),
  reviewedBy: z.string().max(120).optional(),
});

export const RankSpotsBodySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  channel: DiscoverySourceChannelSchema.optional(),
  category: z.string().optional(),
  /** Skip spots that already carry a web-backed ranking (protects Serper quota). */
  onlyUnranked: z.boolean().default(true),
});

export const ListCandidatesQuerySchema = z.object({
  region: z.string().optional(),
  status: DiscoveryReviewStatusSchema.optional(),
  channel: DiscoverySourceChannelSchema.optional(),
  category: z.string().optional(),
});
