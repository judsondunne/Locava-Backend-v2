import type { UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import {
  emojiCandidatesFromDoc,
  resolveMapLayerEmoji,
} from "../../lib/map/mapLayerActivityEmoji.js";
import { isUndiscoveredFirestoreMapEligible } from "../../lib/map/undiscoveredFirestoreEligibility.js";
import {
  maxUnexploredSpotsPerTile,
  rankSpotForTile,
} from "../../lib/map/unexploredSpotTileZoom.js";
import { formatTileKey } from "../../lib/inventory/inventoryTileGrid.js";
import {
  getUnexploredTilesByKeys,
  queryUnexploredSpotsByTileKey,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { isUndiscoveredSpotIndexFallbackEnabled } from "./undiscoveredTileManifest.service.js";

export type UnexploredSpotTileMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  firstActivity: string | null;
  emoji: string | null;
  iconKey: string | null;
  activity: string | null;
  sourceCollection: "unexploredSpots";
  itemType: "unexploredSpot";
  markerPriority: string | null;
  rank: number;
};

function readFirstActivity(data: Record<string, unknown>): string | null {
  if (typeof data.primaryActivity === "string" && data.primaryActivity.trim()) {
    return data.primaryActivity.trim();
  }
  const activities = data.activities;
  if (Array.isArray(activities) && typeof activities[0] === "string" && activities[0].trim()) {
    return activities[0].trim();
  }
  return null;
}

function tileItemToSpotMarker(
  item: UnexploredTile["items"][number],
): UnexploredSpotTileMarker | null {
  if (item.kind === "unexplored_route") return null;
  const lat = Number(item.lat ?? item.center?.lat);
  const lng = Number(item.lng ?? item.center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const firstActivity =
    (typeof item.primaryActivity === "string" && item.primaryActivity) ||
    (Array.isArray(item.activities) && item.activities[0]) ||
    null;
  const emoji = resolveMapLayerEmoji(
    emojiCandidatesFromDoc({
      category: item.category,
      primaryActivity: item.primaryActivity,
      activities: item.activities,
    }),
  );
  const rank = rankSpotForTile({
    displayPriority: item.displayPriority ?? null,
    displayName: item.displayName,
    id: item.id,
  });
  return {
    id: item.id,
    lat,
    lng,
    title: item.displayName,
    firstActivity,
    emoji,
    iconKey: firstActivity,
    activity: firstActivity,
    sourceCollection: "unexploredSpots",
    itemType: "unexploredSpot",
    markerPriority: item.displayPriority ?? null,
    rank,
  };
}

function spotDocToTileMarker(data: Record<string, unknown>): UnexploredSpotTileMarker | null {
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) return null;
  const lat = Number(data.lat ?? (data.location as { lat?: unknown } | undefined)?.lat);
  const lng = Number(
    data.lng ??
      data.long ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!isUndiscoveredFirestoreMapEligible(data)) return null;
  const firstActivity = readFirstActivity(data);
  const title =
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.title === "string" && data.title) ||
    id;
  const emoji = resolveMapLayerEmoji(emojiCandidatesFromDoc(data));
  const rank = rankSpotForTile({
    displayPriority:
      typeof data.displayPriority === "string" ? data.displayPriority : null,
    locavaScore: typeof data.locavaScore === "number" ? data.locavaScore : null,
    displayName: title,
    id,
  });
  return {
    id,
    lat,
    lng,
    title,
    firstActivity,
    emoji,
    iconKey: firstActivity,
    activity: firstActivity,
    sourceCollection: "unexploredSpots",
    itemType: "unexploredSpot",
    markerPriority:
      typeof data.displayPriority === "string" ? data.displayPriority : null,
    rank,
  };
}

function capAndSortSpots(
  spots: UnexploredSpotTileMarker[],
  tileZ: number,
): { spots: UnexploredSpotTileMarker[]; capped: boolean; tileLimit: number } {
  const tileLimit = maxUnexploredSpotsPerTile(tileZ);
  const sorted = [...spots].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  if (sorted.length <= tileLimit) {
    return { spots: sorted, capped: false, tileLimit };
  }
  return { spots: sorted.slice(0, tileLimit), capped: true, tileLimit };
}

export async function fetchUnexploredSpotTile(input: {
  z: number;
  x: number;
  y: number;
}): Promise<{
  tileKey: string;
  spots: UnexploredSpotTileMarker[];
  source: "tile_doc" | "spot_index" | "empty";
  dbReads: number;
  capped: boolean;
  tileLimit: number;
}> {
  const tileKey = formatTileKey(input.z, input.x, input.y);
  let dbReads = 0;
  const markers: UnexploredSpotTileMarker[] = [];
  const seen = new Set<string>();

  const tiles = await getUnexploredTilesByKeys([tileKey]);
  dbReads += tiles.length > 0 ? 1 : 0;
  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      const marker = tileItemToSpotMarker(item);
      if (!marker || seen.has(marker.id)) continue;
      seen.add(marker.id);
      markers.push(marker);
    }
  }

  let source: "tile_doc" | "spot_index" | "empty" = markers.length > 0 ? "tile_doc" : "empty";

  if (markers.length === 0) {
    const spotIndexFallback = await isUndiscoveredSpotIndexFallbackEnabled();
    if (!spotIndexFallback) {
      const cappedResult = capAndSortSpots(markers, input.z);
      return {
        tileKey,
        spots: cappedResult.spots,
        source: "empty",
        dbReads,
        capped: cappedResult.capped,
        tileLimit: cappedResult.tileLimit,
      };
    }
    const tileLimit = maxUnexploredSpotsPerTile(input.z);
    const docs = await queryUnexploredSpotsByTileKey(tileKey, tileLimit);
    dbReads += docs.length;
    for (const doc of docs) {
      const marker = spotDocToTileMarker(doc);
      if (!marker || seen.has(marker.id)) continue;
      seen.add(marker.id);
      markers.push(marker);
    }
    if (markers.length > 0) source = "spot_index";
  }

  const cappedResult = capAndSortSpots(markers, input.z);
  return {
    tileKey,
    spots: cappedResult.spots,
    source,
    dbReads,
    capped: cappedResult.capped,
    tileLimit: cappedResult.tileLimit,
  };
}
