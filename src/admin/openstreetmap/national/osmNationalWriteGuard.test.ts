import { describe, expect, it } from "vitest";
import {
  assertOsmNationalCollectionTarget,
  assertOsmNationalWriteAllowed,
  isOsmNationalProductionWriteUnlocked,
  OSM_NATIONAL_PRODUCTION_CONFIRMATION,
  OSM_NATIONAL_PRODUCTION_ENV_VAR,
  VERMONT_OFFROAD_PRODUCTION_PASSWORD,
  OsmNationalWriteBlockedError,
} from "./osmNationalWriteGuard.js";

describe("osmNationalWriteGuard", () => {
  it("blocks production write without phrase", () => {
    expect(() =>
      assertOsmNationalWriteAllowed({
        writeTarget: "production",
        operation: "test",
        confirmProductionWrite: "wrong",
      })
    ).toThrow(OsmNationalWriteBlockedError);
  });

  it("allows production write with Vermont password Cooper (no env var)", () => {
    const prev = process.env[OSM_NATIONAL_PRODUCTION_ENV_VAR];
    delete process.env[OSM_NATIONAL_PRODUCTION_ENV_VAR];
    expect(
      isOsmNationalProductionWriteUnlocked({
        confirmProductionWrite: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
      })
    ).toBe(true);
    expect(() =>
      assertOsmNationalWriteAllowed({
        writeTarget: "production",
        operation: "vermont_offroad_write",
        confirmProductionWrite: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
      })
    ).not.toThrow();
    process.env[OSM_NATIONAL_PRODUCTION_ENV_VAR] = prev;
  });

  it("allows production write only with exact phrase and env", () => {
    const prev = process.env[OSM_NATIONAL_PRODUCTION_ENV_VAR];
    process.env[OSM_NATIONAL_PRODUCTION_ENV_VAR] = "true";
    expect(
      isOsmNationalProductionWriteUnlocked({
        confirmProductionWrite: OSM_NATIONAL_PRODUCTION_CONFIRMATION,
      })
    ).toBe(true);
    process.env[OSM_NATIONAL_PRODUCTION_ENV_VAR] = prev;
  });

  it("forbids posts collection", () => {
    expect(() => assertOsmNationalCollectionTarget("posts")).toThrow(/POSTS_WRITE_FORBIDDEN/);
  });

  it("allows unexplored collections", () => {
    expect(() => assertOsmNationalCollectionTarget("unexploredSpots")).not.toThrow();
    expect(() => assertOsmNationalCollectionTarget("unexploredRoutes")).not.toThrow();
    expect(() => assertOsmNationalCollectionTarget("openStreetMapNationalRuns", { progressOnly: true })).not.toThrow();
  });

  it("dryRun none blocks unexplored writes", () => {
    expect(() =>
      assertOsmNationalWriteAllowed({ writeTarget: "none", operation: "bulkWriteUnexploredSpots" })
    ).toThrow(OsmNationalWriteBlockedError);
  });
});
