import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  buildPublicPbfDryRunRequest,
  PBF_COPIER_ADMIN_PAGE_DEFAULTS,
  PBF_COPIER_VERMONT_FULL_DRY_RUN_DEFAULTS,
  PBF_COPIER_VERMONT_REVIEW_1000_DEFAULTS,
} from "../../admin/openstreetmap/national/pbfCopier/pbfCopierPublicDefaults.js";
import {
  dryRunPbfFirstAccepted,
  exportPbfCopierRun,
  pbfCopierHealth,
  validatePbfFile,
} from "../../admin/openstreetmap/national/pbfCopier/pbfCopierService.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import { isLocalDevRuntime } from "../../lib/local-dev-identity.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";

const base = "/api/public/pbf-copier";

const DryRunQuerySchema = z
  .object({
    preset: z.enum(["admin_page", "vermont_full", "vermont_review_1000", "fast_smoke"]).optional(),
    filePath: z.string().min(1).optional(),
    acceptedLimit: z.coerce.number().int().min(1).max(5000).optional(),
    maxAccepted: z.coerce.number().int().min(1).max(5000).optional(),
    maxRawObjectsToScan: z.coerce.number().int().min(1).nullable().optional(),
    fast: z.coerce.boolean().optional(),
    stateCode: z.string().optional(),
    includeSpots: z.coerce.boolean().optional(),
    includeRoutes: z.coerce.boolean().optional(),
    includePublicOnly: z.coerce.boolean().optional(),
    includeReviewDocs: z.coerce.boolean().optional(),
    skipExisting: z.coerce.boolean().optional(),
    classifyBatchSize: z.coerce.number().int().min(1).max(10000).optional(),
    geoFilterEnabled: z.coerce.boolean().optional(),
    geoFilterCenterLat: z.coerce.number().nullable().optional(),
    geoFilterCenterLng: z.coerce.number().nullable().optional(),
    geoFilterRadiusKm: z.coerce.number().min(2).max(80).optional(),
    geoFilterRadiusMiles: z.coerce.number().min(0.1).max(500).optional(),
  })
  .strict();

const DryRunBodySchema = DryRunQuerySchema;

function previewCounts(previewDocs: PbfCopierPreviewDoc[]) {
  const spots = previewDocs.filter((doc) => doc.kind === "unexplored_spot").length;
  const routes = previewDocs.filter((doc) => doc.kind === "unexplored_route").length;
  return {
    previewDocsTotal: previewDocs.length,
    spots,
    routes,
  };
}

function topRejectReasons(counts: Record<string, number>, limit = 15): Array<{ reason: string; count: number }> {
  return Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

function buildDryRunResponse(runId: string) {
  const exported = exportPbfCopierRun(runId);
  if (!exported) {
    return null;
  }
  const counts = previewCounts(exported.previewDocs);
  const quality = exported.previewQuality;
  return {
    runId: exported.runId,
    status: exported.status,
    phase: exported.phase,
    mode: exported.mode,
    configUsed: exported.config,
    metrics: exported.metrics,
    counts,
    previewDocs: exported.previewDocs,
    previewQuality: quality,
    qualitySummary: quality
      ? {
          totalPreviewDocs: quality.totalPreviewDocs,
          spotsCount: quality.spotsCount,
          routesCount: quality.routesCount,
          duplicateNamesRemoved: quality.duplicateNamesRemoved,
          invalidActivityDocsCount: quality.invalidActivityDocsCount,
          invalidActivitiesFound: quality.invalidActivitiesFound,
          activityDistribution: quality.activityDistribution,
          primaryActivityDistribution: quality.primaryActivityDistribution,
          acceptedLargeNaturalAreasCount: quality.acceptedLargeNaturalAreasCount,
          rejectedLargeNaturalAreasCount: quality.rejectedLargeNaturalAreasCount,
          rawRouteCandidatesSeen: quality.rawRouteCandidatesSeen,
          acceptedRouteCandidatesCount: quality.acceptedRouteCandidatesCount,
          routeRejectReasons: quality.routeRejectReasons,
          maxAcceptedRequested: quality.maxAcceptedRequested,
          maxAcceptedApplied: quality.maxAcceptedApplied,
          visitabilitySignalDistribution: quality.visitabilitySignalDistribution,
          topAcceptedByObjectKind: quality.topAcceptedByObjectKind,
          topRejectReasons: topRejectReasons(exported.rejectionReasonCounts),
          sampleDuplicatesRemoved: quality.sampleDuplicatesRemoved,
          samplePreviewDocsByActivity: quality.samplePreviewDocsByActivity,
        }
      : null,
    acceptedBeforeCap:
      (exported.metrics?.classifierAcceptedSpots ?? 0) + (exported.metrics?.classifierAcceptedRoutes ?? 0),
    rejectedByClassifier: exported.metrics?.rejectedByClassifier ?? 0,
    acceptedActivitySamples: exported.acceptedActivitySamples,
    rejectionReasonCounts: exported.rejectionReasonCounts,
    rejectedSamplesTruncated: exported.rejectedSamplesTruncated,
    routeTrailDiagnostics: exported.routeTrailDiagnostics,
    adminPageUrl: "/admin/openstreetmap/pbf-copier",
    adminApiBase: "/admin/openstreetmap/api/pbf-copier",
    productionWritesBlocked: true as const,
    dryRunOnly: true as const,
  };
}

async function runPublicDryRun(
  input: z.infer<typeof DryRunBodySchema>
): Promise<ReturnType<typeof buildDryRunResponse>> {
  const request = buildPublicPbfDryRunRequest(input);
  const run = await dryRunPbfFirstAccepted({
    filePath: request.filePath,
    acceptedLimit: request.acceptedLimit,
    maxRawObjectsToScan: request.maxRawObjectsToScan,
    mode: request.mode,
    config: request.config,
  });
  return buildDryRunResponse(run.runId);
}

function gatePublicPbfCopier(_request: FastifyRequest, reply: FastifyReply): boolean {
  if (!isLocalDevRuntime()) {
    reply.status(404).send(failure("not_found", "Public PBF copier routes are disabled outside local dev"));
    return false;
  }
  return true;
}

export async function registerPublicPbfCopierRoutes(app: FastifyInstance): Promise<void> {
  if (!isLocalDevRuntime()) {
    return;
  }

  app.get(`${base}/health`, async (request, reply) => {
    setRouteName("public.pbf_copier.health");
    if (!gatePublicPbfCopier(request, reply)) return;
    const health = await pbfCopierHealth();
    return success({
      ...health,
      publicApiBase: base,
      notes: [
        "local_dev_only",
        "dry_run_only",
        "zero_firebase_writes",
        "use GET/POST /api/public/pbf-copier/dry-run for full accepted previewDocs JSON",
      ],
    });
  });

  app.get(`${base}/config`, async (request, reply) => {
    setRouteName("public.pbf_copier.config");
    if (!gatePublicPbfCopier(request, reply)) return;
    return success({
      adminPageUrl: "/admin/openstreetmap/pbf-copier",
      publicApiBase: base,
      adminPageDefaults: PBF_COPIER_ADMIN_PAGE_DEFAULTS,
      vermontFullDryRunDefaults: PBF_COPIER_VERMONT_FULL_DRY_RUN_DEFAULTS,
      vermontReview1000Defaults: PBF_COPIER_VERMONT_REVIEW_1000_DEFAULTS,
      defaultDryRunRequest: buildPublicPbfDryRunRequest({ preset: "vermont_full" }),
      review1000DryRunRequest: buildPublicPbfDryRunRequest({ preset: "vermont_review_1000" }),
      fastSmokeDryRunRequest: buildPublicPbfDryRunRequest({ preset: "fast_smoke", fast: true }),
      endpoints: {
        config: `GET ${base}/config`,
        health: `GET ${base}/health`,
        validateFile: `GET ${base}/validate-file?filePath=...`,
        dryRunGet: `GET ${base}/dry-run?preset=vermont_full`,
        dryRunReview1000: `GET ${base}/dry-run?preset=vermont_review_1000`,
        dryRunPost: `POST ${base}/dry-run`,
      },
    });
  });

  app.get(`${base}/validate-file`, async (request, reply) => {
    setRouteName("public.pbf_copier.validate_file");
    if (!gatePublicPbfCopier(request, reply)) return;
    const query = z
      .object({
        filePath: z.string().min(1).default(PBF_COPIER_ADMIN_PAGE_DEFAULTS.filePath),
      })
      .parse(request.query ?? {});
    const result = await validatePbfFile(query.filePath);
    return success({
      ...result,
      dryRunOnly: true as const,
      writeTarget: "none" as const,
      postsWriteForbidden: true as const,
    });
  });

  app.get(`${base}/dry-run`, async (request, reply) => {
    setRouteName("public.pbf_copier.dry_run_get");
    if (!gatePublicPbfCopier(request, reply)) return;
    const query = DryRunQuerySchema.parse(request.query ?? {});
    try {
      const result = await runPublicDryRun(query);
      if (!result) {
        return reply.status(500).send(failure("dry_run_failed", "Run finished but export was missing"));
      }
      return success(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("dry_run_failed", message));
    }
  });

  app.post(`${base}/dry-run`, async (request, reply) => {
    setRouteName("public.pbf_copier.dry_run_post");
    if (!gatePublicPbfCopier(request, reply)) return;
    const body = DryRunBodySchema.parse(request.body ?? {});
    try {
      const result = await runPublicDryRun(body);
      if (!result) {
        return reply.status(500).send(failure("dry_run_failed", "Run finished but export was missing"));
      }
      return success(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("dry_run_failed", message));
    }
  });

  app.log.warn(`Public PBF copier probe routes enabled at ${base} (local dev only, dry-run, zero Firebase writes)`);
}
