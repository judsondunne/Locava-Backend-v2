import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptPbfEntityToOverpassElement } from "../src/lib/openstreetmap/pbf/pbfElementAdapter.js";
import { buildPbfAdapterMetadata, defaultPbfFeatureReaderFactory } from "../src/lib/openstreetmap/pbf/pbfFeatureReader.js";
import { createPbfTagFilter, resolvePbfTagFilterPolicy } from "../src/lib/openstreetmap/pbf/pbfTagFilter.js";
import { isPbfEntitySupportedForCopier } from "../src/lib/openstreetmap/pbf/pbfElementAdapter.js";
import { DEFAULT_PBF_COPIER_CONFIG } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PBF = path.join(ROOT, "data/osm/vermont-latest.osm.pbf");
const NEEDLE = process.argv[2] ?? "Howland";

async function main() {
  const tagFilter = createPbfTagFilter(resolvePbfTagFilterPolicy(DEFAULT_PBF_COPIER_CONFIG));
  const reader = await defaultPbfFeatureReaderFactory({ filePath: PBF });
  await reader.open({ filePath: PBF });
  const meta = buildPbfAdapterMetadata({ filePath: PBF });
  let n = 0;
  for await (const chunk of reader.read()) {
    for (const entity of chunk.entities) {
      if (!isPbfEntitySupportedForCopier(entity)) continue;
      const name = entity.tags?.name ?? "";
      if (!name.toLowerCase().includes(NEEDLE.toLowerCase())) continue;
      n++;
      const lat = entity.type === "node" ? entity.lat : null;
      const lon = entity.type === "node" ? entity.lon : null;
      console.log(entity.type, entity.id, name, lat != null ? `${lat},${lon}` : "", entity.tags);
      if (n >= 20) break;
    }
    if (n >= 20) break;
  }
  await reader.close();
  console.log("matches", n);
}

main();
