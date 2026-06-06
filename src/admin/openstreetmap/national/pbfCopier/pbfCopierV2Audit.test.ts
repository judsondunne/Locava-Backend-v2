import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPbfCopierV2Audit } from "./pbfCopierV2Audit.js";
import { MARSH_BILLINGS_ROCKEFELLER_VT_BBOX } from "./pbfCopierV2ViewportPreview.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PBF = path.join(ROOT, "data/osm/vermont-latest.osm.pbf");

describe("pbfCopierV2Audit smoke", () => {
  it("runs dry audit on a tiny bbox without Firestore writes", async () => {
    let pbfExists = false;
    try {
      const fs = await import("node:fs/promises");
      await fs.access(PBF);
      pbfExists = true;
    } catch {
      pbfExists = false;
    }
    if (!pbfExists) {
      console.warn(`Skipping PBF audit smoke — missing ${PBF}`);
      return;
    }

    const result = await runPbfCopierV2Audit({
      pbfPath: PBF,
      bbox: MARSH_BILLINGS_ROCKEFELLER_VT_BBOX,
      limit: 25,
      dryRun: true,
      includeWritePreview: true,
      includeRejected: true,
      maxRawObjectsScanned: 250_000,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("audit");
    expect(result.firestoreWrites).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.summary.rawElementsScanned).toBeGreaterThan(0);
    expect(result.summary.byTagFamily).toBeDefined();

    const totalDetailed =
      result.acceptedSpots.length +
      result.rejectedSpots.length +
      result.acceptedRoutes.length +
      result.rejectedRoutes.length;
    expect(totalDetailed).toBeGreaterThan(0);

    for (const spot of result.acceptedSpots) {
      expect(spot.acceptReasons.length).toBeGreaterThan(0);
      if (spot.writePreview) {
        expect(spot.writePreview.collection).toBe("unexploredSpots");
        expect(spot.writePreview.docId).toBeTruthy();
      }
    }
    for (const rejected of result.rejectedSpots) {
      expect(rejected.rejectReasons.length).toBeGreaterThan(0);
    }
    for (const route of result.acceptedRoutes) {
      expect(route.fragmentationHints).toBeDefined();
      expect(route.geometryStats).toBeDefined();
      if (route.writePreview) {
        expect(route.writePreview.collection).toBe("unexploredRoutes");
      }
    }
    for (const rejected of result.rejectedRoutes) {
      expect(rejected.rejectReasons.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
