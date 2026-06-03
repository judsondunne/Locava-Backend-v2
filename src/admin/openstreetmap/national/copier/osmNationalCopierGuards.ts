import {
  assertOsmNationalCollectionTarget,
  assertOsmNationalWriteAllowed,
  isFirestoreEmulatorActiveForOsmNational,
  isOsmNationalProductionWriteUnlocked,
  OSM_NATIONAL_PRODUCTION_CONFIRMATION,
  OSM_NATIONAL_PRODUCTION_ENV_VAR,
  OsmNationalWriteBlockedError,
  type OsmNationalWriteTarget,
} from "../osmNationalWriteGuard.js";
import type { OsmNationalCopierConfig } from "./osmNationalCopierTypes.js";

/**
 * Wraps the existing OSM national write guard with an extra "is this even
 * remotely safe to start" check for the copier UI. The actual production write
 * confirmation phrase is reused unchanged.
 */

export const OSM_NATIONAL_COPIER_FORBIDDEN_COLLECTIONS = ["posts"] as const;

export const OSM_NATIONAL_COPIER_ALLOWED_COLLECTIONS = [
  "unexploredSpots",
  "unexploredRoutes",
  "unexploredTiles",
] as const;

export type OsmNationalCopierStartGuardInput = {
  mode: "dry_run_preview" | "write";
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  config: OsmNationalCopierConfig;
};

export type OsmNationalCopierStartGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function evaluateCopierStartGuard(
  input: OsmNationalCopierStartGuardInput
): OsmNationalCopierStartGuardResult {
  if (input.mode === "dry_run_preview") {
    if (input.writeTarget !== "none") {
      return {
        ok: false,
        code: "dry_run_requires_writeTarget_none",
        message: "Dry-run mode requires writeTarget=none.",
      };
    }
    return { ok: true };
  }

  if (input.config.overwriteExisting && input.config.skipExisting) {
    return {
      ok: false,
      code: "conflicting_skip_overwrite",
      message: "skipExisting and overwriteExisting cannot both be enabled.",
    };
  }

  if (input.writeTarget === "none") {
    return {
      ok: false,
      code: "write_requires_target",
      message: "Write mode requires writeTarget=emulator or writeTarget=production.",
    };
  }

  if (input.writeTarget === "emulator" && !isFirestoreEmulatorActiveForOsmNational()) {
    return {
      ok: false,
      code: "emulator_host_missing",
      message: "Set FIRESTORE_EMULATOR_HOST before running emulator writes.",
    };
  }

  if (input.writeTarget === "production") {
    if (!isOsmNationalProductionWriteUnlocked({ confirmProductionWrite: input.confirmProductionWrite })) {
      return {
        ok: false,
        code: "production_write_blocked",
        message: `Production writes require ${OSM_NATIONAL_PRODUCTION_ENV_VAR}=true and confirmProductionWrite=${OSM_NATIONAL_PRODUCTION_CONFIRMATION}.`,
      };
    }
  }

  try {
    assertOsmNationalWriteAllowed({
      writeTarget: input.writeTarget,
      operation: "osm_national_copier.start",
      confirmProductionWrite: input.confirmProductionWrite,
    });
  } catch (error) {
    if (error instanceof OsmNationalWriteBlockedError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: "write_guard_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true };
}

export function assertCopierCollectionTarget(collection: string): void {
  // Defense-in-depth: always re-run the existing collection allowlist before
  // any copier write path.
  if (collection === "posts") {
    throw new Error("OSM_NATIONAL_COPIER_POSTS_WRITE_FORBIDDEN");
  }
  assertOsmNationalCollectionTarget(collection);
}

export function copierProductionConfirmationPhrase(): string {
  return OSM_NATIONAL_PRODUCTION_CONFIRMATION;
}

export function copierProductionEnvVarName(): string {
  return OSM_NATIONAL_PRODUCTION_ENV_VAR;
}
