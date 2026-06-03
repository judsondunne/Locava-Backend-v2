import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HOWLAND_DAM_VT_BBOX,
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

describe.skipIf(!hasPbf)("PBF Copier V2 — Howland Dam / Lake Pinneo VT (real vermont PBF)", () => {
  it(
    "returns spots and trails for Howland Dam viewport (not empty map)",
    async () => {
      const result = await scanPbfViewportPreview({
        pbfPath: VERMONT_PBF,
        bbox: HOWLAND_DAM_VT_BBOX,
        mode: "raw_osm",
      });

      expect(result.stats.previewMode).toBe("raw_osm");
      expect(result.items.length).toBeGreaterThan(80);
      expect(result.stats.itemsReturned).toBe(result.items.length);

      expect(namesContaining(result.items, "Howland").length).toBeGreaterThanOrEqual(1);

      const routes = result.items.filter((d) => d.kind === "unexplored_route");
      const routesWithLines = routes.filter(
        (d) => d.routeLineCoordinates && d.routeLineCoordinates.length >= 2
      );
      expect(routesWithLines.length).toBeGreaterThan(3);

      const nameCounts = new Map<string, number>();
      for (const route of routes) {
        const key = (route.displayName || "").toLowerCase().trim();
        if (!key) continue;
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      // Raw mode intentionally keeps duplicate-named segments.
      expect(nameCounts.size).toBeGreaterThan(0);
    },
    180_000
  );
});
