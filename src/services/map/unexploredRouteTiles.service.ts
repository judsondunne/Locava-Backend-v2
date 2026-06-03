import type { UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import {
  emojiCandidatesFromDoc,
  resolveMapLayerEmoji,
} from "../../lib/map/mapLayerActivityEmoji.js";
import { isUndiscoveredFirestoreMapEligible } from "../../lib/map/undiscoveredFirestoreEligibility.js";
import {
  buildRouteSummaryForMapMarker,
  routeMapPreviewFromDoc,
} from "../../lib/map/unexploredRouteMapGeometry.js";
import {
  maxUnexploredRoutesPerTile,
  rankRouteForTile,
} from "../../lib/map/unexploredRouteTileZoom.js";
import { formatTileKey } from "../../lib/inventory/inventoryTileGrid.js";
import {
  getUnexploredTilesByKeys,
  queryUnexploredRoutesByTileKey,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";

export type UnexploredRouteTileMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  firstActivity: string | null;
  emoji: string | null;
  iconKey: string | null;
  activity: string | null;
  sourceCollection: "unexploredRoutes";
  itemType: "unexploredRoute";
  markerPriority: string | null;
  rank: number;
  routeSummary: Record<string, unknown> | null;
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

function buildRouteSummaryFromItem(
  item: UnexploredTile["items"][number],
  doc?: Record<string, unknown>,
): Record<string, unknown> | null {
  const data = doc ?? {
    encodedPolyline: item.encodedPolyline ?? null,
    bbox: item.bbox ?? null,
    geometry: item.encodedPolyline ? { encodedPolyline: item.encodedPolyline } : undefined,
    coordinatesPreview: undefined,
  };
  const preview = routeMapPreviewFromDoc(data);
  if (preview.length < 2) return null;
  return buildRouteSummaryForMapMarker({ data, preview });
}

function tileItemToRouteMarker(
  item: UnexploredTile["items"][number],
): UnexploredRouteTileMarker | null {
  if (item.kind !== "unexplored_route") return null;
  const lat = Number(item.center?.lat ?? item.lat);
  const lng = Number(item.center?.lng ?? item.lng);
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
  const rank = rankRouteForTile({
    displayPriority: item.displayPriority ?? null,
    displayName: item.displayName,
    id: item.id,
  });
  const routeSummary = buildRouteSummaryFromItem(item);
  return {
    id: item.id,
    lat,
    lng,
    title: item.displayName,
    firstActivity,
    emoji,
    iconKey: firstActivity,
    activity: firstActivity,
    sourceCollection: "unexploredRoutes",
    itemType: "unexploredRoute",
    markerPriority: item.displayPriority ?? null,
    rank,
    routeSummary,
  };
}

function routeDocToTileMarker(data: Record<string, unknown>): UnexploredRouteTileMarker | null {
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) return null;
  if (!isUndiscoveredFirestoreMapEligible(data)) return null;
  const center = data.center as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(center?.lat ?? data.lat);
  const lng = Number(center?.lng ?? data.lng ?? data.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const firstActivity = readFirstActivity(data);
  const title =
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.title === "string" && data.title) ||
    id;
  const emoji = resolveMapLayerEmoji(emojiCandidatesFromDoc(data));
  const rank = rankRouteForTile({
    displayPriority:
      typeof data.displayPriority === "string" ? data.displayPriority : null,
    locavaScore: typeof data.locavaScore === "number" ? data.locavaScore : null,
    displayName: title,
    id,
  });
  const preview = routeMapPreviewFromDoc(data);
  const routeSummary =
    preview.length >= 2 ? buildRouteSummaryForMapMarker({ data, preview }) : null;
  return {
    id,
    lat,
    lng,
    title,
    firstActivity,
    emoji,
    iconKey: firstActivity,
    activity: firstActivity,
    sourceCollection: "unexploredRoutes",
    itemType: "unexploredRoute",
    markerPriority:
      typeof data.displayPriority === "string" ? data.displayPriority : null,
    rank,
    routeSummary,
  };
}

function capAndSortRoutes(
  routes: UnexploredRouteTileMarker[],
  tileZ: number,
): { routes: UnexploredRouteTileMarker[]; capped: boolean; tileLimit: number } {
  const tileLimit = maxUnexploredRoutesPerTile(tileZ);
  const sorted = [...routes].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  if (sorted.length <= tileLimit) {
    return { routes: sorted, capped: false, tileLimit };
  }
  return { routes: sorted.slice(0, tileLimit), capped: true, tileLimit };
}

export async function fetchUnexploredRouteTile(input: {
  z: number;
  x: number;
  y: number;
}): Promise<{
  tileKey: string;
  routes: UnexploredRouteTileMarker[];
  source: "tile_doc" | "route_index" | "empty";
  dbReads: number;
  capped: boolean;
  tileLimit: number;
}> {
  const tileKey = formatTileKey(input.z, input.x, input.y);
  let dbReads = 0;
  const markers: UnexploredRouteTileMarker[] = [];
  const seen = new Set<string>();

  const tiles = await getUnexploredTilesByKeys([tileKey]);
  dbReads += tiles.length > 0 ? 1 : 0;
  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      const marker = tileItemToRouteMarker(item);
      if (!marker || seen.has(marker.id)) continue;
      seen.add(marker.id);
      markers.push(marker);
    }
  }

  let source: "tile_doc" | "route_index" | "empty" = markers.length > 0 ? "tile_doc" : "empty";

  if (markers.length === 0) {
    const tileLimit = maxUnexploredRoutesPerTile(input.z);
    const docs = await queryUnexploredRoutesByTileKey(tileKey, tileLimit);
    dbReads += docs.length;
    for (const doc of docs) {
      const marker = routeDocToTileMarker(doc);
      if (!marker || seen.has(marker.id)) continue;
      seen.add(marker.id);
      markers.push(marker);
    }
    if (markers.length > 0) source = "route_index";
  }

  const cappedResult = capAndSortRoutes(markers, input.z);
  return {
    tileKey,
    routes: cappedResult.routes,
    source,
    dbReads,
    capped: cappedResult.capped,
    tileLimit: cappedResult.tileLimit,
  };
}
