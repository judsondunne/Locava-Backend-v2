import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";

export type OffroadGeojsonSourceInput = {
  filePath: string;
  sourceLabel: string;
  sourceDatasetName: string;
  state: "VT" | "NH" | string;
  regionBbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  importRunId: string;
};

export type OffroadGeojsonFeatureProperties = Record<string, unknown>;

export type OffroadGeojsonImportResult = {
  routes: LocavaInventoryRoute[];
  rejected: Array<{ reason: string; properties: OffroadGeojsonFeatureProperties }>;
};
