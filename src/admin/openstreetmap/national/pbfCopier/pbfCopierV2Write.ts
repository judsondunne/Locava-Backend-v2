/**
 * PBF Copier V2 — validate, dry-run, and write blank spots/routes to Firestore.
 * Reuses the original copier write adapters and guards.
 */
import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";
import { writeUnexploredSpotsWithTileIndex } from "../../../../services/map/unexploredSpotTileUpsert.service.js";
import { writeUnexploredRoutesWithTileIndex } from "../../../../services/map/unexploredRouteTileUpsert.service.js";
import type { OsmNationalWriteOptions } from "../../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { findExistingUnexploredIds } from "../copier/osmNationalCopierExistsBatch.js";
import {
  assertPbfCopierCollectionTarget,
  PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
  pbfIsEmulatorActive,
  pbfIsProductionWriteUnlocked,
} from "./pbfCopierGuards.js";
import {
  assertOsmNationalWriteAllowed,
  OsmNationalWriteBlockedError,
  OSM_NATIONAL_PRODUCTION_CONFIRMATION,
  OSM_NATIONAL_PRODUCTION_ENV_VAR,
  VERMONT_OFFROAD_PRODUCTION_PASSWORD,
} from "../osmNationalWriteGuard.js";
import { PREVIEW_WRITE_BATCH_SIZE } from "./pbfCopierPreviewWrite.js";
import {
  buildPbfV2WritePayload,
  PBF_V2_LARGE_WRITE_THRESHOLD,
  type BuildPbfV2WritePayloadInput,
  type PbfV2WritePayloadPlan,
  type PbfV2WriteSkipExample,
  type PbfV2WriteValidExample,
} from "./pbfCopierV2WritePayload.js";
import { buildOsmNationalRunId } from "../osmNationalDeterministicIds.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type PbfV2WriteInput = BuildPbfV2WritePayloadInput & {
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  dryRun?: boolean;
  skipExisting?: boolean;
  overwrite?: boolean;
  confirmLargeWrite?: boolean;
  onWriteProgress?: (progress: PbfV2WriteProgress) => void | Promise<void>;
};

export type PbfV2WriteProgress = {
  stage: "building_payload" | "checking_duplicates" | "spots" | "routes" | "done";
  batchIndex: number;
  batchCount: number;
  spotsPlanned: number;
  routesPlanned: number;
  spotsWritten: number;
  routesWritten: number;
  tilesWritten: number;
  message?: string;
};

export type PbfV2WriteResult = {
  dryRun: boolean;
  writeTarget: OsmNationalWriteTarget;
  attempted: number;
  written: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  skippedFilteredOut: number;
  skippedSupportOnly: number;
  routesWritten: number;
  spotsWritten: number;
  /** Nested unexploredTiles docs upserted — required for native map layer. */
  tilesWritten: number;
  supportObjectsNested: number;
  spotsPlanned: number;
  routesPlanned: number;
  duplicateCandidates: number;
  validationErrors: string[];
  writtenExamples: PbfV2WriteValidExample[];
  skippedExamples: PbfV2WriteSkipExample[];
  errors: string[];
  writeRunId: string;
  requiresLargeWriteConfirmation?: boolean;
};

function evaluateV2WriteGuard(input: PbfV2WriteInput): { ok: true } | { ok: false; code: string; message: string } {
  if (input.dryRun) {
    return { ok: true };
  }
  if (input.writeTarget === "none") {
    return { ok: false, code: "write_requires_target", message: "Write requires writeTarget=emulator or production." };
  }
  if (input.overwrite && input.skipExisting) {
    return {
      ok: false,
      code: "conflicting_skip_overwrite",
      message: "skipExisting and overwrite cannot both be enabled.",
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
  const shapeConfirm = input.confirmUndiscoveredShape ?? PBF_UNDISCOVERED_SHAPE_CONFIRMATION;
  if (shapeConfirm !== PBF_UNDISCOVERED_SHAPE_CONFIRMATION) {
    return {
      ok: false,
      code: "undiscovered_shape_confirmation_required",
      message: `Write requires confirmUndiscoveredShape=${PBF_UNDISCOVERED_SHAPE_CONFIRMATION}.`,
    };
  }
  try {
    assertOsmNationalWriteAllowed({
      writeTarget: input.writeTarget,
      operation: "osm_pbf_copier_v2.write",
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

async function filterDuplicates(
  plan: PbfV2WritePayloadPlan,
  skipExisting: boolean
): Promise<{
  spots: PbfV2WritePayloadPlan["spots"];
  routes: PbfV2WritePayloadPlan["routes"];
  duplicateCandidates: number;
  skippedDuplicates: number;
}> {
  if (!skipExisting) {
    return {
      spots: plan.spots,
      routes: plan.routes,
      duplicateCandidates: 0,
      skippedDuplicates: 0,
    };
  }

  let spots = plan.spots;
  let routes = plan.routes;
  let skippedDuplicates = 0;

  const existingSpots =
    spots.length > 0
      ? await findExistingUnexploredIds(
          "unexploredSpots",
          spots.map((s) => s.id)
        )
      : new Set<string>();
  const existingRoutes =
    routes.length > 0
      ? await findExistingUnexploredIds(
          "unexploredRoutes",
          routes.map((r) => r.id)
        )
      : new Set<string>();

  const duplicateCandidates = existingSpots.size + existingRoutes.size;

  if (existingSpots.size > 0) {
    skippedDuplicates += existingSpots.size;
    spots = spots.filter((s) => !existingSpots.has(s.id));
  }
  if (existingRoutes.size > 0) {
    skippedDuplicates += existingRoutes.size;
    routes = routes.filter((r) => !existingRoutes.has(r.id));
  }

  return { spots, routes, duplicateCandidates, skippedDuplicates };
}

export async function validatePbfV2WritePayload(
  input: BuildPbfV2WritePayloadInput & { skipExisting?: boolean }
): Promise<PbfV2WriteResult> {
  const writeRunId = input.writeRunId ?? buildOsmNationalRunId();
  const plan = buildPbfV2WritePayload({ ...input, writeRunId, writeTarget: "none" });
  const { duplicateCandidates } = await filterDuplicates(plan, input.skipExisting !== false);

  const totalPlanned = plan.spotsPlanned + plan.routesPlanned;

  return {
    dryRun: true,
    writeTarget: "none",
    attempted: plan.attempted,
    written: 0,
    skippedDuplicates: 0,
    skippedInvalid: plan.skippedInvalid,
    skippedFilteredOut: plan.skippedFilteredOut,
    skippedSupportOnly: plan.skippedSupportOnly,
    routesWritten: 0,
    spotsWritten: 0,
    tilesWritten: 0,
    supportObjectsNested: plan.supportObjectsNested,
    spotsPlanned: plan.spotsPlanned,
    routesPlanned: plan.routesPlanned,
    duplicateCandidates,
    validationErrors: plan.validationErrors,
    writtenExamples: plan.validExamples,
    skippedExamples: plan.skippedExamples,
    errors: [],
    writeRunId,
    requiresLargeWriteConfirmation:
      totalPlanned > PBF_V2_LARGE_WRITE_THRESHOLD ? true : undefined,
  };
}

export async function executePbfV2Write(input: PbfV2WriteInput): Promise<PbfV2WriteResult> {
  const writeRunId = input.writeRunId ?? buildOsmNationalRunId();
  const dryRun = input.dryRun === true;
  const skipExisting = input.overwrite ? false : input.skipExisting !== false;

  const guard = evaluateV2WriteGuard(input);
  if (!guard.ok) {
    return {
      dryRun,
      writeTarget: input.writeTarget,
      attempted: 0,
      written: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      skippedFilteredOut: 0,
      skippedSupportOnly: 0,
      routesWritten: 0,
      spotsWritten: 0,
    tilesWritten: 0,
      supportObjectsNested: 0,
      spotsPlanned: 0,
      routesPlanned: 0,
      duplicateCandidates: 0,
      validationErrors: [`${guard.code}:${guard.message}`],
      writtenExamples: [],
      skippedExamples: [],
      errors: [guard.message],
      writeRunId,
    };
  }

  const plan = buildPbfV2WritePayload({
    ...input,
    writeRunId,
    writeTarget: dryRun ? "none" : input.writeTarget,
  });

  await input.onWriteProgress?.({
    stage: "building_payload",
    batchIndex: 0,
    batchCount: 0,
    spotsPlanned: plan.spotsPlanned,
    routesPlanned: plan.routesPlanned,
    spotsWritten: 0,
    routesWritten: 0,
    tilesWritten: 0,
    message: `Built write plan: ${plan.spotsPlanned} spots, ${plan.routesPlanned} routes`,
  });

  const totalPlanned = plan.spotsPlanned + plan.routesPlanned;
  if (totalPlanned === 0) {
    return {
      dryRun,
      writeTarget: input.writeTarget,
      attempted: plan.attempted,
      written: 0,
      skippedDuplicates: 0,
      skippedInvalid: plan.skippedInvalid,
      skippedFilteredOut: plan.skippedFilteredOut,
      skippedSupportOnly: plan.skippedSupportOnly,
      routesWritten: 0,
      spotsWritten: 0,
    tilesWritten: 0,
      supportObjectsNested: plan.supportObjectsNested,
      spotsPlanned: 0,
      routesPlanned: 0,
      duplicateCandidates: 0,
      validationErrors: plan.validationErrors,
      writtenExamples: [],
      skippedExamples: plan.skippedExamples,
      errors: plan.validationErrors.length ? plan.validationErrors : ["empty_payload"],
      writeRunId,
    };
  }

  if (
    !dryRun &&
    totalPlanned > PBF_V2_LARGE_WRITE_THRESHOLD &&
    input.confirmLargeWrite !== true
  ) {
    return {
      dryRun: false,
      writeTarget: input.writeTarget,
      attempted: plan.attempted,
      written: 0,
      skippedDuplicates: 0,
      skippedInvalid: plan.skippedInvalid,
      skippedFilteredOut: plan.skippedFilteredOut,
      skippedSupportOnly: plan.skippedSupportOnly,
      routesWritten: 0,
      spotsWritten: 0,
    tilesWritten: 0,
      supportObjectsNested: plan.supportObjectsNested,
      spotsPlanned: plan.spotsPlanned,
      routesPlanned: plan.routesPlanned,
      duplicateCandidates: 0,
      validationErrors: ["large_write_confirmation_required"],
      writtenExamples: plan.validExamples,
      skippedExamples: plan.skippedExamples,
      errors: [`Writing ${totalPlanned} items requires confirmLargeWrite=true (> ${PBF_V2_LARGE_WRITE_THRESHOLD}).`],
      writeRunId,
      requiresLargeWriteConfirmation: true,
    };
  }

  await input.onWriteProgress?.({
    stage: "checking_duplicates",
    batchIndex: 0,
    batchCount: 0,
    spotsPlanned: plan.spotsPlanned,
    routesPlanned: plan.routesPlanned,
    spotsWritten: 0,
    routesWritten: 0,
    tilesWritten: 0,
    message: `Checking Firestore for ${plan.spotsPlanned + plan.routesPlanned} existing doc ids…`,
  });

  const deduped = await filterDuplicates(plan, skipExisting);

  if (dryRun) {
    return {
      dryRun: true,
      writeTarget: input.writeTarget,
      attempted: plan.attempted,
      written: deduped.spots.length + deduped.routes.length,
      skippedDuplicates: deduped.skippedDuplicates,
      skippedInvalid: plan.skippedInvalid,
      skippedFilteredOut: plan.skippedFilteredOut,
      skippedSupportOnly: plan.skippedSupportOnly,
      routesWritten: 0,
      spotsWritten: 0,
    tilesWritten: 0,
      supportObjectsNested: plan.supportObjectsNested,
      spotsPlanned: deduped.spots.length,
      routesPlanned: deduped.routes.length,
      duplicateCandidates: deduped.duplicateCandidates,
      validationErrors: plan.validationErrors,
      writtenExamples: plan.validExamples,
      skippedExamples: plan.skippedExamples,
      errors: [],
      writeRunId,
      requiresLargeWriteConfirmation:
        totalPlanned > PBF_V2_LARGE_WRITE_THRESHOLD ? true : undefined,
    };
  }

  const writeOptions: OsmNationalWriteOptions = {
    writeTarget: input.writeTarget,
    operation: "osm_pbf_copier_v2.write_blank_spots",
    confirmProductionWrite: input.confirmProductionWrite,
  };

  let spotsWritten = 0;
  let routesWritten = 0;
  let tilesWritten = 0;
  const errors: string[] = [];
  const spotBatchCount = Math.ceil(deduped.spots.length / PREVIEW_WRITE_BATCH_SIZE) || 0;
  const routeBatchCount = Math.ceil(deduped.routes.length / PREVIEW_WRITE_BATCH_SIZE) || 0;

  const emitProgress = async (stage: PbfV2WriteProgress["stage"], batchIndex: number, batchCount: number, message?: string): Promise<void> => {
    if (!input.onWriteProgress) return;
    await input.onWriteProgress({
      stage,
      batchIndex,
      batchCount,
      spotsPlanned: deduped.spots.length,
      routesPlanned: deduped.routes.length,
      spotsWritten,
      routesWritten,
      tilesWritten,
      message,
    });
  };

  try {
    assertPbfCopierCollectionTarget("unexploredSpots");
    await emitProgress("spots", 0, spotBatchCount, `Writing ${deduped.spots.length} spots in ${spotBatchCount} batch(es)…`);
    for (let i = 0; i < deduped.spots.length; i += PREVIEW_WRITE_BATCH_SIZE) {
      const batch = deduped.spots.slice(i, i + PREVIEW_WRITE_BATCH_SIZE);
      if (batch.length === 0) continue;
      const result = await writeUnexploredSpotsWithTileIndex({
        spots: batch,
        runId: writeRunId,
        writeOptions,
      });
      spotsWritten += result.spotsWritten;
      tilesWritten += result.tilesWritten;
      await emitProgress(
        "spots",
        Math.floor(i / PREVIEW_WRITE_BATCH_SIZE) + 1,
        spotBatchCount,
        `Spot batch ${Math.floor(i / PREVIEW_WRITE_BATCH_SIZE) + 1}/${spotBatchCount}: +${result.spotsWritten} docs, +${result.tilesWritten} tiles`
      );
    }

    assertPbfCopierCollectionTarget("unexploredRoutes");
    await emitProgress("routes", 0, routeBatchCount, `Writing ${deduped.routes.length} routes in ${routeBatchCount} batch(es)…`);
    for (let i = 0; i < deduped.routes.length; i += PREVIEW_WRITE_BATCH_SIZE) {
      const batch = deduped.routes.slice(i, i + PREVIEW_WRITE_BATCH_SIZE);
      if (batch.length === 0) continue;
      const result = await writeUnexploredRoutesWithTileIndex({
        routes: batch,
        runId: writeRunId,
        writeOptions,
      });
      routesWritten += result.routesWritten;
      tilesWritten += result.tilesWritten;
      await emitProgress(
        "routes",
        Math.floor(i / PREVIEW_WRITE_BATCH_SIZE) + 1,
        routeBatchCount,
        `Route batch ${Math.floor(i / PREVIEW_WRITE_BATCH_SIZE) + 1}/${routeBatchCount}: +${result.routesWritten} docs, +${result.tilesWritten} tiles`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
  }

  const written = spotsWritten + routesWritten;

  return {
    dryRun: false,
    writeTarget: input.writeTarget,
    attempted: plan.attempted,
    written,
    skippedDuplicates: deduped.skippedDuplicates,
    skippedInvalid: plan.skippedInvalid,
    skippedFilteredOut: plan.skippedFilteredOut,
    skippedSupportOnly: plan.skippedSupportOnly,
    routesWritten,
    spotsWritten,
    tilesWritten,
    supportObjectsNested: plan.supportObjectsNested,
    spotsPlanned: deduped.spots.length,
    routesPlanned: deduped.routes.length,
    duplicateCandidates: deduped.duplicateCandidates,
    validationErrors: plan.validationErrors,
    writtenExamples: plan.validExamples,
    skippedExamples: plan.skippedExamples,
    errors,
    writeRunId,
  };
}

export function summarizePbfV2WriteItems(input: {
  rawItems: PbfCopierPreviewDoc[];
  visibleItems: PbfCopierPreviewDoc[];
  viewportRenderedIds?: string[];
}): {
  totalRawItems: number;
  totalVisibleFiltered: number;
  mapRenderedItems: number;
  hiddenExcluded: number;
  supportOnlyExcluded: number;
} {
  const hiddenExcluded = input.rawItems.filter((d) => d.filteredOut).length;
  const supportOnlyExcluded = input.visibleItems.filter(
    (d) => d.attachedTo || (d.attachedToRouteId && !d.destinationGroupId)
  ).length;

  return {
    totalRawItems: input.rawItems.length,
    totalVisibleFiltered: input.visibleItems.filter((d) => !d.filteredOut).length,
    mapRenderedItems: input.viewportRenderedIds?.length ?? 0,
    hiddenExcluded,
    supportOnlyExcluded,
  };
}
