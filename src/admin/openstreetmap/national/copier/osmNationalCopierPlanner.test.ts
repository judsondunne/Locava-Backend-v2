import { describe, expect, it } from "vitest";
import { planCopierTiles, resolveCopierStateCodes } from "./osmNationalCopierPlanner.js";
import { DEFAULT_OSM_NATIONAL_COPIER_CONFIG } from "./osmNationalCopierTypes.js";

describe("osmNationalCopierPlanner", () => {
  it("defaults to the contiguous US when no states are provided", () => {
    const result = resolveCopierStateCodes({ config: DEFAULT_OSM_NATIONAL_COPIER_CONFIG });
    expect(result).not.toContain("AK");
    expect(result).not.toContain("HI");
    expect(result.length).toBeGreaterThan(40);
  });

  it("respects explicit stateCodes", () => {
    const result = resolveCopierStateCodes({
      config: { ...DEFAULT_OSM_NATIONAL_COPIER_CONFIG, stateCodes: ["VT", "NH"] },
    });
    expect(result).toEqual(expect.arrayContaining(["VT", "NH"]));
  });

  it("produces tiles for one tiny state and honors maxTiles", () => {
    const plan = planCopierTiles({
      config: { ...DEFAULT_OSM_NATIONAL_COPIER_CONFIG, chunkSizeKm: 150, stateCodes: ["VT"] },
      maxTiles: 2,
    });
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(plan.tiles.length).toBeLessThanOrEqual(2);
    expect(plan.tiles[0]!.stateCode).toBe("VT");
    expect(plan.tiles[0]!.bbox.minLat).toBeLessThan(plan.tiles[0]!.bbox.maxLat);
  });

  it("each tile carries a tileId and tileIndex", () => {
    const plan = planCopierTiles({
      config: { ...DEFAULT_OSM_NATIONAL_COPIER_CONFIG, chunkSizeKm: 200, stateCodes: ["VT"] },
    });
    plan.tiles.forEach((t, i) => {
      expect(t.tileIndex).toBe(i);
      expect(t.tileId).toBeTruthy();
    });
  });
});
