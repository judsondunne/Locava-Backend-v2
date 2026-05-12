import type { PlaceCandidate } from "../place-candidates/types.js";
import type { StateContentFactoryRunConfig } from "./types.js";

/** Rough geographic centroids for post-only manual runs when lat/lng are omitted. */
const US_STATE_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  VT: { lat: 44.26, lng: -72.58 },
  NH: { lat: 43.99, lng: -71.58 },
  MA: { lat: 42.41, lng: -71.38 },
  NY: { lat: 42.95, lng: -75.52 },
  CA: { lat: 36.78, lng: -119.42 },
};

/**
 * Builds a valid PlaceCandidate for `runKind: "post_only"` dev runs so Wikimedia + quality
 * gates receive real coordinates (optional explicit lat/lng, else state centroid).
 */
export function buildPostOnlyPlaceCandidate(config: StateContentFactoryRunConfig): PlaceCandidate {
  const label = String(config.postOnlyPlace ?? "").trim();
  if (!label) {
    throw new Error("post_only_place_required");
  }
  const sc = String(config.stateCode || "VT").toUpperCase();
  const centroid = US_STATE_CENTROIDS[sc] ?? { lat: 39.83, lng: -98.58 };
  const lat = typeof config.postTestLatitude === "number" && Number.isFinite(config.postTestLatitude)
    ? config.postTestLatitude
    : centroid.lat;
  const lng = typeof config.postTestLongitude === "number" && Number.isFinite(config.postTestLongitude)
    ? config.postTestLongitude
    : centroid.lng;
  const stateName = String(config.stateName || "").trim() || "Vermont";
  const id = `manual_${label.replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}_${sc}`;

  return {
    placeCandidateId: id,
    name: label,
    state: stateName,
    stateCode: sc,
    country: "US",
    lat,
    lng,
    categories: ["manual_post_test"],
    primaryCategory: "manual",
    candidateTier: "A",
    sourceIds: {},
    sourceUrls: {},
    rawSources: ["state_content_factory_post_only"],
    sourceConfidence: 0.5,
    locavaScore: 0.5,
    locavaPriorityScore: 0,
    eligibleForMediaPipeline: true,
    blocked: false,
    priorityQueue: "P0",
    signals: {
      hasCoordinates: true,
      hasWikipedia: false,
      hasWikidata: false,
      hasCommonsCategory: false,
      hasUsefulCategory: true,
      isOutdoorLikely: true,
      isLandmarkLikely: true,
      isTourismLikely: true,
      isTooGeneric: false,
    },
    debug: {
      matchedSourceCategories: [],
      normalizedFrom: ["post_only"],
      scoreReasons: [],
      tierReasons: [],
      dedupeKey: id,
    },
  };
}
