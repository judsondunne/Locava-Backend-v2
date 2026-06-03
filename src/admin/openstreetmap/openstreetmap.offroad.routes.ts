import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  getOffroadStateRegistry,
  listOffroadStateRegistries,
} from "../../lib/inventory/offroad/sources/offroadSourceRegistry.js";
import {
  getOffroadMasterPanelSnapshot,
  runBatchOffroadDryRun,
  runStateOffroadDryRun,
} from "./offroadNationalImport.service.js";
import { getStateBounds } from "../../lib/inventory/offroad/offroadStateBounds.js";
import {
  getBestRunForState,
  getOffroadNationalRun,
  isStateEnabled,
  listOffroadNationalRuns,
  setSourceEnabled,
  setStateEnabled,
} from "./offroadNationalRunStore.js";

type AdminGuard = (request: FastifyRequest, reply: FastifyReply, env: AppEnv) => Promise<boolean>;

const offroadApiBase = "/admin/openstreetmap/api/offroad/sources";

export async function registerOpenStreetMapOffroadRoutes(
  app: FastifyInstance,
  requireAdmin: AdminGuard
): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${offroadApiBase}/states`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.states.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const snapshot = getOffroadMasterPanelSnapshot();
    return success({
      routeName: "admin.openstreetmap.offroad.states.get" as const,
      ...snapshot,
    });
  });

  app.get(`${offroadApiBase}/states/:stateCode`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.state.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const { stateCode } = request.params as { stateCode: string };
    const registry = getOffroadStateRegistry(stateCode);
    if (!registry) return reply.status(404).send(failure("state_not_found", `Unknown state ${stateCode}`));
    const bounds = getStateBounds(stateCode);
    const bestRun = getBestRunForState(stateCode);
    return success({
      routeName: "admin.openstreetmap.offroad.state.get" as const,
      registry,
      bounds,
      bestRun,
      latestRun: bestRun,
      enabled: isStateEnabled(registry.stateCode, registry.enabled),
      productionWritesBlocked: true,
    });
  });

  app.post(`${offroadApiBase}/states/:stateCode/toggle`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.state.toggle.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const { stateCode } = request.params as { stateCode: string };
    const body = z.object({ enabled: z.boolean() }).parse(request.body ?? {});
    const registry = getOffroadStateRegistry(stateCode);
    if (!registry) return reply.status(404).send(failure("state_not_found", `Unknown state ${stateCode}`));
    setStateEnabled(stateCode, body.enabled);
    return success({
      routeName: "admin.openstreetmap.offroad.state.toggle.post" as const,
      stateCode: registry.stateCode,
      enabled: body.enabled,
    });
  });

  app.post(`${offroadApiBase}/states/:stateCode/sources/:sourceId/toggle`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.source.toggle.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const { stateCode, sourceId } = request.params as { stateCode: string; sourceId: string };
    const body = z.object({ enabled: z.boolean() }).parse(request.body ?? {});
    setSourceEnabled(stateCode, sourceId, body.enabled);
    return success({
      routeName: "admin.openstreetmap.offroad.source.toggle.post" as const,
      stateCode: stateCode.toUpperCase(),
      sourceId,
      enabled: body.enabled,
    });
  });

  app.post(`${offroadApiBase}/states/:stateCode/run-dry-run`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.state.dryrun.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const { stateCode } = request.params as { stateCode: string };
    const body = z
      .object({
        sourceIds: z.array(z.string()).optional(),
        sourceFilter: z.enum(["all", "federal", "state", "osm"]).optional(),
        maxRecordsPerSource: z.number().int().positive().optional(),
        includeNotAssessedBlm: z.boolean().optional(),
        minLat: z.number().optional(),
        minLng: z.number().optional(),
        maxLat: z.number().optional(),
        maxLng: z.number().optional(),
      })
      .parse(request.body ?? {});

    try {
      const customBbox =
        body.minLat != null && body.minLng != null && body.maxLat != null && body.maxLng != null
          ? { minLat: body.minLat, minLng: body.minLng, maxLat: body.maxLat, maxLng: body.maxLng }
          : undefined;

      const run = await runStateOffroadDryRun({
        stateCode,
        sourceIds: body.sourceIds,
        sourceFilter: body.sourceFilter,
        maxRecordsPerSource: body.maxRecordsPerSource,
        includeNotAssessedBlm: body.includeNotAssessedBlm,
        customBbox,
      });
      return success({
        routeName: "admin.openstreetmap.offroad.state.dryrun.post" as const,
        run,
        productionWritesBlocked: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("offroad_dry_run_failed", message));
    }
  });

  app.post(`${offroadApiBase}/run-batch-dry-run`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.batch.dryrun.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const body = z
      .object({
        stateCodes: z.array(z.string()).min(1),
        sourceFilter: z.enum(["all", "federal", "state", "osm"]).optional(),
        confirmAllStates: z.boolean().optional(),
        maxConcurrentStates: z.number().int().min(1).max(3).optional(),
      })
      .parse(request.body ?? {});

    try {
      const result = await runBatchOffroadDryRun({
        stateCodes: body.stateCodes.map((c) => c.toUpperCase()),
        sourceFilter: body.sourceFilter,
        confirmAllStates: body.confirmAllStates,
        maxConcurrentStates: body.maxConcurrentStates ?? 3,
      });
      return success({
        routeName: "admin.openstreetmap.offroad.batch.dryrun.post" as const,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("batch_dry_run_failed", message));
    }
  });

  app.get(`${offroadApiBase}/runs`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.runs.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const limit = z.coerce.number().int().min(1).max(100).optional().parse(
      (request.query as { limit?: string }).limit
    );
    return success({
      routeName: "admin.openstreetmap.offroad.runs.get" as const,
      runs: listOffroadNationalRuns(limit ?? 50),
      productionWritesBlocked: true,
    });
  });

  app.get(`${offroadApiBase}/runs/:runId`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.run.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const run = getOffroadNationalRun(runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Dry run not found"));
    return success({
      routeName: "admin.openstreetmap.offroad.run.get" as const,
      run,
    });
  });

  app.get(`${offroadApiBase}/runs/:runId/results`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.run.results.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const q = request.query as Record<string, string | undefined>;
    const run = getOffroadNationalRun(runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Dry run not found"));

    let routes = run.routes;
    if (q.sourceId) routes = routes.filter((r) => r.source === q.sourceId || r.tags._primarySource === q.sourceId);
    if (q.confidence) routes = routes.filter((r) => r.tags._mergeConfidence === q.confidence);
    if (q.offroadCategory) routes = routes.filter((r) => r.offroad?.offroadCategory === q.offroadCategory);
    if (q.accessStatus) routes = routes.filter((r) => r.offroad?.accessStatus === q.accessStatus);
    if (q.needsValidation === "true") routes = routes.filter((r) => r.offroad?.offroadConfidence === "candidate");

    const limit = q.limit ? Number(q.limit) : 200;
    const offset = q.offset ? Number(q.offset) : 0;

    return success({
      routeName: "admin.openstreetmap.offroad.run.results.get" as const,
      runId,
      total: routes.length,
      limit,
      offset,
      routes: routes.slice(offset, offset + limit),
      areaContexts: run.areaContexts,
    });
  });

  app.get(`${offroadApiBase}/runs/:runId/diagnostics`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.run.diagnostics.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const run = getOffroadNationalRun(runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Dry run not found"));
    return success({
      routeName: "admin.openstreetmap.offroad.run.diagnostics.get" as const,
      runId,
      stateCoverageDiagnostics: run.stateCoverageDiagnostics,
      sourceCounts: run.sourceCounts,
      rejectedCount: run.rejectedCount,
      chunkCount: run.chunkCount,
      productionWritesBlocked: true,
      registryStates: listOffroadStateRegistries().length,
    });
  });

  const pipelineBase = "/admin/openstreetmap/api/offroad/pipeline";

  app.get(`${pipelineBase}/status`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.pipeline.status.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const { getOffroadPipelineStatus } = await import("./openstreetmapOffroadPipeline.service.js");
    return success({
      routeName: "admin.openstreetmap.offroad.pipeline.status.get" as const,
      ...getOffroadPipelineStatus(),
    });
  });

  app.get(`${pipelineBase}/export-config`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.pipeline.export_config.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const { getOffroadMainListExportConfig } = await import("./openstreetmapOffroadPipeline.service.js");
    return success({
      routeName: "admin.openstreetmap.offroad.pipeline.export_config.get" as const,
      config: getOffroadMainListExportConfig(),
      productionWritesBlocked: true,
    });
  });

  app.post(`${pipelineBase}/export-config`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.pipeline.export_config.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const body = z
      .object({
        includeReady: z.boolean().optional(),
        includeReview: z.boolean().optional(),
        includeHidden: z.boolean().optional(),
        includeOfficialState: z.boolean().optional(),
        includeOfficialFederal: z.boolean().optional(),
        includeOsmExplicit: z.boolean().optional(),
        includeOsmCandidates: z.boolean().optional(),
        minLocavaScore: z.number().min(0).max(100).optional(),
        activities: z.array(z.string()).optional(),
        excludePrivateAccess: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const { setOffroadMainListExportConfig } = await import("./openstreetmapOffroadPipeline.service.js");
    const config = setOffroadMainListExportConfig(body);
    return success({
      routeName: "admin.openstreetmap.offroad.pipeline.export_config.post" as const,
      config,
      productionWritesBlocked: true,
    });
  });

  app.post(`${pipelineBase}/runs/:runId/preview-export`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.pipeline.preview_export.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const body = z
      .object({
        includeReady: z.boolean().optional(),
        includeReview: z.boolean().optional(),
        includeHidden: z.boolean().optional(),
        includeOfficialState: z.boolean().optional(),
        includeOfficialFederal: z.boolean().optional(),
        includeOsmExplicit: z.boolean().optional(),
        includeOsmCandidates: z.boolean().optional(),
        minLocavaScore: z.number().min(0).max(100).optional(),
        activities: z.array(z.string()).optional(),
        excludePrivateAccess: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    try {
      const { previewNationalRunMainListExport } = await import("./openstreetmapOffroadPipeline.service.js");
      const preview = previewNationalRunMainListExport({ nationalRunId: runId, config: body });
      return success({
        routeName: "admin.openstreetmap.offroad.pipeline.preview_export.post" as const,
        preview,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("preview_export_failed", message));
    }
  });

  app.post(`${pipelineBase}/runs/:runId/stage-to-main-lists`, async (request, reply) => {
    setRouteName("admin.openstreetmap.offroad.pipeline.stage.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const { runId } = request.params as { runId: string };
    const body = z
      .object({
        classifierRunId: z.string().optional(),
        createClassifierShellIfMissing: z.boolean().optional(),
        includeReady: z.boolean().optional(),
        includeReview: z.boolean().optional(),
        includeHidden: z.boolean().optional(),
        includeOfficialState: z.boolean().optional(),
        includeOfficialFederal: z.boolean().optional(),
        includeOsmExplicit: z.boolean().optional(),
        includeOsmCandidates: z.boolean().optional(),
        minLocavaScore: z.number().min(0).max(100).optional(),
        activities: z.array(z.string()).optional(),
        excludePrivateAccess: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    try {
      const { stageNationalOffroadToMainLists } = await import("./openstreetmapOffroadPipeline.service.js");
      const result = stageNationalOffroadToMainLists({
        nationalRunId: runId,
        classifierRunId: body.classifierRunId,
        createClassifierShellIfMissing: body.createClassifierShellIfMissing,
        config: body,
      });
      return success({
        routeName: "admin.openstreetmap.offroad.pipeline.stage.post" as const,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("stage_to_main_lists_failed", message));
    }
  });
}
