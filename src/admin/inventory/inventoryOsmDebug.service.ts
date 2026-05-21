import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import { coordinateSanitySummary, isPointInsideBbox } from "../../lib/inventory/inventoryCoordinates.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT, resolveInventoryRegion } from "../../lib/inventory/inventoryBbox.js";
import { normalizeInventoryRawObjects } from "../../lib/inventory/inventoryNormalize.js";
import { buildInventoryImportRunId } from "../../lib/inventory/inventoryIds.js";
import { fixtureInventorySource } from "../../lib/inventory/sources/fixtureInventorySource.js";
import {
  osmLikeGeojsonInventorySource,
  overpassJsonInventorySource,
} from "../../lib/inventory/sources/osmLikeGeojsonInventorySource.js";
import type { InventoryImportInput, InventorySourceAdapter } from "../../lib/inventory/sources/inventorySource.types.js";

export type OsmDebugInput = {
  bbox?: InventoryBbox;
  regionKey?: string;
  source?: "fixture" | "geojson" | "overpass_json_file";
  limit?: number;
  geojsonPath?: string;
  overpassJsonPath?: string;
};

export type OsmDebugResult = {
  bbox: InventoryBbox;
  counts: {
    rawObjects: number;
    classifiedSpot: number;
    classifiedRoute: number;
    rejected: number;
    coordinateWarnings: number;
    likelySwappedCoordinates: number;
    missingGeometry: number;
    outsideBbox: number;
    duplicates: number;
  };
  coordinateSanity: {
    acceptedSpotRange: ReturnType<typeof coordinateSanitySummary>;
    acceptedRouteRange: ReturnType<typeof coordinateSanitySummary>;
    insideDefaultBboxSpots: number;
    insideDefaultBboxRoutes: number;
  };
  sampleSpots: Array<{
    name: string;
    category: string;
    lat: number;
    lng: number;
    sourceId: string;
    sourceType?: string;
  }>;
  sampleRoutes: Array<{
    name: string;
    activity: string;
    pointCount: number;
    bbox: InventoryBbox;
    sourceId: string;
    sourceType?: string;
  }>;
  sampleRejected: Array<{ code: string; message: string; sample?: unknown }>;
  coordinateWarnings: Array<{ code: string; message: string; context?: string; lat?: number; lng?: number }>;
};

function resolveAdapter(source: OsmDebugInput["source"]): InventorySourceAdapter {
  if (source === "geojson") return osmLikeGeojsonInventorySource;
  if (source === "overpass_json_file") return overpassJsonInventorySource;
  return fixtureInventorySource;
}

export async function runOsmDebugBbox(input: OsmDebugInput = {}): Promise<OsmDebugResult> {
  const region = resolveInventoryRegion(input.regionKey);
  const bbox = input.bbox ?? region.bbox;
  const importInput: InventoryImportInput = {
    source: input.source ?? "fixture",
    regionKey: region.regionKey,
    regionLabel: region.label,
    bbox,
    limit: input.limit,
    geojsonPath: input.geojsonPath,
    overpassJsonPath: input.overpassJsonPath,
  };

  const adapter = resolveAdapter(importInput.source);
  const rawObjects = await adapter.loadRawObjects(importInput);
  const normalized = normalizeInventoryRawObjects({
    rawObjects,
    regionKey: importInput.regionKey,
    regionBbox: bbox,
    importRunId: buildInventoryImportRunId(),
  });

  const defaultBbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;
  const insideDefaultBboxSpots = normalized.spots.filter((s) =>
    isPointInsideBbox({ lat: s.lat, lng: s.lng }, defaultBbox)
  ).length;
  const insideDefaultBboxRoutes = normalized.routes.filter((r) =>
    !(r.bbox.maxLat < defaultBbox.minLat || r.bbox.minLat > defaultBbox.maxLat || r.bbox.maxLng < defaultBbox.minLng || r.bbox.minLng > defaultBbox.maxLng)
  ).length;

  return {
    bbox,
    counts: {
      rawObjects: rawObjects.length,
      classifiedSpot: normalized.spots.length,
      classifiedRoute: normalized.routes.length,
      rejected: normalized.rejected.length,
      coordinateWarnings: normalized.coordinateWarnings.length,
      likelySwappedCoordinates: normalized.stats.likelySwappedCoordinates,
      missingGeometry: normalized.stats.missingGeometry,
      outsideBbox: normalized.stats.outsideBbox,
      duplicates: normalized.duplicates,
    },
    coordinateSanity: {
      acceptedSpotRange: coordinateSanitySummary(normalized.spots.map((s) => ({ lat: s.lat, lng: s.lng }))),
      acceptedRouteRange: coordinateSanitySummary(
        normalized.routes.flatMap((r) => r.coordinates ?? []).map((c) => ({ lat: c.lat, lng: c.lng }))
      ),
      insideDefaultBboxSpots,
      insideDefaultBboxRoutes,
    },
    sampleSpots: normalized.spots.slice(0, 15).map((s) => ({
      name: s.name,
      category: s.category,
      lat: s.lat,
      lng: s.lng,
      sourceId: s.sourceId,
      sourceType: s.sourceType,
    })),
    sampleRoutes: normalized.routes.slice(0, 10).map((r) => ({
      name: r.name,
      activity: r.activity,
      pointCount: r.coordinates?.length ?? 0,
      bbox: r.bbox,
      sourceId: r.sourceId,
      sourceType: r.sourceType,
    })),
    sampleRejected: normalized.rejected.slice(0, 20),
    coordinateWarnings: normalized.coordinateWarnings.slice(0, 20),
  };
}
