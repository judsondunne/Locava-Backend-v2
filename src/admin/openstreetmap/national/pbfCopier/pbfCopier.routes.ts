import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../../../auth/admin-access.js";
import type { AppEnv } from "../../../../config/env.js";
import { failure, success } from "../../../../lib/response.js";
import { setRouteName } from "../../../../observability/request-context.js";
import {
  cancelPbfCopierRun,
  diagnosePlaceInPbf,
  startDryRunPbfPreview,
  exportPbfCopierRun,
  getPbfCopierRunDetail,
  listPbfCopierEventsForRun,
  listPbfCopierRunsSummary,
  pausePbfCopierRun,
  pbfCopierHealth,
  planPbfCopierRun,
  resumePbfCopierRun,
  startPbfCopierRun,
  validatePbfFile,
} from "./pbfCopierService.js";
import { startWritePreviewDocs } from "./pbfCopierPreviewWrite.js";
import { purgeAllUndiscoveredSpotsAndRoutes } from "./pbfCopierUndiscoveredPurge.js";

const base = "/admin/openstreetmap/api/pbf-copier";

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

const ConfigSchema = z
  .object({
    filePath: z.string().min(1),
    dryRunLimit: z.number().int().min(1).max(5000).optional(),
    maxAcceptedMode: z.boolean().optional(),
    dryRunStopMode: z.enum(["max_accepted", "quotas"]).optional(),
    dryRunQuotas: z.record(z.string(), z.number().int().min(1)).optional(),
    balancedPreview: z.boolean().optional(),
    requireWaysBeforeStop: z.boolean().optional(),
    minWayCandidatesBeforeStop: z.number().int().min(0).optional(),
    dryRunNodePhaseCap: z.number().int().min(1).optional(),
    dryRunNodeSpotLimit: z.number().int().min(1).optional(),
    dryRunWaySpotLimit: z.number().int().min(1).optional(),
    dryRunRouteLimit: z.number().int().min(1).optional(),
    maxRawObjectsToScan: z.number().int().min(1).nullable().optional(),
    classifyBatchSize: z.number().int().min(1).max(10000).optional(),
    includeSpots: z.boolean().optional(),
    includeRoutes: z.boolean().optional(),
    includePublicOnly: z.boolean().optional(),
    includeReviewDocs: z.boolean().optional(),
    skipExisting: z.boolean().optional(),
    overwriteExisting: z.boolean().optional(),
    maxDocsToWrite: z.number().int().nonnegative().nullable().optional(),
    maxWritesPerSecond: z.number().nonnegative().optional(),
    maxWritesPerMinute: z.number().nonnegative().optional(),
    stopOnBudgetExceeded: z.boolean().optional(),
    stateCode: z.string().optional(),
    geoFilterEnabled: z.boolean().optional(),
    geoFilterCenterLat: z.coerce.number().nullable().optional(),
    geoFilterCenterLng: z.coerce.number().nullable().optional(),
    geoFilterRadiusKm: z.coerce.number().min(2).max(80).optional(),
    geoFilterRadiusMiles: z.coerce.number().min(0.1).max(500).optional(),
  })
  .strict();

const ValidateFileBodySchema = z
  .object({ filePath: z.string().min(1) })
  .strict();

const DryRunBodySchema = z
  .object({
    filePath: z.string().min(1),
    acceptedLimit: z.number().int().min(1).max(5000).optional(),
    /** Omit or null = no raw cap (scan until accepted limit or EOF). */
    maxRawObjectsToScan: z.number().int().min(1).nullable().optional(),
    maxAcceptedMode: z.boolean().optional(),
    dryRunStopMode: z.enum(["max_accepted", "quotas"]).optional(),
    dryRunQuotas: z.record(z.string(), z.number().int().min(1)).optional(),
    balancedPreview: z.boolean().optional(),
    requireWaysBeforeStop: z.boolean().optional(),
    minWayCandidatesBeforeStop: z.number().int().min(0).optional(),
    dryRunNodePhaseCap: z.number().int().min(1).optional(),
    dryRunNodeSpotLimit: z.number().int().min(1).optional(),
    dryRunWaySpotLimit: z.number().int().min(1).optional(),
    dryRunRouteLimit: z.number().int().min(1).optional(),
    includeSpots: z.boolean().optional(),
    includeRoutes: z.boolean().optional(),
    includePublicOnly: z.boolean().optional(),
    includeReviewDocs: z.boolean().optional(),
    skipExisting: z.boolean().optional(),
    stateCode: z.string().optional(),
    classifyBatchSize: z.number().int().min(1).max(10000).optional(),
    geoFilterEnabled: z.boolean().optional(),
    geoFilterCenterLat: z.coerce.number().nullable().optional(),
    geoFilterCenterLng: z.coerce.number().nullable().optional(),
    geoFilterRadiusKm: z.coerce.number().min(2).max(80).optional(),
    geoFilterRadiusMiles: z.coerce.number().min(0.1).max(500).optional(),
    writeTarget: z.literal("none").optional(),
    dryRunOnly: z.literal(true).optional(),
    fast: z.boolean().optional(),
  })
  .strict();

const DiagnosePlaceBodySchema = z
  .object({
    filePath: z.string().min(1),
    searchText: z.string().min(1),
    maxRawObjectsToScan: z.number().int().min(1).nullable().optional(),
    includeNodes: z.boolean().optional(),
    includeWays: z.boolean().optional(),
    includeRelations: z.boolean().optional(),
    includePublicOnly: z.boolean().optional(),
    includeReviewDocs: z.boolean().optional(),
    stateCode: z.string().optional(),
  })
  .strict();

const WritePreviewDocsBodySchema = z
  .object({
    writeTarget: z.enum(["emulator", "production"]),
    confirmProductionWrite: z.string().optional(),
    confirmUndiscoveredShape: z.string().optional(),
    limit: z.number().int().min(1).optional(),
    skipExisting: z.boolean().optional(),
    includeSpots: z.boolean().optional(),
    includeRoutes: z.boolean().optional(),
  })
  .strict();

async function handleWritePreviewDocs(
  request: FastifyRequest,
  reply: FastifyReply,
  dryRunRunId: string
) {
  const body = WritePreviewDocsBodySchema.parse(request.body ?? {});
  try {
    const run = startWritePreviewDocs({
      dryRunRunId,
      writeTarget: body.writeTarget,
      confirmProductionWrite: body.confirmProductionWrite,
      confirmUndiscoveredShape: body.confirmUndiscoveredShape,
      limit: body.limit,
      skipExisting: body.skipExisting,
      includeSpots: body.includeSpots,
      includeRoutes: body.includeRoutes,
    });
    const spotsPlanned = run.previewWritePlannedSpots ?? 0;
    const routesPlanned = run.previewWritePlannedRoutes ?? 0;
    return success({
      runId: run.runId,
      run,
      started: true as const,
      writeTarget: body.writeTarget,
      spotsPlanned,
      routesPlanned,
      docsPlanned: spotsPlanned + routesPlanned,
      sourceDryRunRunId: dryRunRunId,
      postsWriteForbidden: true as const,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code ?? "write_preview_docs_failed";
    return reply.status(400).send(failure(code, message));
  }
}

const PlanBodySchema = z
  .object({
    mode: z.enum(["dry_run_preview", "fast_dry_run", "write"]),
    writeTarget: z.enum(["none", "emulator", "production"]).optional(),
    confirmProductionWrite: z.string().optional(),
    confirmUndiscoveredShape: z.string().optional(),
    dryRunProofToken: z.string().optional(),
    config: ConfigSchema,
  })
  .strict();

const PurgeUndiscoveredBodySchema = z
  .object({
    writeTarget: z.enum(["emulator", "production"]),
    confirmProductionWrite: z.string().optional(),
    confirmPurge: z.string(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export async function registerPbfCopierRoutes(app: FastifyInstance): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${base}/health`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.health");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    return success(await pbfCopierHealth());
  });

  app.post(`${base}/purge-undiscovered`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.purge_undiscovered");
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
      const code = message.includes(":")
        ? message.split(":")[0]!
        : "purge_undiscovered_failed";
      return reply.status(400).send(failure(code, message));
    }
  });

  app.post(`${base}/validate-file`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.validate_file");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = ValidateFileBodySchema.parse(request.body ?? {});
    const result = await validatePbfFile(body.filePath);
    return success({
      ...result,
      target: { collection: "unexploredSpots | unexploredRoutes", postsWriteForbidden: true },
      dryRunOnly: true,
      writeTarget: "none" as const,
    });
  });

  app.post(`${base}/dry-run`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.dry_run");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = DryRunBodySchema.parse(request.body ?? {});
    try {
      const run = startDryRunPbfPreview({
        filePath: body.filePath,
        acceptedLimit: body.acceptedLimit,
        maxRawObjectsToScan: body.maxRawObjectsToScan,
        mode: body.fast ? "fast_dry_run" : "dry_run_preview",
        config: {
          filePath: body.filePath,
          maxAcceptedMode: body.maxAcceptedMode,
          dryRunStopMode: body.dryRunStopMode,
          dryRunQuotas: body.dryRunQuotas,
          balancedPreview: body.balancedPreview,
          requireWaysBeforeStop: body.requireWaysBeforeStop,
          minWayCandidatesBeforeStop: body.minWayCandidatesBeforeStop,
          dryRunNodePhaseCap: body.dryRunNodePhaseCap,
          dryRunNodeSpotLimit: body.dryRunNodeSpotLimit,
          dryRunWaySpotLimit: body.dryRunWaySpotLimit,
          dryRunRouteLimit: body.dryRunRouteLimit,
          includeSpots: body.includeSpots,
          includeRoutes: body.includeRoutes,
          includePublicOnly: body.includePublicOnly,
          includeReviewDocs: body.includeReviewDocs,
          skipExisting: body.skipExisting,
          stateCode: body.stateCode,
          classifyBatchSize: body.classifyBatchSize,
          geoFilterEnabled: body.geoFilterEnabled,
          geoFilterCenterLat: body.geoFilterCenterLat,
          geoFilterCenterLng: body.geoFilterCenterLng,
          geoFilterRadiusKm: body.geoFilterRadiusKm,
          geoFilterRadiusMiles: body.geoFilterRadiusMiles,
        },
      });
      return success({
        runId: run.runId,
        run,
        started: true as const,
        productionWritesBlocked: true as const,
        target: { collection: "unexploredSpots | unexploredRoutes", postsWriteForbidden: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("dry_run_failed", message));
    }
  });

  app.post(`${base}/diagnose-place`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.diagnose_place");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = DiagnosePlaceBodySchema.parse(request.body ?? {});
    try {
      const result = await diagnosePlaceInPbf({
        filePath: body.filePath,
        searchText: body.searchText,
        maxRawObjectsToScan: body.maxRawObjectsToScan ?? null,
        includeNodes: body.includeNodes,
        includeWays: body.includeWays,
        includeRelations: body.includeRelations,
        includePublicOnly: body.includePublicOnly,
        includeReviewDocs: body.includeReviewDocs,
        stateCode: body.stateCode,
      });
      return success({
        ...result,
        dryRunOnly: true as const,
        writeTarget: "none" as const,
        postsWriteForbidden: true as const,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("diagnose_place_failed", message));
    }
  });

  app.post(`${base}/runs/:runId/write-preview-docs`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.write_preview_docs");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    return handleWritePreviewDocs(request, reply, runId);
  });

  app.post(`${base}/runs/:runId/write-preview-spots`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.write_preview_spots");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    return handleWritePreviewDocs(request, reply, runId);
  });

  app.post(`${base}/runs/start`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.start");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const body = PlanBodySchema.parse(request.body ?? {});
    try {
      const planned = planPbfCopierRun({
        mode: body.mode,
        writeTarget: body.writeTarget,
        confirmProductionWrite: body.confirmProductionWrite,
        confirmUndiscoveredShape: body.confirmUndiscoveredShape,
        dryRunProofToken: body.dryRunProofToken,
        config: body.config,
      });
      // Fire-and-forget runner; client polls via /runs/:id.
      void startPbfCopierRun(planned.runId).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        app.log.warn({ runId: planned.runId, err: message }, "pbf_copier_run_failed");
      });
      return success({ runId: planned.runId, run: planned });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code ?? "start_failed";
      return reply.status(400).send(failure(code, message));
    }
  });

  app.post(`${base}/runs/:runId/pause`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.pause");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    try {
      return success({ run: pausePbfCopierRun(runId) });
    } catch (error) {
      return reply
        .status(404)
        .send(failure("not_found", error instanceof Error ? error.message : String(error)));
    }
  });

  app.post(`${base}/runs/:runId/resume`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.resume");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    try {
      const run = resumePbfCopierRun(runId);
      return success({ run });
    } catch (error) {
      return reply
        .status(400)
        .send(failure("resume_failed", error instanceof Error ? error.message : String(error)));
    }
  });

  app.post(`${base}/runs/:runId/cancel`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.cancel");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    try {
      return success({ run: cancelPbfCopierRun(runId) });
    } catch (error) {
      return reply
        .status(404)
        .send(failure("not_found", error instanceof Error ? error.message : String(error)));
    }
  });

  app.get(`${base}/runs`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.list_runs");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    return success({ runs: listPbfCopierRunsSummary(50) });
  });

  app.get(`${base}/runs/:runId`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.detail");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const run = getPbfCopierRunDetail(runId);
    if (!run) return reply.status(404).send(failure("not_found", "Run not found"));
    return success({ run });
  });

  app.get(`${base}/runs/:runId/events`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.events");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const limit = Number((request.query as { limit?: string }).limit ?? 100);
    return success({ events: listPbfCopierEventsForRun(runId, Math.min(500, Math.max(1, limit))) });
  });

  app.get(`${base}/runs/:runId/preview`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.preview");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const run = getPbfCopierRunDetail(runId);
    if (!run) return reply.status(404).send(failure("not_found", "Run not found"));
    return success({
      runId: run.runId,
      previewDocs: run.previewDocs,
      acceptedActivitySamples: run.acceptedActivitySamples,
      rejectedReasonSamples: run.rejectedReasonSamples,
      rejectionReasonCounts: run.rejectionReasonCounts,
      rejectedSamples: run.rejectedSamples,
      rejectedSamplesTruncated: run.rejectedSamplesTruncated,
      missingMetadataWarnings: run.missingMetadataWarnings,
      dryRunProofToken: run.dryRunProofToken,
    });
  });

  app.get(`${base}/runs/:runId/export`, async (request, reply) => {
    setRouteName("admin.osm.pbf_copier.export");
    if (!(await requirePbfAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const exported = exportPbfCopierRun(runId);
    if (!exported) return reply.status(404).send(failure("not_found", "Run not found"));
    return success({ export: exported });
  });
}
