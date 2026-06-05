import type { UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import { tilesForViewport } from "../../lib/inventory/inventoryTileGrid.js";
import {
  buildRouteSummaryForMapMarker,
  routeMapPreviewFromDoc,
  routeMapPreviewFromDocResolved,
} from "../../lib/map/unexploredRouteMapGeometry.js";
import {
  emojiCandidatesFromDoc,
  resolveMapLayerEmoji,
} from "../../lib/map/mapLayerActivityEmoji.js";
import {
  getUnexploredTilesByKeys,
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { resolveUnexploredItemById } from "./unexploredMapMarkerByIdResolver.js";

export type UnexploredMapMarkerSummary = {
  id: string;
  sourceCollection: "unexploredSpots" | "unexploredRoutes";
  itemType: "unexploredSpot" | "unexploredRoute";
  title: string;
  lat: number;
  lng: number;
  firstActivity: string | null;
  emoji: string | null;
  hasMedia: boolean;
  isUnexplored: true;
  isRoute: boolean;
  routeSummary?: Record<string, unknown> | null;
  markerPriority?: string | null;
};

function activityEmojiForDoc(data: Record<string, unknown>): string {
  return resolveMapLayerEmoji(emojiCandidatesFromDoc(data));
}

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

function markerKey(marker: Pick<UnexploredMapMarkerSummary, "sourceCollection" | "itemType" | "id">): string {
  return `${marker.sourceCollection}:${marker.itemType}:${marker.id}`;
}

function itemLatLng(item: UnexploredTile["items"][number]): { lat: number; lng: number } | null {
  if (typeof item.lat === "number" && typeof item.lng === "number") {
    return { lat: item.lat, lng: item.lng };
  }
  if (item.center && typeof item.center.lat === "number" && typeof item.center.lng === "number") {
    return { lat: item.center.lat, lng: item.center.lng };
  }
  return null;
}

function tileItemToMarker(
  item: UnexploredTile["items"][number],
  opts?: { includeRouteGeometry?: boolean },
): UnexploredMapMarkerSummary | null {
  const coords = itemLatLng(item);
  if (!coords) return null;
  const firstActivity =
    (typeof item.primaryActivity === "string" && item.primaryActivity) ||
    (Array.isArray(item.activities) && item.activities[0]) ||
    null;
  const isRoute = item.kind === "unexplored_route";
  return {
    id: item.id,
    sourceCollection: isRoute ? "unexploredRoutes" : "unexploredSpots",
    itemType: isRoute ? "unexploredRoute" : "unexploredSpot",
    title: item.displayName,
    lat: coords.lat,
    lng: coords.lng,
    firstActivity,
    emoji: activityEmojiForDoc({
      category: item.category,
      primaryActivity: item.primaryActivity,
      activities: item.activities,
    }),
    hasMedia: false,
    isUnexplored: true,
    isRoute,
    routeSummary:
      isRoute && opts?.includeRouteGeometry !== false
        ? buildRouteSummaryForMapMarker({
            data: {
              encodedPolyline: item.encodedPolyline ?? null,
              bbox: item.bbox ?? null,
            },
            preview: item.encodedPolyline
              ? routeMapPreviewFromDoc({ encodedPolyline: item.encodedPolyline })
              : [],
          })
        : null,
    markerPriority: item.displayPriority ?? null,
  };
}

function spotDocToMarker(data: Record<string, unknown>): UnexploredMapMarkerSummary | null {
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) return null;
  const lat = Number(
    data.lat ?? (data.location as { lat?: unknown } | undefined)?.lat,
  );
  const lng = Number(
    data.lng ??
      data.long ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const firstActivity = readFirstActivity(data);
  const title =
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.title === "string" && data.title) ||
    id;
  return {
    id,
    sourceCollection: "unexploredSpots",
    itemType: "unexploredSpot",
    title,
    lat,
    lng,
    firstActivity,
    emoji: activityEmojiForDoc(data),
    hasMedia: false,
    isUnexplored: true,
    isRoute: false,
    routeSummary: null,
    markerPriority:
      typeof data.displayPriority === "string" ? data.displayPriority : null,
  };
}

function routeAnchorFromDoc(data: Record<string, unknown>): { lat: number; lng: number } | null {
  const center = data.center as { lat?: unknown; lng?: unknown } | undefined;
  const location = data.location as { lat?: unknown; lng?: unknown } | undefined;
  const routeMarkerCoordinate = data.routeMarkerCoordinate as
    | { lat?: unknown; lng?: unknown }
    | undefined;
  const lat = Number(
    routeMarkerCoordinate?.lat ??
      center?.lat ??
      location?.lat ??
      data.lat ??
      (data.location as { lat?: unknown } | undefined)?.lat,
  );
  const lng = Number(
    routeMarkerCoordinate?.lng ??
      center?.lng ??
      location?.lng ??
      data.lng ??
      data.long ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function routeDocToMarker(
  data: Record<string, unknown>,
  opts?: { includeRouteGeometry?: boolean },
): Promise<UnexploredMapMarkerSummary | null> {
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) return null;
  const includeGeometry = opts?.includeRouteGeometry !== false;
  let preview = includeGeometry ? routeMapPreviewFromDoc(data) : [];
  if (includeGeometry && preview.length < 2) {
    preview = await routeMapPreviewFromDocResolved(data);
  }
  const anchor = preview[0] ?? routeAnchorFromDoc(data);
  if (!anchor) return null;
  const lat = Number(anchor.lat);
  const lng = Number("lng" in anchor ? anchor.lng : (anchor as { lon?: number }).lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const firstActivity = readFirstActivity(data);
  const title =
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.title === "string" && data.title) ||
    id;
  return {
    id,
    sourceCollection: "unexploredRoutes",
    itemType: "unexploredRoute",
    title,
    lat,
    lng,
    firstActivity,
    emoji: activityEmojiForDoc(data),
    hasMedia: false,
    isUnexplored: true,
    isRoute: true,
    routeSummary:
      includeGeometry && preview.length >= 2
        ? buildRouteSummaryForMapMarker({ data, preview })
        : null,
    markerPriority:
      typeof data.displayPriority === "string" ? data.displayPriority : null,
  };
}

function pushMarker(
  seen: Set<string>,
  markers: UnexploredMapMarkerSummary[],
  marker: UnexploredMapMarkerSummary | null,
  limit: number,
): void {
  if (!marker) return;
  const key = markerKey(marker);
  if (seen.has(key)) return;
  seen.add(key);
  markers.push(marker);
  if (markers.length >= limit) return;
}

export async function fetchUnexploredSpotMarkerSummaries(input: {
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  zoom?: number;
  limit?: number;
}): Promise<{
  markers: UnexploredMapMarkerSummary[];
  tileKeys: string[];
  tileCount: number;
  droppedMissingCoords: number;
  fromTiles: number;
  fromSpotsQuery: number;
}> {
  const zoom = input.zoom ?? 13;
  const limit = Math.max(1, Math.min(input.limit ?? 2000, 4000));
  const tileKeys = tilesForViewport(
    {
      minLat: input.bbox.minLat,
      minLng: input.bbox.minLng,
      maxLat: input.bbox.maxLat,
      maxLng: input.bbox.maxLng,
    },
    zoom,
  ).map((t) => t.tileKey);

  const tiles = await getUnexploredTilesByKeys(tileKeys);
  const seen = new Set<string>();
  const markers: UnexploredMapMarkerSummary[] = [];
  let droppedMissingCoords = 0;
  let fromTiles = 0;

  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      if (markers.length >= limit) break;
      if (item.kind === "unexplored_route") continue;
      const marker = tileItemToMarker(item, { includeRouteGeometry: false });
      if (!marker) {
        droppedMissingCoords += 1;
        continue;
      }
      const before = markers.length;
      pushMarker(seen, markers, marker, limit);
      if (markers.length > before) fromTiles += 1;
    }
    if (markers.length >= limit) break;
  }

  let fromSpotsQuery = 0;
  if (markers.length < limit) {
    const spotDocs = await queryUnexploredSpotsInBbox({
      bbox: input.bbox,
      limit,
      publicOnly: true,
    });
    for (const doc of spotDocs) {
      if (markers.length >= limit) break;
      const before = markers.length;
      pushMarker(seen, markers, spotDocToMarker(doc), limit);
      if (markers.length > before) fromSpotsQuery += 1;
    }
  }

  return {
    markers,
    tileKeys,
    tileCount: tiles.length,
    droppedMissingCoords,
    fromTiles,
    fromSpotsQuery,
  };
}

export async function fetchUnexploredRouteMarkerSummaries(input: {
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  zoom?: number;
  limit?: number;
  includeRouteGeometry?: boolean;
}): Promise<{
  markers: UnexploredMapMarkerSummary[];
  tileKeys: string[];
  tileCount: number;
  droppedMissingCoords: number;
  fromTiles: number;
  fromRoutesQuery: number;
}> {
  const zoom = input.zoom ?? 13;
  const limit = Math.max(1, Math.min(input.limit ?? 2000, 4000));
  const includeRouteGeometry = input.includeRouteGeometry !== false;
  const tileKeys = tilesForViewport(
    {
      minLat: input.bbox.minLat,
      minLng: input.bbox.minLng,
      maxLat: input.bbox.maxLat,
      maxLng: input.bbox.maxLng,
    },
    zoom,
  ).map((t) => t.tileKey);

  const tiles = await getUnexploredTilesByKeys(tileKeys);
  const seen = new Set<string>();
  const markers: UnexploredMapMarkerSummary[] = [];
  let droppedMissingCoords = 0;
  let fromTiles = 0;

  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      if (markers.length >= limit) break;
      if (item.kind !== "unexplored_route") continue;
      const marker = tileItemToMarker(item, { includeRouteGeometry });
      if (!marker) {
        droppedMissingCoords += 1;
        continue;
      }
      const before = markers.length;
      pushMarker(seen, markers, marker, limit);
      if (markers.length > before) fromTiles += 1;
    }
    if (markers.length >= limit) break;
  }

  let fromRoutesQuery = 0;
  if (markers.length < limit) {
    const routeDocs = await queryUnexploredRoutesInBbox({
      bbox: input.bbox,
      limit: Math.min(2000, Math.max(1, limit - markers.length)),
      publicOnly: true,
    });
    for (const doc of routeDocs) {
      if (markers.length >= limit) break;
      const before = markers.length;
      pushMarker(seen, markers, await routeDocToMarker(doc, { includeRouteGeometry }), limit);
      if (markers.length > before) fromRoutesQuery += 1;
    }
  }

  return {
    markers,
    tileKeys,
    tileCount: tiles.length,
    droppedMissingCoords,
    fromTiles,
    fromRoutesQuery,
  };
}

export async function fetchUnexploredMapMarkerSummaries(input: {
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  zoom?: number;
  limit?: number;
  includeSpots?: boolean;
  includeRoutes?: boolean;
  includeRouteGeometry?: boolean;
}): Promise<{
  markers: UnexploredMapMarkerSummary[];
  tileKeys: string[];
  tileCount: number;
  droppedMissingCoords: number;
  fromTiles: number;
  fromSpotsQuery: number;
  fromRoutesQuery: number;
}> {
  const includeSpots = input.includeSpots !== false;
  const includeRoutes = input.includeRoutes !== false;
  const limit = Math.max(1, Math.min(input.limit ?? 2000, 4000));

  if (includeSpots && !includeRoutes) {
    const spots = await fetchUnexploredSpotMarkerSummaries(input);
    return { ...spots, fromRoutesQuery: 0 };
  }
  if (includeRoutes && !includeSpots) {
    const routes = await fetchUnexploredRouteMarkerSummaries({
      ...input,
      includeRouteGeometry: input.includeRouteGeometry,
    });
    return {
      markers: routes.markers,
      tileKeys: routes.tileKeys,
      tileCount: routes.tileCount,
      droppedMissingCoords: routes.droppedMissingCoords,
      fromTiles: routes.fromTiles,
      fromSpotsQuery: 0,
      fromRoutesQuery: routes.fromRoutesQuery,
    };
  }

  const zoom = input.zoom ?? 13;
  const tileKeys = tilesForViewport(
    {
      minLat: input.bbox.minLat,
      minLng: input.bbox.minLng,
      maxLat: input.bbox.maxLat,
      maxLng: input.bbox.maxLng,
    },
    zoom,
  ).map((t) => t.tileKey);

  const tiles = await getUnexploredTilesByKeys(tileKeys);
  const seen = new Set<string>();
  const markers: UnexploredMapMarkerSummary[] = [];
  let droppedMissingCoords = 0;
  let fromTiles = 0;

  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      if (markers.length >= limit) break;
      const marker = tileItemToMarker(item, {
        includeRouteGeometry: input.includeRouteGeometry,
      });
      if (!marker) {
        droppedMissingCoords += 1;
        continue;
      }
      const before = markers.length;
      pushMarker(seen, markers, marker, limit);
      if (markers.length > before) fromTiles += 1;
    }
    if (markers.length >= limit) break;
  }

  let fromSpotsQuery = 0;
  let fromRoutesQuery = 0;

  if (markers.length < limit) {
    const spotDocs = await queryUnexploredSpotsInBbox({
      bbox: input.bbox,
      limit,
      publicOnly: true,
    });
    for (const doc of spotDocs) {
      if (markers.length >= limit) break;
      const before = markers.length;
      pushMarker(seen, markers, spotDocToMarker(doc), limit);
      if (markers.length > before) fromSpotsQuery += 1;
    }
  }

  if (markers.length < limit) {
    const routeDocs = await queryUnexploredRoutesInBbox({
      bbox: input.bbox,
      limit: Math.min(2000, Math.max(1, limit - markers.length)),
      publicOnly: true,
    });
    for (const doc of routeDocs) {
      if (markers.length >= limit) break;
      const before = markers.length;
      pushMarker(
        seen,
        markers,
        await routeDocToMarker(doc, { includeRouteGeometry: input.includeRouteGeometry }),
        limit,
      );
      if (markers.length > before) fromRoutesQuery += 1;
    }
  }

  return {
    markers,
    tileKeys,
    tileCount: tiles.length,
    droppedMissingCoords,
    fromTiles,
    fromSpotsQuery,
    fromRoutesQuery,
  };
}

/** Resolve by id — Firestore doc, tile docs, or tile-index (same sources as map markers). */
export async function fetchUnexploredMapMarkerById(input: {
  id: string;
  sourceCollection?: "unexploredSpots" | "unexploredRoutes";
  itemType?: "unexploredSpot" | "unexploredRoute";
  includeRouteGeometry?: boolean;
  lat?: number;
  lng?: number;
}): Promise<UnexploredMapMarkerSummary | null> {
  const id = String(input.id ?? "").trim();
  if (!id) return null;

  const resolved = await resolveUnexploredItemById({
    id,
    lat: input.lat,
    lng: input.lng,
    sourceCollection: input.sourceCollection,
    itemType: input.itemType,
  });
  if (!resolved) return null;

  if (process.env.NODE_ENV !== "production" && resolved.resolvedFrom !== "firestore_doc") {
    console.info("[unexplored.marker_by_id]", {
      id,
      resolvedFrom: resolved.resolvedFrom,
      itemType: resolved.itemType,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    });
  }

  if (resolved.itemType === "unexploredRoute") {
    return routeDocToMarker(resolved.doc, {
      includeRouteGeometry: input.includeRouteGeometry !== false,
    });
  }

  return spotDocToMarker(resolved.doc);
}
