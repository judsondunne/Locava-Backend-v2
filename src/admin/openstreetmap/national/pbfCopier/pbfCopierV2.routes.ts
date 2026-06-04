import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../../../auth/admin-access.js";
import type { AppEnv } from "../../../../config/env.js";
import { failure, success } from "../../../../lib/response.js";
import { setRouteName } from "../../../../observability/request-context.js";
import { validatePbfFile } from "./pbfCopierService.js";
import { scanPbfViewportPreview } from "./pbfCopierV2ViewportPreview.js";
import {
  applyPbfQualityFilters,
  DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
  type PbfQualityFilterSettings,
} from "./pbfCopierV2QualityFilters.js";
import { getPbfCopierV2ScanCache, storePbfCopierV2ScanCache } from "./pbfCopierV2ScanCache.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import {
  executePbfV2Write,
  summarizePbfV2WriteItems,
  validatePbfV2WritePayload,
} from "./pbfCopierV2Write.js";
import { PBF_UNDISCOVERED_SHAPE_CONFIRMATION } from "./pbfCopierGuards.js";
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

export async function registerPbfCopierV2Routes(app: FastifyInstance): Promise<void> {
  const env = app.config as AppEnv;

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
      };
      const cacheId = storePbfCopierV2ScanCache(body.pbfPath, result.items);
      const filtered = applyPbfQualityFilters(result.items, settings);
      return success({
        ...result,
        items: filtered.items,
        rawItemCount: result.items.length,
        cacheId,
        summary: filtered.summary,
        groupingSummary: filtered.groupingSummary,
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
}
