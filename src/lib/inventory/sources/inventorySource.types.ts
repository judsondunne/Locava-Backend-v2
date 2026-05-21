import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";

export type InventoryRawSpot = {
  kind: "spot";
  source: "osm" | "fixture" | "manual" | "other";
  sourceType?: "node" | "way" | "relation" | "fixture";
  sourceId: string;
  name?: string;
  lat: number;
  lng: number;
  bbox?: InventoryBbox;
  tags: Record<string, unknown>;
  attribution: {
    source: string;
    sourceId?: string;
    license?: string;
    url?: string;
  };
};

export type InventoryRawRoute = {
  kind: "route";
  source: "osm" | "fixture" | "manual" | "other";
  sourceType?: "way" | "relation" | "fixture";
  sourceId: string;
  name?: string;
  coordinates: Array<{ lat: number; lng: number }>;
  tags: Record<string, unknown>;
  attribution: {
    source: string;
    sourceId?: string;
    license?: string;
    url?: string;
  };
};

export type InventoryRawObject = InventoryRawSpot | InventoryRawRoute;

export type InventoryImportInput = {
  source: "fixture" | "geojson" | "overpass_json_file";
  regionKey: string;
  regionLabel: string;
  bbox: InventoryBbox;
  limit?: number;
  geojsonPath?: string;
  overpassJsonPath?: string;
};

export interface InventorySourceAdapter {
  sourceName: string;
  loadRawObjects(input: InventoryImportInput): Promise<InventoryRawObject[]>;
}
