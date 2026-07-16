import type { UndiscoveredReel } from "../../contracts/surfaces/undiscovered-reels.contract.js";
import type { ReelMapFeature } from "../../contracts/surfaces/undiscovered-reels-map.contract.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

/** west,south,east,north */
export type MapBbox = { west: number; south: number; east: number; north: number };

export function parseReelMapBbox(raw: string): MapBbox | null {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts as [number, number, number, number];
  if (south > north) return null;
  return { west, south, east, north };
}

function inBbox(lat: number, lng: number, b: MapBbox): boolean {
  if (lat < b.south || lat > b.north) return false;
  // Handle antimeridian-crossing bboxes (west > east).
  return b.west <= b.east ? lng >= b.west && lng <= b.east : lng >= b.west || lng <= b.east;
}

/** Shape a stored reel into a map feature. */
function toFeature(reel: UndiscoveredReel): ReelMapFeature | null {
  const { lat, lng } = reel.location;
  if (lat == null || lng == null) return null;
  return {
    id: reel.id,
    shortcode: reel.shortcode,
    lat,
    lng,
    matchedSpotId: reel.location.matchedSpotId,
    matchedSpotCollection: reel.location.matchedSpotCollection,
    reelUrl: reel.reelUrl,
    videoUrl: reel.videoUrl,
    thumbnailUrl: reel.thumbnailUrl,
    playable: Boolean(reel.videoUrl),
    creator: {
      username: reel.creator.username,
      fullName: reel.creator.fullName,
      profilePicUrl: reel.creator.profilePicUrl,
      profileUrl: reel.creator.profileUrl,
    },
    qualityScore: reel.qualityScore ?? 0,
  };
}

/**
 * Pure bbox filter + shaping: keep in-view, non-rejected reels, best quality
 * first, capped to `limit`. Separated from Firestore so it's unit-testable.
 */
export function buildReelMapFeatures(
  reels: UndiscoveredReel[],
  bbox: MapBbox,
  opts: { limit: number; playableOnly: boolean },
): { features: ReelMapFeature[]; truncated: boolean } {
  const matched = reels
    .filter((r) => r.reviewStatus !== "rejected")
    .map(toFeature)
    .filter((f): f is ReelMapFeature => f !== null && inBbox(f.lat, f.lng, bbox))
    .filter((f) => (opts.playableOnly ? f.playable : true))
    .sort((a, b) => b.qualityScore - a.qualityScore);
  return { features: matched.slice(0, opts.limit), truncated: matched.length > opts.limit };
}

/**
 * Load undiscovered reels and return the bbox-filtered map layer. The collection
 * is small (hundreds–low thousands), so an in-memory scan + filter is fine and
 * avoids Firestore's inability to range-query two axes. Revisit with geohashing
 * if it grows past ~10k.
 */
export async function fetchUndiscoveredReelsMapLayer(input: {
  bbox: MapBbox;
  limit: number;
  playableOnly: boolean;
  scanCap?: number;
}): Promise<{ features: ReelMapFeature[]; count: number; truncated: boolean; generatedAt: number }> {
  const db = getFirestoreSourceClient();
  const generatedAt = Date.now();
  if (!db) return { features: [], count: 0, truncated: false, generatedAt };

  const snap = await db.collection("undiscoveredReels").limit(input.scanCap ?? 5000).get();
  const reels = snap.docs.map((d) => d.data() as UndiscoveredReel);
  const { features, truncated } = buildReelMapFeatures(reels, input.bbox, {
    limit: input.limit,
    playableOnly: input.playableOnly,
  });
  return { features, count: features.length, truncated, generatedAt };
}
