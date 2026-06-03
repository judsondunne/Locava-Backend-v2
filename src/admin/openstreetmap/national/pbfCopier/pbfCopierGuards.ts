import { createHash } from "node:crypto";
import {
  assertOsmNationalCollectionTarget,
  assertOsmNationalWriteAllowed,
  isFirestoreEmulatorActiveForOsmNational,
  isOsmNationalProductionWriteUnlocked,
  OSM_NATIONAL_PRODUCTION_CONFIRMATION,
  OSM_NATIONAL_PRODUCTION_ENV_VAR,
  OsmNationalWriteBlockedError,
  VERMONT_OFFROAD_PRODUCTION_PASSWORD,
  type OsmNationalWriteTarget,
} from "../osmNationalWriteGuard.js";
import type { PbfCopierConfig, PbfCopierMode } from "./pbfCopierTypes.js";

/**
 * PBF copier guards.
 *
 * Reuses the existing OSM national write guard so production writes still
 * Production writes unlock with either:
 *   - Password `Cooper` in confirmProductionWrite (no env var), or
 *   - `OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE=true` plus the long confirmation phrase.
 *
 * In addition, the PBF copier requires:
 *   - The collection must be `unexploredSpots` or `unexploredRoutes`.
 *   - `/posts` is hard-coded as forbidden in two layers (this file +
 *     existing guard).
 *   - A successful dry-run proof token for the same `(filePath, key
 *     config)` must exist in the run store before a write run can start.
 */

export const PBF_COPIER_FORBIDDEN_COLLECTIONS = ["posts"] as const;
export const PBF_COPIER_ALLOWED_COLLECTIONS = [
  "unexploredSpots",
  "unexploredRoutes",
] as const;
export const PBF_UNDISCOVERED_SHAPE_CONFIRMATION =
  "I_CONFIRM_UNDISCOVERED_WRITES_MATCH_POST_LIKE_SCHEMA";

export function pbfProductionConfirmationPhrase(): string {
  return OSM_NATIONAL_PRODUCTION_CONFIRMATION;
}

export function pbfProductionEnvVarName(): string {
  return OSM_NATIONAL_PRODUCTION_ENV_VAR;
}

export function pbfIsEmulatorActive(): boolean {
  return isFirestoreEmulatorActiveForOsmNational();
}

export function pbfIsProductionWriteUnlocked(input?: {
  confirmProductionWrite?: string;
}): boolean {
  return isOsmNationalProductionWriteUnlocked({
    confirmProductionWrite: input?.confirmProductionWrite,
  });
}

export type PbfCopierStartGuardInput = {
  mode: PbfCopierMode;
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  config: PbfCopierConfig;
  /** Optional pre-existing dry-run proof token. */
  dryRunProofToken?: string;
  /** Whether the proof token is recognized as valid. */
  dryRunProofValid?: boolean;
};

export type PbfCopierStartGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function evaluatePbfCopierStartGuard(
  input: PbfCopierStartGuardInput
): PbfCopierStartGuardResult {
  if (!input.config.filePath?.trim()) {
    return { ok: false, code: "missing_file_path", message: "filePath is required." };
  }

  if (input.mode === "dry_run_preview" || input.mode === "fast_dry_run") {
    if (input.writeTarget !== "none") {
      return {
        ok: false,
        code: "dry_run_requires_writeTarget_none",
        message: "Dry-run mode requires writeTarget=none.",
      };
    }
    return { ok: true };
  }

  if (input.mode === "write") {
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
    if (input.writeTarget === "emulator" && !pbfIsEmulatorActive()) {
      return {
        ok: false,
        code: "emulator_host_missing",
        message: "Set FIRESTORE_EMULATOR_HOST before running emulator writes.",
      };
    }
    if (input.writeTarget === "production") {
      if (!pbfIsProductionWriteUnlocked({ confirmProductionWrite: input.confirmProductionWrite })) {
        return {
          ok: false,
          code: "production_write_blocked",
          message:
            `Production writes: enter password "${VERMONT_OFFROAD_PRODUCTION_PASSWORD}" in the write modal (no env var), ` +
            `or set ${OSM_NATIONAL_PRODUCTION_ENV_VAR}=true in the backend .env and use confirmProductionWrite=${OSM_NATIONAL_PRODUCTION_CONFIRMATION}.`,
        };
      }
    }
    if (!input.dryRunProofToken || !input.dryRunProofValid) {
      return {
        ok: false,
        code: "dry_run_proof_required",
        message:
          "Write runs require a successful prior dry-run for the same filePath and config. Run a dry-run preview first and pass the returned dryRunProofToken.",
      };
    }
    if (input.confirmUndiscoveredShape !== PBF_UNDISCOVERED_SHAPE_CONFIRMATION) {
      return {
        ok: false,
        code: "undiscovered_shape_confirmation_required",
        message:
          `Write mode requires confirmUndiscoveredShape=${PBF_UNDISCOVERED_SHAPE_CONFIRMATION}.`,
      };
    }
    try {
      assertOsmNationalWriteAllowed({
        writeTarget: input.writeTarget,
        operation: "osm_pbf_copier.start",
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

  return { ok: false, code: "unknown_mode", message: `Unknown mode=${String(input.mode)}` };
}

export function assertPbfCopierCollectionTarget(collection: string): void {
  if (collection === "posts") {
    throw new Error("OSM_PBF_COPIER_POSTS_WRITE_FORBIDDEN");
  }
  if (
    collection !== "unexploredSpots" &&
    collection !== "unexploredRoutes"
  ) {
    throw new Error(`OSM_PBF_COPIER_COLLECTION_FORBIDDEN: ${collection}`);
  }
  // Defense-in-depth — the underlying OSM national guard already blocks
  // /posts and rejects unknown collections.
  assertOsmNationalCollectionTarget(collection);
}

/**
 * Builds the dry-run proof token used to gate write mode. The token is a
 * deterministic hash of the file path + a small set of "this is the same
 * config" knobs. The runner stores the token in the dryRunProofs map after
 * a successful dry-run, and the write endpoint checks it before allowing
 * Firestore writes.
 */
export function buildPbfDryRunProofToken(input: {
  filePath: string;
  config: Pick<
    PbfCopierConfig,
    "includeSpots" | "includeRoutes" | "includePublicOnly" | "includeReviewDocs" | "stateCode"
  >;
}): string {
  const payload = JSON.stringify({
    filePath: input.filePath,
    includeSpots: input.config.includeSpots,
    includeRoutes: input.config.includeRoutes,
    includePublicOnly: input.config.includePublicOnly,
    includeReviewDocs: input.config.includeReviewDocs,
    stateCode: input.config.stateCode,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
