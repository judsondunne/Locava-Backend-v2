import { describe, expect, it } from "vitest";
import {
  assertCopierCollectionTarget,
  copierProductionConfirmationPhrase,
  copierProductionEnvVarName,
  evaluateCopierStartGuard,
} from "./osmNationalCopierGuards.js";
import { DEFAULT_OSM_NATIONAL_COPIER_CONFIG } from "./osmNationalCopierTypes.js";

describe("osmNationalCopierGuards", () => {
  it("allows dry-run preview with writeTarget=none", () => {
    const result = evaluateCopierStartGuard({
      mode: "dry_run_preview",
      writeTarget: "none",
      config: DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
    });
    expect(result.ok).toBe(true);
  });

  it("blocks dry-run preview when writeTarget is not none", () => {
    const result = evaluateCopierStartGuard({
      mode: "dry_run_preview",
      writeTarget: "emulator",
      config: DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("dry_run_requires_writeTarget_none");
  });

  it("blocks write when writeTarget=none", () => {
    const result = evaluateCopierStartGuard({
      mode: "write",
      writeTarget: "none",
      config: DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("write_requires_target");
  });

  it("blocks production without exact confirmation phrase", () => {
    const result = evaluateCopierStartGuard({
      mode: "write",
      writeTarget: "production",
      confirmProductionWrite: "WRONG",
      config: DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("production_write_blocked");
  });

  it("blocks production write even with phrase when env var is missing", () => {
    const prev = process.env[copierProductionEnvVarName()];
    delete process.env[copierProductionEnvVarName()];
    const result = evaluateCopierStartGuard({
      mode: "write",
      writeTarget: "production",
      confirmProductionWrite: copierProductionConfirmationPhrase(),
      config: DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
    });
    expect(result.ok).toBe(false);
    if (prev != null) process.env[copierProductionEnvVarName()] = prev;
  });

  it("blocks writes when both skipExisting and overwriteExisting are set", () => {
    const result = evaluateCopierStartGuard({
      mode: "write",
      writeTarget: "emulator",
      config: {
        ...DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
        skipExisting: true,
        overwriteExisting: true,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflicting_skip_overwrite");
  });

  it("blocks emulator writes when FIRESTORE_EMULATOR_HOST is missing", () => {
    const prev = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    try {
      const result = evaluateCopierStartGuard({
        mode: "write",
        writeTarget: "emulator",
        config: DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("emulator_host_missing");
    } finally {
      if (prev != null) process.env.FIRESTORE_EMULATOR_HOST = prev;
    }
  });

  it("always blocks the posts collection", () => {
    expect(() => assertCopierCollectionTarget("posts")).toThrow(
      /POSTS_WRITE_FORBIDDEN/
    );
  });

  it("allows unexploredSpots and unexploredRoutes collections", () => {
    expect(() => assertCopierCollectionTarget("unexploredSpots")).not.toThrow();
    expect(() => assertCopierCollectionTarget("unexploredRoutes")).not.toThrow();
  });
});
