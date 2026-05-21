import fs from "node:fs/promises";
import path from "node:path";
import { isPointInsideBbox } from "../inventoryCoordinates.js";
import { ingestGeoJsonFeature, ingestOverpassElement, mergeIngestResults } from "../inventoryOsmIngest.js";
import type {
  InventoryImportInput,
  InventoryRawObject,
  InventorySourceAdapter,
} from "./inventorySource.types.js";

type GeoJsonFeature = {
  type: "Feature";
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
  id?: string | number;
};

type GeoJsonCollection = {
  type: "FeatureCollection";
  features?: GeoJsonFeature[];
};

type OverpassJson = {
  elements?: Array<{
    type: "node" | "way" | "relation";
    id: number | string;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon?: number; lng?: number }>;
    members?: Array<{ type: string; ref: number | string; role?: string }>;
  }>;
};

function filterByBbox(objects: InventoryRawObject[], bbox: InventoryImportInput["bbox"]): InventoryRawObject[] {
  const out: InventoryRawObject[] = [];
  for (const item of objects) {
    if (item.kind === "spot") {
      if (isPointInsideBbox({ lat: item.lat, lng: item.lng }, bbox)) out.push(item);
      continue;
    }
    const coords = item.coordinates;
    if (coords.length < 2) continue;
    const minLat = Math.min(...coords.map((c) => c.lat));
    const maxLat = Math.max(...coords.map((c) => c.lat));
    const minLng = Math.min(...coords.map((c) => c.lng));
    const maxLng = Math.max(...coords.map((c) => c.lng));
    const intersects = !(maxLat < bbox.minLat || minLat > bbox.maxLat || maxLng < bbox.minLng || minLng > bbox.maxLng);
    if (intersects) out.push(item);
  }
  return out;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw) as unknown;
}

export class OsmLikeGeojsonInventorySource implements InventorySourceAdapter {
  sourceName = "geojson";

  async loadRawObjects(input: InventoryImportInput): Promise<InventoryRawObject[]> {
    const filePath = input.geojsonPath?.trim();
    if (!filePath) throw new Error("geojsonPath is required for geojson source");
    const parsed = (await readJsonFile(filePath)) as GeoJsonCollection;
    const features = Array.isArray(parsed.features) ? parsed.features : [];
    const merged = mergeIngestResults(features.map((feature, index) => ingestGeoJsonFeature(feature, index)));
    const filtered = filterByBbox(merged.objects, input.bbox);
    const limit = input.limit ?? filtered.length;
    return filtered.slice(0, limit);
  }
}

export class OverpassJsonInventorySource implements InventorySourceAdapter {
  sourceName = "overpass_json_file";

  async loadRawObjects(input: InventoryImportInput): Promise<InventoryRawObject[]> {
    const filePath = input.overpassJsonPath?.trim() ?? input.geojsonPath?.trim();
    if (!filePath) throw new Error("overpassJsonPath is required for overpass_json_file source");
    const parsed = (await readJsonFile(filePath)) as OverpassJson;
    const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
    const merged = mergeIngestResults(elements.map((element) => ingestOverpassElement(element)));
    const filtered = filterByBbox(merged.objects, input.bbox);
    const limit = input.limit ?? filtered.length;
    return filtered.slice(0, limit);
  }
}

export const osmLikeGeojsonInventorySource = new OsmLikeGeojsonInventorySource();
export const overpassJsonInventorySource = new OverpassJsonInventorySource();
