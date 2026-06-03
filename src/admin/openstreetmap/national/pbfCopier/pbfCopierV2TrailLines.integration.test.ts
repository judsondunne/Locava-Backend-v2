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

function mergedTrail(items: { displayName?: string; warnings?: string[]; routeLineCoordinates?: unknown[]; routeLineSegments?: unknown[][] }[], needle: string) {
  return items.find(
    (d) =>
      d.warnings?.includes("v2_hiking_trail_merged") &&
      (d.displayName || "").toLowerCase().includes(needle.toLowerCase())
  );
}

function linePointCount(doc: {
  routeLineCoordinates?: unknown[];
  routeLineSegments?: unknown[][];
}): number {
  if (doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2) {
    return doc.routeLineCoordinates.length;
  }
  if (doc.routeLineSegments) {
    return doc.routeLineSegments.reduce((sum, seg) => sum + (Array.isArray(seg) ? seg.length : 0), 0);
  }
  return 0;
}

describe.skipIf(!hasPbf)("PBF Copier V2 — Marsh-Billings trail line geometry (real vermont PBF)", () => {
  it(
    "stitched named hiking trails have full waypoint polylines for map draw",
    async () => {
      const result = await scanPbfViewportPreview({
        pbfPath: VERMONT_PBF,
        bbox: MARSH_BILLINGS_ROCKEFELLER_VT_BBOX,
        mode: "raw_osm",
      });

      const laughlin = mergedTrail(result.items, "Laughlin Trail");
      const mcknight = mergedTrail(result.items, "McKnight Trail");
      const lingelbach = mergedTrail(result.items, "Lingelbach Trail");

      expect(laughlin).toBeTruthy();
      expect(mcknight).toBeTruthy();
      expect(lingelbach).toBeTruthy();

      expect(linePointCount(laughlin!)).toBeGreaterThanOrEqual(20);
      expect(linePointCount(mcknight!)).toBeGreaterThanOrEqual(40);
      expect(linePointCount(lingelbach!)).toBeGreaterThanOrEqual(20);

      expect(laughlin!.routeLineColor).toMatch(/^#/);
      expect(mcknight!.routeLineColor).toMatch(/^#/);
      expect(lingelbach!.routeLineColor).not.toBe(laughlin!.routeLineColor);

      const routesWithLines = result.items.filter(
        (d) =>
          d.kind === "unexplored_route" &&
          ((d.routeLineCoordinates && d.routeLineCoordinates.length >= 2) ||
            (d.routeLineSegments && d.routeLineSegments.some((s) => s.length >= 2)))
      );
      expect(routesWithLines.length).toBeGreaterThan(30);
    },
    120_000
  );
});
