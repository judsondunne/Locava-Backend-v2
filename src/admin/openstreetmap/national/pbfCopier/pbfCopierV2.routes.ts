import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../../../auth/admin-access.js";
import type { AppEnv } from "../../../../config/env.js";
import { failure, success } from "../../../../lib/response.js";
import { setRouteName } from "../../../../observability/request-context.js";
import {
  PBF_COPIER_ALLOWED_COLLECTIONS,
  PBF_COPIER_FORBIDDEN_COLLECTIONS,
  PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
  pbfIsEmulatorActive,
  pbfIsProductionWriteUnlocked,
  pbfProductionConfirmationPhrase,
  pbfProductionEnvVarName,
} from "./pbfCopierGuards.js";
import { validatePbfFile } from "./pbfCopierService.js";
import {
  getUndiscoveredFirestoreCounts,
  purgeAllUndiscoveredSpotsAndRoutes,
  pbfUndiscoveredPurgeHealthFields,
} from "./pbfCopierUndiscoveredPurge.js";
import { getUndiscoveredMapPreviewForAdmin, repairPbfV2MapVisibility } from "./pbfCopierUndiscoveredMapPreview.js";
import { probePbfParserAvailability } from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import { scanPbfViewportPreview } from "./pbfCopierV2ViewportPreview.js";
import {
  applyPbfQualityFilters,
  DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
  type PbfQualityFilterSettings,
} from "./pbfCopierV2QualityFilters.js";
import {
  getPbfV2FullRunStatus,
  pausePbfV2FullRun,
  resumePbfV2FullRun,
  startPbfV2FullRun,
  stopPbfV2FullRun,
  writePbfV2FullRunChunks,
} from "./pbfCopierV2FullRunService.js";
import {
  fetchPbfAssetPreview,
  listPbfAssetPreviewSources,
  streamPbfAssetPreview,
} from "../../../../lib/pbf/pbfAssetPreview.service.js";
import {
  getPbfAssetPreviewLiveSources,
  streamPbfAssetPreviewFromLivePbf,
} from "../../../../lib/pbf/pbfAssetPreviewLivePbf.service.js";
import { processPbfAssetPreviewSpot } from "../../../../lib/pbf/pbfAssetPreviewSpot.js";
import { listPbfV2FullRunChunks, listPbfV2FullRuns } from "./pbfCopierV2FullRunStore.js";
import { runPbfCopierV2Audit } from "./pbfCopierV2Audit.js";
import { runPbfCopierV2Pipeline } from "./pbfCopierV2Pipeline.js";
import { getPbfCopierV2ScanCache, storePbfCopierV2ScanCache } from "./pbfCopierV2ScanCache.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import {
  executePbfV2Write,
  summarizePbfV2WriteItems,
  validatePbfV2WritePayload,
} from "./pbfCopierV2Write.js";
import type { PbfOutdoorGroupingSummary } from "./pbfCopierV2OutdoorDestinationGroups.js";

const base = "/admin/openstreetmap/api/pbf-copier-v2";

async function requirePbfAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  env: AppEnv
): Promise<boolean> {
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return true;
  try {
    const auth = await verifyViewerAuthHeader(request.headers.authorization);
    if (!auth || !hasAdminAccess(auth)) {
      reply.status(403).send(failure("admin_required", "Admin access required"));
      return false;
    }
    return true;
  } catch {
    reply.status(401).send(failure("auth_required", "Authorization required"));
    return false;
  }
}

const ValidateFileBodySchema = z.object({ filePath: z.string().min(1) }).strict();

const ViewportBboxSchema = z
  .object({
    westLng: z.number(),
    southLat: z.number(),
    eastLng: z.number(),
    northLat: z.number(),
  })
  .strict();

const QualityFilterSettingsSchema = z
  .object({
    hideInfrastructure: z.boolean(),
    hideServiceRoads: z.boolean(),
    hideAdministrative: z.boolean(),
    hideRailway: z.boolean(),
    hideBroadGeography: z.boolean(),
    hideUnnamedLand: z.boolean(),
    hideUnnamedPaths: z.boolean(),
    hideNonDestinationAmenities: z.boolean().optional(),
    hideUnattachedBenches: z.boolean(),
    hideUnattachedParking: z.boolean(),
    attachSupportToDestinations: z.boolean(),
    showSupportObjectsAsMarkers: z.boolean(),
    parkingAttachRadiusMeters: z.number().optional(),
    benchNearDestinationRadiusMeters: z.number().optional(),
    benchNearTrailRadiusMeters: z.number().optional(),
    shelterAttachRadiusMeters: z.number().optional(),
    toiletAttachRadiusMeters: z.number().optional(),
    infoMapAttachRadiusMeters: z.number().optional(),
  })
  .strict();

const ViewportPreviewBodySchema = z
  .object({
    pbfPath: z.string().min(1),
    bbox: ViewportBboxSchema,
    mode: z.enum(["raw_osm", "locava_filtered"]).optional(),
    qualityFilterSettings: QualityFilterSettingsSchema.optional(),
  })
  .strict();

const AuditBodySchema = z
  .object({
    pbfPath: z.string().min(1),
    bbox: ViewportBboxSchema,
    limit: z.number().int().positive().max(5000).optional(),
    includeRejected: z.boolean().optional(),
    includeRawTags: z.boolean().optional(),
    includeGeometry: z.boolean().optional(),
    includeWritePreview: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    sampleMode: z.enum(["raw_osm", "locava_filtered"]).optional(),
    categoryFilter: z.string().optional(),
    osmIdFilter: z.string().optional(),
    maxRawObjectsScanned: z.number().int().positive().optional(),
    qualityFilterSettings: QualityFilterSettingsSchema.optional(),
  })
  .strict();

const ApplyQualityFiltersBodySchema = z
  .object({
    items: z.array(z.record(z.unknown())).optional(),
    cacheId: z.string().uuid().optional(),
    settings: QualityFilterSettingsSchema.optional(),
  })
  .strict()
  .refine((body) => body.cacheId != null || body.items != null, {
    message: "cacheId or items required",
  });

const WriteScopeSchema = z.enum(["all_visible", "viewport_rendered"]);

const WriteBodyObjectSchema = z
  .object({
    cacheId: z.string().uuid().optional(),
    items: z.array(z.record(z.unknown())).optional(),
    rawItems: z.array(z.record(z.unknown())).optional(),
    bbox: ViewportBboxSchema,
    scanCacheId: z.string().uuid().nullable().optional(),
    qualityFilterSettings: QualityFilterSettingsSchema.optional(),
    qualityFilterSummary: z.record(z.unknown()).nullable().optional(),
    groupingSummary: z.record(z.unknown()).nullable().optional(),
    selectedWriteScope: WriteScopeSchema.optional(),
    includeHidden: z.boolean().optional(),
    includeSupportAsPrimary: z.boolean().optional(),
    viewportRenderedIds: z.array(z.string()).optional(),
    skipExisting: z.boolean().optional(),
    overwrite: z.boolean().optional(),
    confirmLargeWrite: z.boolean().optional(),
  })
  .strict();

function requireWriteCacheOrItems<T extends z.ZodTypeAny>(schema: T): T {
  return schema.refine(
    (body: { cacheId?: string; scanCacheId?: string | null; items?: unknown[] }) =>
      body.cacheId != null || body.scanCacheId != null || (body.items != null && body.items.length > 0),
    { message: "cacheId required (re-scan if expired)" }
  ) as unknown as T;
}

const ValidateWriteBodySchema = requireWriteCacheOrItems(WriteBodyObjectSchema);

const DryRunWriteBodySchema = requireWriteCacheOrItems(
  WriteBodyObjectSchema.extend({
    writeTarget: z.enum(["emulator", "production"]).optional(),
    confirmProductionWrite: z.string().optional(),
  })
);

const WriteBlankSpotsBodySchema = requireWriteCacheOrItems(
  WriteBodyObjectSchema.extend({
    writeTarget: z.enum(["emulator", "production"]),
    confirmProductionWrite: z.string().optional(),
    confirmUndiscoveredShape: z.string().optional(),
  })
);

function resolveWriteItems(body: {
  cacheId?: string;
  scanCacheId?: string | null;
  items?: PbfCopierPreviewDoc[] | Record<string, unknown>[];
  rawItems?: PbfCopierPreviewDoc[] | Record<string, unknown>[];
  qualityFilterSettings?: z.infer<typeof QualityFilterSettingsSchema>;
}): { visibleItems: PbfCopierPreviewDoc[]; rawItems: PbfCopierPreviewDoc[] } | null {
  const cacheKey = body.cacheId ?? body.scanCacheId ?? undefined;
  const fromCache = cacheKey ? getPbfCopierV2ScanCache(cacheKey) : null;
  const rawItems = (body.rawItems as PbfCopierPreviewDoc[] | undefined) ?? fromCache ?? undefined;
  if (!rawItems) return null;

  const settings: PbfQualityFilterSettings = {
    ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
    ...(body.qualityFilterSettings ?? {}),
    hideUnnamedPaths: false,
  };

  if (fromCache || !body.items) {
    const filtered = applyPbfQualityFilters(rawItems, settings);
    return { visibleItems: filtered.items, rawItems };
  }

  const visibleItems =
    (body.items as PbfCopierPreviewDoc[] | undefined) ?? rawItems;
  return { visibleItems, rawItems };
}

function buildWritePayloadInput(
  body: z.infer<typeof WriteBodyObjectSchema>,
  items: { visibleItems: PbfCopierPreviewDoc[]; rawItems: PbfCopierPreviewDoc[] }
) {
  return {
    visibleItems: items.visibleItems,
    rawItems: items.rawItems,
    bbox: body.bbox,
    scanCacheId: body.scanCacheId ?? body.cacheId ?? null,
    qualityFilterSettings: body.qualityFilterSettings
      ? { ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS, ...body.qualityFilterSettings }
      : undefined,
    qualityFilterSummary: body.qualityFilterSummary ?? null,
    groupingSummary: (body.groupingSummary ?? null) as PbfOutdoorGroupingSummary | null,
    selectedWriteScope: body.selectedWriteScope ?? "all_visible",
    includeHidden: body.includeHidden,
    includeSupportAsPrimary: body.includeSupportAsPrimary,
    viewportRenderedIds: body.viewportRenderedIds,
  };
}

const PurgeUndiscoveredBodySchema = z
  .object({
    writeTarget: z.enum(["emulator", "production"]),
    confirmProductionWrite: z.string().optional(),
    confirmPurge: z.string(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export async function registerPbfCopierV2Routes(app: FastifyInstance): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${base}/health`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.health");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const availability = await probePbfParserAvailability();
    return success({
      ok: true,
      pageUrl: "/admin/openstreetmap/pbf-copier-v2",
      apiBase: base,
      parserId: availability.parserId,
      parserVersion: availability.parserVersion,
      parserAvailable: availability.parserAvailable,
      parserAvailabilityReason: availability.reason,
      productionConfirmationPhrase: pbfProductionConfirmationPhrase(),
      undiscoveredShapeConfirmationPhrase: PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
      productionEnvVarName: pbfProductionEnvVarName(),
      productionWritesUnlocked: pbfIsProductionWriteUnlocked(),
      emulatorHostPresent: pbfIsEmulatorActive(),
      forbiddenCollections: PBF_COPIER_FORBIDDEN_COLLECTIONS,
      allowedCollections: PBF_COPIER_ALLOWED_COLLECTIONS,
      postsWriteForbidden: true as const,
      ...pbfUndiscoveredPurgeHealthFields(),
    });
  });

  app.get(`${base}/undiscovered-counts`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.undiscovered_counts");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    try {
      const counts = await getUndiscoveredFirestoreCounts();
      return success(counts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(503).send(failure("undiscovered_counts_failed", message));
    }
  });

  app.get(`${base}/undiscovered-map-preview`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.undiscovered_map_preview");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    try {
      const preview = await getUndiscoveredMapPreviewForAdmin();
      return success(preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(503).send(failure("undiscovered_map_preview_failed", message));
    }
  });

  app.post(`${base}/repair-map-visibility`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.repair_map_visibility");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = z.object({ dryRun: z.boolean().optional() }).strict().parse(request.body ?? {});
    try {
      const result = await repairPbfV2MapVisibility({ dryRun: body.dryRun });
      return success(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("repair_map_visibility_failed", message));
    }
  });

  app.post(`${base}/purge-undiscovered`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.purge_undiscovered");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = PurgeUndiscoveredBodySchema.parse(request.body ?? {});
    try {
      const summary = await purgeAllUndiscoveredSpotsAndRoutes({
        writeTarget: body.writeTarget,
        confirmProductionWrite: body.confirmProductionWrite,
        confirmPurge: body.confirmPurge,
        dryRun: body.dryRun,
      });
      return success({
        ...summary,
        postsWriteForbidden: true as const,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes(":") ? message.split(":")[0]! : "purge_undiscovered_failed";
      return reply.status(400).send(failure(code, message));
    }
  });

  app.post(`${base}/validate-file`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.validate_file");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = ValidateFileBodySchema.parse(request.body ?? {});
    const result = await validatePbfFile(body.filePath);
    return success({
      ...result,
      readOnly: true as const,
      firebaseWrites: false as const,
      postsWriteForbidden: true as const,
    });
  });

  app.post(`${base}/audit`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.audit");
    if (env.NODE_ENV === "production") {
      return reply.status(404).send(failure("not_found", "PBF audit is disabled in production"));
    }
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = AuditBodySchema.parse(request.body ?? {});
    try {
      const result = await runPbfCopierV2Audit({
        pbfPath: body.pbfPath,
        bbox: body.bbox,
        limit: body.limit,
        includeRejected: body.includeRejected,
        includeRawTags: body.includeRawTags,
        includeGeometry: body.includeGeometry,
        includeWritePreview: body.includeWritePreview,
        dryRun: body.dryRun ?? true,
        sampleMode: body.sampleMode,
        categoryFilter: body.categoryFilter,
        osmIdFilter: body.osmIdFilter,
        maxRawObjectsScanned: body.maxRawObjectsScanned,
        qualitySettings: body.qualityFilterSettings
          ? { ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS, ...body.qualityFilterSettings }
          : undefined,
      });
      return success({
        ...result,
        readOnly: true as const,
        firebaseWrites: false as const,
        postsWriteForbidden: true as const,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes(":") ? message.split(":")[0]! : "pbf_audit_failed";
      return reply.status(400).send(failure(code, message));
    }
  });

  app.post(`${base}/viewport-preview`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.viewport_preview");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = ViewportPreviewBodySchema.parse(request.body ?? {});
    try {
      const result = await scanPbfViewportPreview({
        pbfPath: body.pbfPath,
        bbox: body.bbox,
        mode: body.mode,
      });
      const settings: PbfQualityFilterSettings = {
        ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
        ...(body.qualityFilterSettings ?? {}),
        hideUnnamedPaths: false,
      };
      const cacheId = storePbfCopierV2ScanCache(body.pbfPath, result.items);
      const filtered = runPbfCopierV2Pipeline({ rawItems: result.items, qualitySettings: settings });
      return success({
        ...result,
        items: filtered.items,
        rawItemCount: result.items.length,
        cacheId,
        summary: filtered.summary,
        groupingSummary: filtered.groupingSummary,
        destinationQualityCounters: filtered.destinationQualityCounters,
        readOnly: true as const,
        firebaseWrites: false as const,
        postsWriteForbidden: true as const,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes(":") ? message.split(":")[0]! : "viewport_preview_failed";
      return reply.status(400).send(failure(code, message));
    }
  });

  app.post(`${base}/apply-quality-filters`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.apply_quality_filters");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = ApplyQualityFiltersBodySchema.parse(request.body ?? {});
    const settings: PbfQualityFilterSettings = {
      ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
      ...(body.settings ?? {}),
    };
    const rawItems = body.cacheId
      ? getPbfCopierV2ScanCache(body.cacheId)
      : (body.items as PbfCopierPreviewDoc[] | undefined);
    if (!rawItems) {
      return reply.status(404).send(failure("scan_cache_expired", "Scan cache expired — re-scan the viewport."));
    }
    const result = applyPbfQualityFilters(rawItems, settings);
    return success({
      ...result,
      readOnly: true as const,
    });
  });

  app.post(`${base}/validate-write-payload`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.validate_write_payload");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = ValidateWriteBodySchema.parse(request.body ?? {});
    const items = resolveWriteItems(body);
    if (!items) {
      return reply.status(404).send(failure("scan_cache_expired", "Scan cache expired — re-scan the viewport."));
    }
    try {
      const summary = summarizePbfV2WriteItems({
        rawItems: items.rawItems,
        visibleItems: items.visibleItems,
        viewportRenderedIds: body.viewportRenderedIds,
      });
      const result = await validatePbfV2WritePayload({
        ...buildWritePayloadInput(body, items),
        skipExisting: body.skipExisting,
      });
      return success({
        ...result,
        summary,
        writeTarget: result.writeTarget,
        postsWriteForbidden: true as const,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("validate_write_payload_failed", message));
    }
  });

  app.post(`${base}/dry-run-write`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.dry_run_write");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = DryRunWriteBodySchema.parse(request.body ?? {});
    const items = resolveWriteItems(body);
    if (!items) {
      return reply.status(404).send(failure("scan_cache_expired", "Scan cache expired — re-scan the viewport."));
    }
    try {
      const summary = summarizePbfV2WriteItems({
        rawItems: items.rawItems,
        visibleItems: items.visibleItems,
        viewportRenderedIds: body.viewportRenderedIds,
      });
      const result = await executePbfV2Write({
        ...buildWritePayloadInput(body, items),
        writeTarget: body.writeTarget ?? "production",
        confirmProductionWrite: body.confirmProductionWrite,
        dryRun: true,
        skipExisting: body.skipExisting,
        overwrite: body.overwrite,
        confirmLargeWrite: body.confirmLargeWrite,
      });
      return success({
        ...result,
        summary,
        postsWriteForbidden: true as const,
        firebaseWrites: false as const,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("dry_run_write_failed", message));
    }
  });

  app.post(`${base}/write-blank-spots`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.write_blank_spots");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = WriteBlankSpotsBodySchema.parse(request.body ?? {});
    const items = resolveWriteItems(body);
    if (!items) {
      return reply.status(404).send(failure("scan_cache_expired", "Scan cache expired — re-scan the viewport."));
    }
    try {
      const summary = summarizePbfV2WriteItems({
        rawItems: items.rawItems,
        visibleItems: items.visibleItems,
        viewportRenderedIds: body.viewportRenderedIds,
      });
      const result = await executePbfV2Write({
        ...buildWritePayloadInput(body, items),
        writeTarget: body.writeTarget,
        confirmProductionWrite: body.confirmProductionWrite,
        confirmUndiscoveredShape: body.confirmUndiscoveredShape ?? PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
        dryRun: false,
        skipExisting: body.skipExisting,
        overwrite: body.overwrite,
        confirmLargeWrite: body.confirmLargeWrite,
      });
      if (result.errors.length > 0 && result.written === 0) {
        return reply.status(400).send(
          failure(result.validationErrors[0] ?? "write_failed", result.errors.join("; "))
        );
      }
      return success({
        ...result,
        summary,
        postsWriteForbidden: true as const,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("write_blank_spots_failed", message));
    }
  });

  const FullRunStartSchema = z
    .object({
      pbfPath: z.string().min(1),
      mode: z.enum(["dry_run", "write_test", "write_prod"]).optional(),
      tileStepDegrees: z.number().min(0.1).max(2).optional(),
      maxChunks: z.number().int().min(1).max(500).nullable().optional(),
      maxTotalSpots: z.number().int().min(1).max(500_000).nullable().optional(),
      qualityFilterSettings: QualityFilterSettingsSchema.optional(),
    })
    .strict();

  const FullRunIdSchema = z.object({ runId: z.string().min(1) }).strict();

  const FullRunWriteSchema = FullRunIdSchema.extend({
    dryRun: z.boolean().optional(),
    writeTarget: z.enum(["none", "emulator", "production"]).optional(),
    confirmProductionWrite: z.string().optional(),
    confirmUndiscoveredShape: z.string().optional(),
    skipExisting: z.boolean().optional(),
    chunkIds: z.array(z.string()).optional(),
  }).strict();

  app.post(`${base}/full-run/start`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_start");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = FullRunStartSchema.parse(request.body ?? {});
    try {
      const run = await startPbfV2FullRun({
        ...body,
        qualityFilterSettings: body.qualityFilterSettings
          ? { ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS, ...body.qualityFilterSettings }
          : undefined,
      });
      return success({ run, postsWriteForbidden: true as const });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("full_run_start_failed", message));
    }
  });

  app.post(`${base}/full-run/pause`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_pause");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = FullRunIdSchema.parse(request.body ?? {});
    const run = await pausePbfV2FullRun(body.runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Run not found"));
    return success({ run });
  });

  app.post(`${base}/full-run/resume`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_resume");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = FullRunIdSchema.parse(request.body ?? {});
    const run = await resumePbfV2FullRun(body.runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Run not found"));
    return success({ run });
  });

  app.post(`${base}/full-run/stop`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_stop");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = FullRunIdSchema.parse(request.body ?? {});
    const run = await stopPbfV2FullRun(body.runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Run not found"));
    return success({ run });
  });

  app.post(`${base}/full-run/write-current`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_write_current");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = FullRunWriteSchema.parse(request.body ?? {});
    try {
      const result = await writePbfV2FullRunChunks(body);
      if (!result.run) return reply.status(404).send(failure("run_not_found", "Run not found"));
      const status = await getPbfV2FullRunStatus(body.runId);
      return success({
        ...result,
        writeReadyCounts: status.writeReadyCounts,
        postsWriteForbidden: body.dryRun !== false && result.run.mode === "dry_run",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("full_run_write_failed", message));
    }
  });

  app.get(`${base}/full-run/status`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_status");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const runId = z.string().min(1).parse((request.query as { runId?: string }).runId);
    const status = await getPbfV2FullRunStatus(runId);
    if (!status.run) return reply.status(404).send(failure("run_not_found", "Run not found"));
    return success(status);
  });

  app.get(`${base}/full-run/runs`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_runs");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const runs = await listPbfV2FullRuns(30);
    return success({ runs });
  });

  app.get(`${base}/full-run/chunks`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.full_run_chunks");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const runId = z.string().min(1).parse((request.query as { runId?: string }).runId);
    const chunks = await listPbfV2FullRunChunks(runId);
    return success({ runId, chunks });
  });

  const PbfPhotoVisionModeSchema = z.enum(["off", "borderline_only", "top_only", "all_candidates"]);

  const PbfAssetPreviewFetchSchema = z.object({
    runId: z.string().trim().min(1).optional(),
    chunkId: z.string().trim().min(1).optional(),
    maxSpots: z.number().int().min(1).max(100).optional(),
    activeRunId: z.string().trim().min(1).optional(),
    concurrency: z.number().int().min(2).max(8).optional(),
    visionMode: PbfPhotoVisionModeSchema.optional(),
    geminiApiKey: z.string().trim().min(20).max(512).optional(),
    strictTitleSourceMatch: z.boolean().optional(),
  });

  const PbfAssetPreviewLiveFetchSchema = z.object({
    pbfPath: z.string().trim().min(1).optional(),
    maxSpots: z.number().int().min(1).max(100).optional(),
    tileStepDegrees: z.number().min(0.2).max(1).optional(),
    startTileIndex: z.number().int().min(0).optional(),
    visionMode: PbfPhotoVisionModeSchema.optional(),
    geminiApiKey: z.string().trim().min(20).max(512).optional(),
    strictTitleSourceMatch: z.boolean().optional(),
  });

  const PbfAssetPreviewVisionQaSchema = z.object({
    doc: z.record(z.unknown()),
    visionMode: PbfPhotoVisionModeSchema.default("borderline_only"),
    geminiApiKey: z.string().trim().min(20).max(512).optional(),
  });

  app.get(`${base}/asset-preview/live-sources`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.asset_preview_live_sources");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const query = request.query as { pbfPath?: string; tileStepDegrees?: string };
    const tileStep = query.tileStepDegrees ? Number(query.tileStepDegrees) : undefined;
    try {
      const sources = await getPbfAssetPreviewLiveSources({
        pbfPath: query.pbfPath?.trim() || null,
        tileStepDegrees: Number.isFinite(tileStep) ? tileStep : undefined,
      });
      const { pbfPath, resolvedPath, readable, fileSizeBytes, tileStepDegrees, totalTiles, message } = sources;
      return success({ pbfPath, resolvedPath, readable, fileSizeBytes, tileStepDegrees, totalTiles, message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read Vermont PBF.";
      return reply.status(500).send(failure("asset_preview_live_sources_failed", message));
    }
  });

  app.get(`${base}/asset-preview/sources`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.asset_preview_sources");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const query = request.query as { runId?: string; activeRunId?: string };
    try {
      const sources = await listPbfAssetPreviewSources(
        query.runId?.trim() || null,
        query.activeRunId?.trim() || null,
      );
      const { runs, chunks, defaultRunId, activeRunId, prefersWriteRuns } = sources;
      return success({ runs, chunks, defaultRunId, activeRunId, prefersWriteRuns });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list asset preview sources.";
      return reply.status(500).send(failure("asset_preview_sources_failed", message));
    }
  });

  app.post(`${base}/asset-preview/fetch`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.asset_preview_fetch");
    if (!(await requirePbfAdmin(request, reply, env))) return;

    let body: unknown;
    try {
      body = request.body ?? {};
    } catch {
      return reply.status(400).send(failure("invalid_request", "Request body must be valid JSON."));
    }

    const parsed = PbfAssetPreviewFetchSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send(failure("invalid_request", "Invalid asset preview fetch body."));
    }

    const headerGeminiKey = String(request.headers["x-pbf-asset-gemini-api-key"] ?? "").trim();
    const geminiApiKey = parsed.data.geminiApiKey ?? (headerGeminiKey || undefined);

    try {
      const result = await fetchPbfAssetPreview({
        env,
        runId: parsed.data.runId ?? null,
        activeRunId: parsed.data.activeRunId ?? null,
        chunkId: parsed.data.chunkId ?? null,
        maxSpots: parsed.data.maxSpots,
        concurrency: parsed.data.concurrency,
        geminiApiKey,
        visionMode: parsed.data.visionMode ?? "off",
        strictTitleSourceMatch: parsed.data.strictTitleSourceMatch,
      });
      const { runId, chunkId, mode, progress, items } = result;
      return success({ runId, chunkId, mode, progress, items });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Asset preview fetch failed.";
      request.log.error({ message }, "pbf_copier_v2.asset_preview_fetch_failure");
      const status = message.includes("No PBF V2") ? 404 : 502;
      return reply.status(status).send(failure("asset_preview_fetch_failed", message));
    }
  });

  app.post(`${base}/asset-preview/fetch-stream`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.asset_preview_fetch_stream");
    if (!(await requirePbfAdmin(request, reply, env))) return;

    let body: unknown;
    try {
      body = request.body ?? {};
    } catch {
      return reply.status(400).send(failure("invalid_request", "Request body must be valid JSON."));
    }

    const parsed = PbfAssetPreviewFetchSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send(failure("invalid_request", "Invalid asset preview fetch body."));
    }

    const headerGeminiKey = String(request.headers["x-pbf-asset-gemini-api-key"] ?? "").trim();
    const geminiApiKey = parsed.data.geminiApiKey ?? (headerGeminiKey || undefined);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof reply.raw.flushHeaders === "function") {
      reply.raw.flushHeaders();
    }

    const writeSse = (obj: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
      const raw = reply.raw as NodeJS.WritableStream & { flush?: () => void };
      raw.flush?.();
    };

    request.raw.on("close", () => {
      reply.raw.end();
    });

    try {
      await streamPbfAssetPreview(
        {
          env,
          runId: parsed.data.runId ?? null,
          activeRunId: parsed.data.activeRunId ?? null,
          chunkId: parsed.data.chunkId ?? null,
          maxSpots: parsed.data.maxSpots,
          concurrency: parsed.data.concurrency,
          geminiApiKey,
          visionMode: parsed.data.visionMode ?? "off",
          strictTitleSourceMatch: parsed.data.strictTitleSourceMatch,
        },
        (event) => writeSse(event),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Asset preview stream failed.";
      writeSse({ type: "error", message });
    }
    reply.raw.end();
  });

  app.post(`${base}/asset-preview/fetch-stream-live`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.asset_preview_fetch_stream_live");
    if (!(await requirePbfAdmin(request, reply, env))) return;

    let body: unknown;
    try {
      body = request.body ?? {};
    } catch {
      return reply.status(400).send(failure("invalid_request", "Request body must be valid JSON."));
    }

    const parsed = PbfAssetPreviewLiveFetchSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send(failure("invalid_request", "Invalid live asset preview fetch body."));
    }

    const headerGeminiKey = String(request.headers["x-pbf-asset-gemini-api-key"] ?? "").trim();
    const geminiApiKey = parsed.data.geminiApiKey ?? (headerGeminiKey || undefined);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof reply.raw.flushHeaders === "function") {
      reply.raw.flushHeaders();
    }

    let aborted = false;
    request.raw.on("close", () => {
      aborted = true;
      reply.raw.end();
    });

    const writeSse = (obj: unknown) => {
      if (aborted) return;
      reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
      const raw = reply.raw as NodeJS.WritableStream & { flush?: () => void };
      raw.flush?.();
    };

    try {
      await streamPbfAssetPreviewFromLivePbf(
        {
          env,
          pbfPath: parsed.data.pbfPath ?? null,
          maxSpots: parsed.data.maxSpots,
          tileStepDegrees: parsed.data.tileStepDegrees,
          startTileIndex: parsed.data.startTileIndex,
          geminiApiKey,
          visionMode: parsed.data.visionMode ?? "off",
          strictTitleSourceMatch: parsed.data.strictTitleSourceMatch,
          shouldAbort: () => aborted,
        },
        (event) => writeSse(event),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live asset preview stream failed.";
      writeSse({ type: "error", message });
    }
    if (!aborted) reply.raw.end();
  });

  app.post(`${base}/asset-preview/vision-qa-spot`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier_v2.asset_preview_vision_qa_spot");
    if (!(await requirePbfAdmin(request, reply, env))) return;

    let body: unknown;
    try {
      body = request.body ?? {};
    } catch {
      return reply.status(400).send(failure("invalid_request", "Request body must be valid JSON."));
    }

    const parsed = PbfAssetPreviewVisionQaSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send(failure("invalid_request", "Invalid vision QA body."));
    }

    const headerGeminiKey = String(request.headers["x-pbf-asset-gemini-api-key"] ?? "").trim();
    const geminiApiKey = parsed.data.geminiApiKey ?? (headerGeminiKey || undefined);

    try {
      const result = await processPbfAssetPreviewSpot(parsed.data.doc as PbfCopierPreviewDoc, {
        env,
        geminiApiKey,
        visionMode: parsed.data.visionMode,
      });
      return success({ item: result.item, stats: result.stats });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Vision QA spot failed.";
      return reply.status(502).send(failure("asset_preview_vision_qa_failed", message));
    }
  });
}
