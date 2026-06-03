export { importVtClass4RoadsGeojson } from "./vtClass4RoadsSource.js";
export { importNhClass6RoadsGeojson } from "./nhClass6RoadsSource.js";
export type { OffroadGeojsonImportResult, OffroadGeojsonSourceInput } from "./offroadSource.types.js";

import fs from "node:fs/promises";
import { classifyOffroadCandidate } from "../inventoryOffroadClassifier.js";
import type { OsmFeatureListItem } from "../../../openstreetmap/osmFeatureParse.js";
import { assembleOffroadRoutes } from "../inventoryOffroadAssembler.js";

export async function importGenericOffroadGeojson(input: {
  filePath: string;
  importRunId: string;
}): Promise<ReturnType<typeof assembleOffroadRoutes>> {
  const raw = await fs.readFile(input.filePath, "utf8");
  const geo = JSON.parse(raw) as {
    features?: Array<{
      properties?: Record<string, string>;
      geometry?: { type?: string; coordinates?: number[][] | number[][][] };
    }>;
  };

  const features: OsmFeatureListItem[] = [];
  let idx = 0;
  for (const f of geo.features ?? []) {
    const geom = f.geometry;
    let coords: Array<{ lat: number; lng: number }> = [];
    if (geom?.type === "LineString" && Array.isArray(geom.coordinates)) {
      coords = (geom.coordinates as number[][]).map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
    } else if (geom?.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
      coords = ((geom.coordinates as number[][][])[0] ?? []).map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
    }
    if (coords.length < 2) continue;
    features.push({
      id: `geojson/${idx}`,
      osmType: "way",
      osmId: idx,
      name: f.properties?.name ?? "Offroad segment",
      hasRealName: Boolean(f.properties?.name),
      featureType: "highway=track",
      lat: coords[0]!.lat,
      lng: coords[0]!.lng,
      coordSource: "line_center",
      geometryKind: "line",
      coordinates: coords,
      closed: false,
      tags: f.properties ?? {},
    });
    idx += 1;
  }

  return assembleOffroadRoutes({
    features,
    usedSourceKeys: new Set(),
    accessFeatures: [],
    importRunId: input.importRunId,
  });
}

export { classifyOffroadCandidate };
