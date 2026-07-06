import type { DiscoveryCandidate } from "../../contracts/surfaces/undiscovered-candidate.contract.js";
import { normalizeDiscoveryCategory } from "../../contracts/surfaces/undiscovered-candidate.contract.js";

/**
 * A small, representative Vermont sample so Dashboard v1's review workflow is
 * usable locally without Firebase creds or a `.osm.pbf` file. These stand in
 * for what an OSM PBF v2 Vermont scan would produce. Real seeding uses
 * `pbfPreviewToDiscoveryCandidate` against a live scan.
 */

type Seed = {
  osmType: "node" | "way" | "relation";
  osmId: number;
  displayName: string;
  category: string;
  kind: "spot" | "route";
  lat: number;
  lng: number;
  passed: boolean;
  reasons?: string[];
  activities?: string[];
};

const VERMONT_SEEDS: Seed[] = [
  { osmType: "node", osmId: 1001, displayName: "Warren Falls", category: "waterfall", kind: "spot", lat: 44.114, lng: -72.861, passed: true, activities: ["swimming", "waterfall"] },
  { osmType: "node", osmId: 1002, displayName: "Bristol Falls", category: "swimming_hole", kind: "spot", lat: 44.145, lng: -73.06, passed: true, activities: ["swimming"] },
  { osmType: "way", osmId: 1003, displayName: "Camel's Hump Summit Trail", category: "hiking_trail", kind: "route", lat: 44.319, lng: -72.885, passed: true, activities: ["hiking"] },
  { osmType: "node", osmId: 1004, displayName: "Mount Mansfield Overlook", category: "scenic_overlook", kind: "spot", lat: 44.544, lng: -72.814, passed: true, activities: ["viewpoint"] },
  { osmType: "node", osmId: 1005, displayName: "Texas Falls", category: "waterfall", kind: "spot", lat: 43.925, lng: -72.899, passed: true, activities: ["waterfall"] },
  { osmType: "node", osmId: 1006, displayName: "Emerald Lake", category: "lake_pond", kind: "spot", lat: 43.281, lng: -73.0, passed: true, activities: ["swimming", "paddling"] },
  { osmType: "way", osmId: 1007, displayName: "Quechee Gorge Trail", category: "gorge_canyon", kind: "route", lat: 43.639, lng: -72.406, passed: true, activities: ["hiking"] },
  { osmType: "node", osmId: 1008, displayName: "Elmore State Park Beach", category: "beach", kind: "spot", lat: 44.548, lng: -72.531, passed: true, activities: ["swimming"] },
  // Two that FAIL the quality gate — so the reviewer can see the filter in action.
  { osmType: "way", osmId: 2001, displayName: "Service Rd (unnamed)", category: "other", kind: "route", lat: 44.2, lng: -72.7, passed: false, reasons: ["service_road", "unnamed_path"] },
  { osmType: "node", osmId: 2002, displayName: "ATM", category: "other", kind: "spot", lat: 44.26, lng: -72.58, passed: false, reasons: ["non_destination_amenity"] },
];

export function buildVermontSampleCandidates(nowIso?: string): DiscoveryCandidate[] {
  const now = nowIso ?? new Date().toISOString();
  return VERMONT_SEEDS.map((s) => ({
    id: `osm_pbf:${s.osmType}:${s.osmId}`,
    region: "VT",
    sourceChannel: "osm_pbf" as const,
    kind: s.kind,
    targetCollection: s.kind === "route" ? ("unexploredRoutes" as const) : ("unexploredSpots" as const),
    displayName: s.displayName,
    primaryCategory: normalizeDiscoveryCategory(s.category),
    categories: [normalizeDiscoveryCategory(s.category)],
    primaryActivity: s.activities?.[0] ?? null,
    activities: s.activities ?? [],
    lat: s.lat,
    lng: s.lng,
    reviewStatus: "candidate" as const,
    qualityGate: { passed: s.passed, reasons: s.reasons ?? [] },
    provenance: {
      sourceProvider: "osm-pbf-sample",
      sourceIds: [`${s.osmType}/${s.osmId}`],
      sourceKeys: [],
      importRunId: "vermont-sample",
    },
    createdAt: now,
    updatedAt: now,
  }));
}
