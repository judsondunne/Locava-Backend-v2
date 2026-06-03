/**
 * Find amenity=parking and trail names near Mt Tom in Vermont PBF.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptPbfEntityToOverpassElement } from "../src/lib/openstreetmap/pbf/pbfElementAdapter.js";
import { buildPbfAdapterMetadata, defaultPbfFeatureReaderFactory } from "../src/lib/openstreetmap/pbf/pbfFeatureReader.js";
import { createPbfTagFilter, resolvePbfTagFilterPolicy } from "../src/lib/openstreetmap/pbf/pbfTagFilter.js";
import { parseOverpassElement } from "../src/lib/openstreetmap/osmFeatureParse.js";
import { isPbfEntitySupportedForCopier } from "../src/lib/openstreetmap/pbf/pbfElementAdapter.js";
import { osmFeatureWithinViewportBbox, viewportBboxToInventoryBbox } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";
import { DEFAULT_PBF_COPIER_CONFIG } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PBF = path.join(ROOT, "data/osm/vermont-latest.osm.pbf");
const BBOX = { westLng: -72.58, southLat: 43.6, eastLng: -72.48, northLat: 43.66 };
const inv = viewportBboxToInventoryBbox(BBOX);

async function main() {
  const tagFilter = createPbfTagFilter(resolvePbfTagFilterPolicy(DEFAULT_PBF_COPIER_CONFIG));
  const reader = await defaultPbfFeatureReaderFactory({ filePath: PBF });
  await reader.open({ filePath: PBF });
  const meta = buildPbfAdapterMetadata({ filePath: PBF });
  const parking: string[] = [];
  const carriage: string[] = [];
  for await (const chunk of reader.read()) {
    for (const entity of chunk.entities) {
      if (!isPbfEntitySupportedForCopier(entity)) continue;
      if (!tagFilter.isCandidate(entity.tags)) continue;
      const adapted = adaptPbfEntityToOverpassElement(entity, meta);
      if (!adapted) continue;
      const f = parseOverpassElement(adapted.element);
      if (!f || !osmFeatureWithinViewportBbox(f, inv)) continue;
      const name = f.name || entity.tags?.name || "";
      const amenity = entity.tags?.amenity || "";
      const highway = entity.tags?.highway || "";
      if (amenity === "parking" || name.toLowerCase().includes("parking")) {
        parking.push(`${name || "(unnamed)"} ${entity.type}/${entity.id} ${f.lat.toFixed(5)},${f.lng.toFixed(5)}`);
      }
      if (/carriage|mountain road/i.test(name) || /carriage/i.test(entity.tags?.name ?? "")) {
        carriage.push(`${name} ${entity.type}/${entity.id} hw=${highway}`);
      }
    }
  }
  await reader.close();
  console.log("Parking candidates:", parking.length);
  parking.forEach((p) => console.log(" ", p));
  console.log("\nCarriage/Mountain Road:", carriage.length);
  carriage.forEach((c) => console.log(" ", c));
}

main();
