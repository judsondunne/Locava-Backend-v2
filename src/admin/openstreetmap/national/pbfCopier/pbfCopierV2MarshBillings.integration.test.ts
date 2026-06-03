import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MARSH_BILLINGS_ROCKEFELLER_VT_BBOX,
  scanPbfViewportPreview,
} from "./pbfCopierV2ViewportPreview.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const VERMONT_PBF = path.join(ROOT, "data/osm/vermont-latest.osm.pbf");
const hasPbf = fs.existsSync(VERMONT_PBF);

describe.skipIf(!hasPbf)("PBF Copier V2 raw OSM — Marsh-Billings-Rockefeller VT (real vermont PBF)", () => {
  it(
    "includes Barrette Family Interpretive Platform observation tower",
    async () => {
      const result = await scanPbfViewportPreview({
        pbfPath: VERMONT_PBF,
        bbox: MARSH_BILLINGS_ROCKEFELLER_VT_BBOX,
        mode: "raw_osm",
      });

      expect(result.stats.previewMode).toBe("raw_osm");
      expect(result.items.length).toBeGreaterThan(100);

      const barrette = result.items.filter((d) =>
        (d.displayName || "").toLowerCase().includes("barrette family interpretive")
      );
      expect(barrette.length).toBeGreaterThanOrEqual(1);
      expect(result.stats.hikingTrailGroupsMerged).toBeGreaterThanOrEqual(3);
      expect(result.stats.residentialHomesFiltered).toBeGreaterThan(0);
      expect(barrette[0]!.lat).toBeCloseTo(43.6429, 3);
      expect(barrette[0]!.lng).toBeCloseTo(-72.4087, 3);
    },
    120_000
  );
});
