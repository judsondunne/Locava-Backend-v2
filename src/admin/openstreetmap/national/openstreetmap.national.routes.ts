import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../../auth/admin-access.js";
import type { AppEnv } from "../../../config/env.js";
import { failure, success } from "../../../lib/response.js";
import { setRouteName } from "../../../observability/request-context.js";
import { planNationalRun, estimateNationalPlan } from "./osmNationalPlanner.service.js";
import { isOsmNationalMemoryStoreEnabled } from "./osmNationalMemoryStore.js";
import {
  cancelNationalRun,
  getNationalRunOrThrow,
  pauseNationalRun,
  refreshNationalRunProgress,
  resumeNationalRun,
  retryFailedChunks,
  rerunChunk,
  startNationalRun,
} from "./osmNationalRun.service.js";
import {
  getOsmChunkRun,
  getOsmNationalRun,
  listOsmChunkRuns,
  listOsmNationalEvents,
  listOsmNationalRuns,
  listOsmStateRuns,
  getOsmStateRun,
} from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { processChunk } from "./osmNationalChunkWorker.service.js";
import { processNextChunks, processChunksForState } from "./osmNationalLocalRunner.service.js";
import { buildNationalRunDiagnostics } from "./osmNationalDiagnostics.service.js";
import { getOsmNationalCloudTasksDiagnostics, validateCloudTaskPayload } from "./osmNationalCloudTasks.service.js";
import { isOsmNationalProductionWriteUnlocked } from "./osmNationalWriteGuard.js";

const base = "/admin/openstreetmap/api/national";

async function requireOsmNationalAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  env: AppEnv
): Promise<boolean> {
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return true;
  }
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

const PlanBodySchema = z.object({
  states: z.array(z.string()).optional(),
  regionPreset: z
    .enum(["ALL", "CONTIGUOUS", "NEW_ENGLAND", "NORTHEAST", "SOUTHEAST", "MIDWEST", "SOUTH", "WEST", "MOUNTAIN", "PACIFIC"])
    .optional(),
  includeDc: z.boolean().optional(),
  chunkSizeKm: z.number().positive().optional(),
  maxConcurrentStates: z.number().int().positive().optional(),
  maxConcurrentChunks: z.number().int().positive().optional(),
  maxWritesPerSecond: z.number().nonnegative().optional(),
  maxChunksPerMinute: z.number().nonnegative().optional(),
  includeOsmSpots: z.boolean().optional(),
  includeOsmRoutes: z.boolean().optional(),
  includeOffroad: z.boolean().optional(),
  includePublicOnly: z.boolean().optional(),
  includeReviewItems: z.boolean().optional(),
  skipCompletedChunks: z.boolean().optional(),
  forceReprocess: z.boolean().optional(),
  dryRunOnly: z.boolean().optional(),
  tileBuildMode: z.enum(["none", "per_chunk", "per_state", "after_run"]).optional(),
  writeMode: z.boolean().optional(),
  writeTarget: z.enum(["none", "emulator", "production"]).optional(),
  confirmProductionWrite: z.string().optional(),
  confirmLargePlan: z.boolean().optional(),
  maxTotalWrites: z.number().int().nonnegative().optional(),
  maxWritesPerMinute: z.number().nonnegative().optional(),
});

export async function registerOpenStreetMapNationalRoutes(app: FastifyInstance): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${base}/runs`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.list");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runs = await listOsmNationalRuns();
    return success({ runs, cloudTasks: getOsmNationalCloudTasksDiagnostics() });
  });

  app.post(`${base}/runs/plan`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.plan");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const body = PlanBodySchema.parse(request.body ?? {});
    const run = await planNationalRun(body);
    return success({ run });
  });

  app.post(`${base}/runs/:runId/start`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.start");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    const run = await startNationalRun(runId);
    return success({ run });
  });

  app.post(`${base}/runs/:runId/pause`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.pause");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    return success({ run: await pauseNationalRun(runId) });
  });

  app.post(`${base}/runs/:runId/resume`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.resume");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    return success({ run: await resumeNationalRun(runId) });
  });

  app.post(`${base}/runs/:runId/cancel`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.cancel");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    return success({ run: await cancelNationalRun(runId) });
  });

  app.post(`${base}/runs/:runId/retry-failed`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.retry_failed");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    return success(await retryFailedChunks(runId));
  });

  app.get(`${base}/runs/:runId`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.detail");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    const run = await getOsmNationalRun(runId);
    if (!run) return reply.status(404).send(failure("not_found", "Run not found"));
    return success({ run });
  });

  app.get(`${base}/runs/:runId/states`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.states");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    return success({ states: await listOsmStateRuns(runId) });
  });

  app.get(`${base}/runs/:runId/states/:stateCode`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.state.detail");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const params = z.object({ runId: z.string(), stateCode: z.string() }).parse(request.params);
    const state = await getOsmStateRun(params.runId, params.stateCode);
    if (!state) return reply.status(404).send(failure("not_found", "State run not found"));
    return success({ state });
  });

  app.get(`${base}/runs/:runId/states/:stateCode/chunks`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.state.chunks");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const params = z.object({ runId: z.string(), stateCode: z.string() }).parse(request.params);
    const limit = z.coerce.number().int().min(1).max(500).optional().parse((request.query as { limit?: string }).limit ?? 100);
    const status = z.enum(["pending", "queued", "running", "completed", "failed", "skipped"]).optional().parse((request.query as { status?: string }).status);
    return success({ chunks: await listOsmChunkRuns(params.runId, params.stateCode, { limit, status }) });
  });

  app.get(`${base}/runs/:runId/chunks/:chunkId`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.chunk.detail");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const params = z.object({ runId: z.string(), chunkId: z.string(), stateCode: z.string() }).parse({
      ...(request.params as object),
      stateCode: (request.query as { stateCode?: string }).stateCode,
    });
    const chunk = await getOsmChunkRun(params.runId, params.stateCode, params.chunkId);
    if (!chunk) return reply.status(404).send(failure("not_found", "Chunk not found"));
    return success({ chunk });
  });

  app.post(`${base}/runs/:runId/chunks/:chunkId/rerun`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.chunk.rerun");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const params = z.object({ runId: z.string(), chunkId: z.string() }).parse(request.params);
    const stateCode = z.object({ stateCode: z.string() }).parse(request.body ?? {}).stateCode;
    await rerunChunk(params.runId, stateCode, params.chunkId);
    return success({ ok: true });
  });

  app.get(`${base}/runs/:runId/events`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.events");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    const limit = z.coerce.number().int().min(1).max(100).optional().parse((request.query as { limit?: string }).limit ?? 100);
    return success({ events: await listOsmNationalEvents(runId, limit) });
  });

  app.get(`${base}/runs/:runId/diagnostics`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.diagnostics");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    const run = await getNationalRunOrThrow(runId);
    return success({ diagnostics: await buildNationalRunDiagnostics(run) });
  });

  app.get(`${base}/runs/:runId/sample-docs`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.sample_docs");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string() }).parse(request.params).runId;
    const run = await getNationalRunOrThrow(runId);
    const states = await listOsmStateRuns(runId);
    const samples = { spots: [] as unknown[], routes: [] as unknown[] };
    for (const state of states.slice(0, 3)) {
      const chunks = await listOsmChunkRuns(runId, state.stateCode, { status: "completed", limit: 5 });
      for (const chunk of chunks) {
        if (samples.spots.length < 3) {
          samples.spots.push({
            names: chunk.samples.acceptedSpotNames,
            chunkId: chunk.chunkId,
            stateCode: chunk.stateCode,
          });
        }
        if (samples.routes.length < 3) {
          samples.routes.push({
            names: chunk.samples.acceptedRouteNames,
            offroad: chunk.samples.offroadNames,
            chunkId: chunk.chunkId,
            stateCode: chunk.stateCode,
          });
        }
      }
    }
    return success({ runId: run.runId, samples });
  });

  app.post(`${base}/worker/process-chunk`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.worker.process_chunk");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const body = z
      .object({ runId: z.string(), stateCode: z.string(), chunkId: z.string() })
      .parse(request.body ?? {});
    const result = await processChunk(body);
    return success(result);
  });

  app.post(`${base}/worker/process-next`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.worker.process_next");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const body = z.object({ runId: z.string(), limit: z.number().int().min(1).max(20).optional() }).parse(request.body ?? {});
    return success(await processNextChunks(body));
  });

  app.post(`${base}/worker/process-state`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.worker.process_state");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const body = z
      .object({ runId: z.string(), stateCode: z.string(), limit: z.number().int().min(1).max(100).optional() })
      .parse(request.body ?? {});
    return success(await processChunksForState(body));
  });

  app.get(`${base}/health`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.health");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    return success({
      ok: true,
      productionWritesBlocked: !isOsmNationalProductionWriteUnlocked(),
      cloudTasks: getOsmNationalCloudTasksDiagnostics(),
      localRunnerReady: true,
      memoryStoreEnabled: isOsmNationalMemoryStoreEnabled(),
      dryRunProgressUsesMemory: isOsmNationalMemoryStoreEnabled(),
    });
  });

  app.post(`${base}/runs/estimate`, async (request, reply) => {
    setRouteName("admin.openstreetmap.national.runs.estimate");
    if (!(await requireOsmNationalAdmin(request, reply, env))) return;
    const body = PlanBodySchema.parse(request.body ?? {});
    return success({ estimate: estimateNationalPlan(body) });
  });
}
