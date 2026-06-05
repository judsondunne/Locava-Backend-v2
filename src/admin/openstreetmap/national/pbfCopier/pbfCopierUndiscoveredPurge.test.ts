import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PBF_PURGE_UNDISCOVERED_CONFIRMATION,
  PBF_PURGE_UNDISCOVERED_ENV_VAR,
  assertPbfPurgeCollectionTarget,
  assertPbfUndiscoveredPurgeAllowed,
  isPbfUndiscoveredPurgeEnabled,
} from "./pbfCopierUndiscoveredPurge.js";
import { VERMONT_OFFROAD_PRODUCTION_PASSWORD } from "../osmNationalWriteGuard.js";

describe("pbfCopierUndiscoveredPurge guards", () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR];
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR];
    else process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR] = prevEnv;
  });

  it("is disabled unless env is exactly true", () => {
    delete process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR];
    expect(isPbfUndiscoveredPurgeEnabled()).toBe(false);
    process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR] = "1";
    expect(isPbfUndiscoveredPurgeEnabled()).toBe(false);
    process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR] = "true";
    expect(isPbfUndiscoveredPurgeEnabled()).toBe(true);
  });

  it("allows only unexploredSpots, unexploredRoutes, and unexploredTiles", () => {
    expect(() => assertPbfPurgeCollectionTarget("unexploredSpots")).not.toThrow();
    expect(() => assertPbfPurgeCollectionTarget("unexploredRoutes")).not.toThrow();
    expect(() => assertPbfPurgeCollectionTarget("unexploredTiles")).not.toThrow();
    expect(() => assertPbfPurgeCollectionTarget("posts")).toThrow(/POSTS_FORBIDDEN/);
    expect(() => assertPbfPurgeCollectionTarget("users")).toThrow(/COLLECTION_FORBIDDEN/);
  });

  it("requires purge env, confirmation phrase, and production password", () => {
    process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR] = "true";
    expect(() =>
      assertPbfUndiscoveredPurgeAllowed({
        writeTarget: "production",
        confirmPurge: PBF_PURGE_UNDISCOVERED_CONFIRMATION,
        confirmProductionWrite: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
      })
    ).not.toThrow();

    expect(() =>
      assertPbfUndiscoveredPurgeAllowed({
        writeTarget: "production",
        confirmPurge: "wrong",
        confirmProductionWrite: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
      })
    ).toThrow(/CONFIRMATION_REQUIRED/);

    delete process.env[PBF_PURGE_UNDISCOVERED_ENV_VAR];
    expect(() =>
      assertPbfUndiscoveredPurgeAllowed({
        writeTarget: "production",
        confirmPurge: PBF_PURGE_UNDISCOVERED_CONFIRMATION,
        confirmProductionWrite: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
      })
    ).toThrow(/PURGE_DISABLED/);
  });
});
