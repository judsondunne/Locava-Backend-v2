import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MT_TOM_WOODSTOCK_VT_BBOX,
  scanPbfViewportPreview,
} from "./pbfCopierV2ViewportPreview.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const VERMONT_PBF = path.join(ROOT, "data/osm/vermont-latest.osm.pbf");
const hasPbf = fs.existsSync(VERMONT_PBF);

function namesContaining(items: { displayName?: string }[], needle: string): string[] {
  const n = needle.toLowerCase();
  return items
    .map((d) => d.displayName || "")
    .filter((name) => name.toLowerCase().includes(n));
}

function parkingItems(items: { displayName?: string; sourceTagSample?: Record<string, string> }[]) {
  return items.filter((d) => {
    const name = (d.displayName || "").toLowerCase();
    const tags = Object.entries(d.sourceTagSample || {})
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")
      .toLowerCase();
    return name.includes("parking") || tags.includes("amenity=parking") || tags.includes("parking=");
  });
}

describe.skipIf(!hasPbf)("PBF Copier V2 raw OSM — Mt Tom / Woodstock VT (real vermont PBF)", () => {
  it(
    "returns all OSM objects in bbox including trails, parking, and named places",
    async () => {
      const result = await scanPbfViewportPreview({
        pbfPath: VERMONT_PBF,
        bbox: MT_TOM_WOODSTOCK_VT_BBOX,
        mode: "raw_osm",
      });

      expect(result.items.length).toBeGreaterThan(800);
      expect(result.stats.previewMode).toBe("raw_osm");

      const routes = result.items.filter((d) => d.kind === "unexplored_route");
      expect(routes.length).toBeGreaterThan(100);

      expect(namesContaining(result.items, "North Ridge").length).toBeGreaterThanOrEqual(1);
      expect(namesContaining(result.items, "Faulkner Trail").length).toBeGreaterThanOrEqual(1);
      expect(namesContaining(result.items, "Mt Tom").length).toBeGreaterThanOrEqual(1);
      expect(namesContaining(result.items, "Billings Park").length).toBeGreaterThanOrEqual(1);
      expect(namesContaining(result.items, "The Pogue").length).toBeGreaterThanOrEqual(1);

      expect(namesContaining(result.items, "Laughlin").length +
        namesContaining(result.items, "McKnight").length +
        namesContaining(result.items, "Lingelbach").length
      ).toBeGreaterThanOrEqual(1);
    },
    180_000
  );
});
