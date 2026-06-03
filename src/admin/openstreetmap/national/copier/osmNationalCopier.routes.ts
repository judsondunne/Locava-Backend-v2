import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../../../auth/admin-access.js";
import type { AppEnv } from "../../../../config/env.js";
import { failure, success } from "../../../../lib/response.js";
import { setRouteName } from "../../../../observability/request-context.js";
import {
  cancelCopierRun,
  copierHealth,
  dryRunFirstAccepted,
  exportCopierRun,
  getCopierRunDetail,
  listCopierEventsForRun,
  listCopierRunsSummary,
  pauseCopierRun,
  planCopierRun,
  resumeCopierRun,
  startCopierRun,
} from "./osmNationalCopierService.js";

const base = "/admin/openstreetmap/api/national-copier";

async function requireCopierAdmin(
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
    dryRunLimit: z.number().int().min(1).max(1000).optional(),
    includeSpots: z.boolean().optional(),
    includeRoutes: z.boolean().optional(),
    includePublicOnly: z.boolean().optional(),
    includeReviewDocs: z.boolean().optional(),
    buildUnexploredTiles: z.boolean().optional(),
    skipExisting: z.boolean().optional(),
    overwriteExisting: z.boolean().optional(),
    maxDocsToWrite: z.number().int().nonnegative().nullable().optional(),
    maxChunksToProcess: z.number().int().positive().nullable().optional(),
    maxWritesPerSecond: z.number().nonnegative().optional(),
    maxWritesPerMinute: z.number().nonnegative().optional(),
    stopOnBudgetExceeded: z.boolean().optional(),
    chunkSizeKm: z.number().positive().max(300).optional(),
    stateCodes: z.array(z.string()).optional(),
  })
  .strict();

const PlanBodySchema = z
  .object({
    mode: z.enum(["dry_run_preview", "write"]),
    writeTarget: z.enum(["none", "emulator", "production"]).optional(),
    confirmProductionWrite: z.string().optional(),
    config: ConfigSchema.optional(),
  })
  .strict();

const DryRunBodySchema = z
  .object({
    dryRunLimit: z.number().int().min(1).max(1000).optional(),
    includeSpots: z.boolean().optional(),
    includeRoutes: z.boolean().optional(),
    includePublicOnly: z.boolean().optional(),
    includeReviewDocs: z.boolean().optional(),
    skipExisting: z.boolean().optional(),
    maxChunksToScan: z.number().int().positive().max(2000).optional(),
    chunkSizeKm: z.number().positive().max(300).optional(),
    stateCodes: z.array(z.string()).optional(),
  })
  .strict();

export async function registerOsmNationalCopierRoutes(app: FastifyInstance): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${base}/health`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.health");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    return success(copierHealth());
  });

  app.post(`${base}/dry-run`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.dry_run");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const body = DryRunBodySchema.parse(request.body ?? {});
    try {
      const run = await dryRunFirstAccepted({
        config: {
          dryRunLimit: body.dryRunLimit,
          includeSpots: body.includeSpots,
          includeRoutes: body.includeRoutes,
          includePublicOnly: body.includePublicOnly,
          includeReviewDocs: body.includeReviewDocs,
          skipExisting: body.skipExisting,
          chunkSizeKm: body.chunkSizeKm,
          stateCodes: body.stateCodes,
        },
        maxChunksToScan: body.maxChunksToScan,
      });
      return success({
        run,
        productionWritesBlocked: true as const,
        target: { collection: "unexploredSpots | unexploredRoutes", postsWriteForbidden: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("dry_run_failed", message));
    }
  });

  app.post(`${base}/runs/plan`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.plan");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const body = PlanBodySchema.parse(request.body ?? {});
    try {
      const run = planCopierRun({
        mode: body.mode,
        writeTarget: body.writeTarget,
        confirmProductionWrite: body.confirmProductionWrite,
        config: body.config,
      });
      return success({ run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code ?? "plan_failed";
      return reply.status(400).send(failure(code, message));
    }
  });

  app.post(`${base}/runs/start`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.start");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const body = z.object({ runId: z.string() }).parse(request.body ?? {});
    try {
      const run = await startCopierRun(body.runId);
      return success({ run });
    } catch (error) {
      return reply
        .status(400)
        .send(failure("start_failed", error instanceof Error ? error.message : String(error)));
    }
  });

  app.post(`${base}/runs/:runId/pause`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.pause");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    try {
      return success({ run: pauseCopierRun(runId) });
    } catch (error) {
      return reply
        .status(404)
        .send(failure("not_found", error instanceof Error ? error.message : String(error)));
    }
  });

  app.post(`${base}/runs/:runId/resume`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.resume");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    try {
      const run = await resumeCopierRun(runId);
      return success({ run });
    } catch (error) {
      return reply
        .status(400)
        .send(failure("resume_failed", error instanceof Error ? error.message : String(error)));
    }
  });

  app.post(`${base}/runs/:runId/cancel`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.cancel");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    try {
      return success({ run: cancelCopierRun(runId) });
    } catch (error) {
      return reply
        .status(404)
        .send(failure("not_found", error instanceof Error ? error.message : String(error)));
    }
  });

  app.get(`${base}/runs`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.list_runs");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    return success({ runs: listCopierRunsSummary(50) });
  });

  app.get(`${base}/runs/:runId`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.detail");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const run = getCopierRunDetail(runId);
    if (!run) return reply.status(404).send(failure("not_found", "Run not found"));
    return success({ run });
  });

  app.get(`${base}/runs/:runId/events`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.events");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const limit = Number((request.query as { limit?: string }).limit ?? 100);
    return success({ events: listCopierEventsForRun(runId, Math.min(500, Math.max(1, limit))) });
  });

  app.get(`${base}/runs/:runId/preview`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.preview");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const run = getCopierRunDetail(runId);
    if (!run) return reply.status(404).send(failure("not_found", "Run not found"));
    return success({
      runId: run.runId,
      previewDocs: run.previewDocs,
      acceptedActivitySamples: run.acceptedActivitySamples,
      rejectedReasonSamples: run.rejectedReasonSamples,
      missingMetadataWarnings: run.missingMetadataWarnings,
    });
  });

  app.get(`${base}/runs/:runId/export`, async (request, reply) => {
    setRouteName("admin.osm.national_copier.export");
    if (!(await requireCopierAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const exported = exportCopierRun(runId);
    if (!exported) return reply.status(404).send(failure("not_found", "Run not found"));
    return success({ export: exported });
  });
}
