import { describe, expect, it } from "vitest";
import { runOsmDebugBbox } from "./inventoryOsmDebug.service.js";

describe("inventoryOsmDebug.service", () => {
  it("returns coordinate sanity for Hartland fixture dry run", async () => {
    const result = await runOsmDebugBbox({ source: "fixture", limit: 500 });
    expect(result.counts.classifiedSpot).toBeGreaterThan(0);
    expect(result.counts.classifiedRoute).toBeGreaterThan(0);
    expect(result.counts.rejected).toBeGreaterThan(0);
    expect(result.coordinateSanity.acceptedSpotRange?.minLat).toBeGreaterThan(42);
    expect(result.coordinateSanity.acceptedSpotRange?.maxLng).toBeLessThan(-71);
    expect(result.coordinateSanity.insideDefaultBboxSpots).toBe(result.counts.classifiedSpot);
  });
});
