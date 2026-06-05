/**
 * Admin map preview — load live Firestore undiscovered spots/routes for PBF Copier V2 dashboard.
 */
import {
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../../../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { getFirestoreSourceClient } from "../../../../repositories/source-of-truth/firestore-client.js";
import { incrementDbOps } from "../../../../observability/request-context.js";
import {
  routeMapPreviewFromDoc,
} from "../../../../lib/map/unexploredRouteMapGeometry.js";

/** Vermont — default query region for full-run writes. */
export const VERMONT_UNDISCOVERED_BBOX = {
  minLat: 42.73,
  minLng: -73.44,
  maxLat: 45.02,
  maxLng: -71.46,
};

export type UndiscoveredMapPreviewSpot = {
  id: string;
  lat: number;
  lng: number;
  displayName: string;
  primaryActivity: string | null;
  publicMapEligible: boolean;
  mapReadiness: string | null;
};

export type UndiscoveredMapPreviewRoute = {
  id: string;
  lat: number;
  lng: number;
  displayName: string;
  primaryActivity: string | null;
  routeLineCoordinates: Array<{ lat: number; lng: number }>;
  publicMapEligible: boolean;
  mapReadiness: string | null;
};

export type UndiscoveredMapPreview = {
  bounds: {
    westLng: number;
    southLat: number;
    eastLng: number;
    northLat: number;
  } | null;
  center: { lat: number; lng: number } | null;
  spots: UndiscoveredMapPreviewSpot[];
  routes: UndiscoveredMapPreviewRoute[];
  counts: { spots: number; routes: number; total: number };
  queryBbox: typeof VERMONT_UNDISCOVERED_BBOX;
};

function readSpotLatLng(data: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = Number(data.lat ?? (data.location as { lat?: unknown } | undefined)?.lat);
  const lng = Number(
    data.lng ??
      data.long ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.lng ??
      (data.location as { lng?: unknown; long?: unknown } | undefined)?.long,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function readRouteAnchor(data: Record<string, unknown>): { lat: number; lng: number } | null {
  const center = data.center as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(center?.lat ?? data.lat);
  const lng = Number(center?.lng ?? data.lng ?? data.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function computeBounds(
  points: Array<{ lat: number; lng: number }>,
): UndiscoveredMapPreview["bounds"] {
  if (points.length === 0) return null;
  let westLng = Infinity;
  let eastLng = -Infinity;
  let southLat = Infinity;
  let northLat = -Infinity;
  for (const p of points) {
    westLng = Math.min(westLng, p.lng);
    eastLng = Math.max(eastLng, p.lng);
    southLat = Math.min(southLat, p.lat);
    northLat = Math.max(northLat, p.lat);
  }
  const padLat = Math.max(0.02, (northLat - southLat) * 0.06);
  const padLng = Math.max(0.02, (eastLng - westLng) * 0.06);
  return {
    westLng: westLng - padLng,
    southLat: southLat - padLat,
    eastLng: eastLng + padLng,
    northLat: northLat + padLat,
  };
}

export async function getUndiscoveredMapPreviewForAdmin(
  bbox = VERMONT_UNDISCOVERED_BBOX,
): Promise<UndiscoveredMapPreview> {
  const spotsRaw = await queryUnexploredSpotsInBbox({
    bbox,
    limit: 4000,
    publicOnly: false,
  });
  const routesRaw = await queryUnexploredRoutesInBbox({
    bbox,
    limit: 2000,
    publicOnly: false,
  });

  const spots: UndiscoveredMapPreviewSpot[] = [];
  const routes: UndiscoveredMapPreviewRoute[] = [];
  const boundsPoints: Array<{ lat: number; lng: number }> = [];

  for (const data of spotsRaw) {
    const coords = readSpotLatLng(data);
    if (!coords) continue;
    boundsPoints.push(coords);
    spots.push({
      id: String(data.id ?? ""),
      lat: coords.lat,
      lng: coords.lng,
      displayName:
        (typeof data.displayName === "string" && data.displayName) ||
        (typeof data.title === "string" && data.title) ||
        String(data.id ?? "spot"),
      primaryActivity:
        typeof data.primaryActivity === "string" ? data.primaryActivity : null,
      publicMapEligible: data.publicMapEligible === true,
      mapReadiness: typeof data.mapReadiness === "string" ? data.mapReadiness : null,
    });
  }

  for (const data of routesRaw) {
    const preview = routeMapPreviewFromDoc(data);
    const anchor = readRouteAnchor(data) ?? preview[0] ?? null;
    if (!anchor) continue;
    boundsPoints.push(anchor);
    for (const p of preview.slice(0, 120)) boundsPoints.push(p);
    routes.push({
      id: String(data.id ?? ""),
      lat: anchor.lat,
      lng: anchor.lng,
      displayName:
        (typeof data.displayName === "string" && data.displayName) ||
        (typeof data.title === "string" && data.title) ||
        String(data.id ?? "route"),
      primaryActivity:
        typeof data.primaryActivity === "string" ? data.primaryActivity : null,
      routeLineCoordinates: preview.slice(0, 500),
      publicMapEligible: data.publicMapEligible === true,
      mapReadiness: typeof data.mapReadiness === "string" ? data.mapReadiness : null,
    });
  }

  const bounds = computeBounds(boundsPoints);
  const center = bounds
    ? {
        lat: (bounds.southLat + bounds.northLat) / 2,
        lng: (bounds.westLng + bounds.eastLng) / 2,
      }
    : null;

  return {
    bounds,
    center,
    spots,
    routes,
    counts: {
      spots: spots.length,
      routes: routes.length,
      total: spots.length + routes.length,
    },
    queryBbox: bbox,
  };
}

function isPbfV2CopierWriteDoc(data: Record<string, unknown>): boolean {
  const audit = data.audit as { createdBy?: unknown } | undefined;
  if (audit?.createdBy === "pbf_copier_v2") return true;
  const importMeta = data.import as { chunkId?: unknown } | undefined;
  return typeof importMeta?.chunkId === "string" && importMeta.chunkId.includes("pbf_v2_write");
}

/** Patch existing PBF V2 writes to map-ready fields (publicMapEligible + mapReadiness ready). */
export async function repairPbfV2MapVisibility(input: {
  dryRun?: boolean;
}): Promise<{ dryRun: boolean; spotsUpdated: number; routesUpdated: number }> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const dryRun = input.dryRun === true;
  let spotsUpdated = 0;
  let routesUpdated = 0;

  const patchDoc = async (
    collection: "unexploredSpots" | "unexploredRoutes",
    data: Record<string, unknown>,
    docId: string,
  ): Promise<void> => {
    if (!isPbfV2CopierWriteDoc(data)) return;
    if (data.publicMapEligible === true && data.mapReadiness === "ready") return;
    if (!dryRun) {
      incrementDbOps("writes", 1);
      await db.collection(collection).doc(docId).set(
        {
          publicMapEligible: true,
          mapReadiness: "ready",
          status: {
            ...(typeof data.status === "object" && data.status ? (data.status as object) : {}),
            publicMapEligible: true,
            mapReadiness: "ready",
          },
          audit: {
            ...(typeof data.audit === "object" && data.audit ? (data.audit as object) : {}),
            updatedAt: new Date().toISOString(),
          },
        },
        { merge: true },
      );
    }
    if (collection === "unexploredSpots") spotsUpdated += 1;
    else routesUpdated += 1;
  };

  const spots = await queryUnexploredSpotsInBbox({
    bbox: VERMONT_UNDISCOVERED_BBOX,
    limit: 4000,
    publicOnly: false,
  });
  for (const data of spots) {
    const id = String(data.id ?? "");
    if (!id) continue;
    await patchDoc("unexploredSpots", data, id);
  }

  const routes = await queryUnexploredRoutesInBbox({
    bbox: VERMONT_UNDISCOVERED_BBOX,
    limit: 2000,
    publicOnly: false,
  });
  for (const data of routes) {
    const id = String(data.id ?? "");
    if (!id) continue;
    await patchDoc("unexploredRoutes", data, id);
  }

  return { dryRun, spotsUpdated, routesUpdated };
}
