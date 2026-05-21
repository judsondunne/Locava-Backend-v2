import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { backendV2RepoGeminiApiKeyMeta, backendV2RepoGeminiEnvResolutionDiagnostics, monorepoLayeredGeminiApiKeyMeta, type AppEnv } from "../../config/env.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  listWikiCurationRuns,
  listWikiCurationSpotsPage,
  loadWikiCurationSpotCandidates,
  patchWikiCurationOnStagedPosts
} from "./wikiCurationFirestore.service.js";
import {
  wikiCurationCreateJob,
  wikiCurationGetJob,
  wikiCurationSubscribe,
  wikiCurationVerifyJobSecret
} from "./wikiCurationJobStore.js";
import { runWikiSpotDryReviewJob } from "./wikiSpotCuratorRun.service.js";
import {
  wikiSpotCurationApplySecret,
  wikiSpotCurationApplyWritesEnabledFromEnv,
  wikiSpotCurationEnabledFromEnv,
  wikiSpotCurationGeminiApiKeyMeta,
  wikiSpotCurationGeminiModel
} from "./wikiCurationEnv.js";
import { WikiSpotCuratorAiResponseSchema } from "./wikiSpotCurator.schema.js";

const base = "/admin/wiki-curation";

const RunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

const SpotsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(40),
  cursor: z.string().max(200).optional()
});

const DryReviewBodySchema = z.object({
  maxPostsPerSpot: z.coerce.number().int().min(0).max(40).optional(),
  maxCorePostsPerSpot: z.coerce.number().int().min(0).max(30).optional().default(5),
  maxContextPostsPerSpot: z.coerce.number().int().min(0).max(30).optional().default(3),
  maxTotalPostsPerSpot: z.coerce.number().int().min(0).max(40).optional().default(8),
  maxImagesPerCandidate: z.coerce.number().int().min(0).max(12).optional().default(3),
  allowContextualFarRelevant: z.coerce.boolean().optional().default(true),
  rejectPlaneViews: z.coerce.boolean().optional().default(true),
  coreRadiusMeters: z.coerce.number().int().min(100).max(500_000).optional().default(1000),
  nearbyRadiusMeters: z.coerce.number().int().min(100).max(1_000_000).optional().default(3000),
  extendedContextRadiusMeters: z.coerce.number().int().min(500).max(2_000_000).optional().default(20_000)
});

const ApplyBodySchema = z.object({
  result: WikiSpotCuratorAiResponseSchema,
  confirmWrite: z.literal(true),
  model: z.string().max(80).optional()
});

type CachedRuns = { expiresAtMs: number; runs: Awaited<ReturnType<typeof listWikiCurationRuns>> };
const runsCache = new Map<string, CachedRuns>();
const RUNS_CACHE_TTL_MS = 15_000;

export async function registerWikiCurationRoutes(app: FastifyInstance): Promise<void> {
  /** Which env supplies the Gemini key (no secrets). Helps debug leaked-key 403 after `.env` edits. */
  app.get(`${base}/gemini-env`, async (_request, reply) => {
    setRouteName("admin.wiki_curation.gemini_env.get");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    const keyMeta = wikiSpotCurationGeminiApiKeyMeta();
    const fromBackendV2Files = backendV2RepoGeminiApiKeyMeta();
    const fromMonorepoLayeredFiles = monorepoLayeredGeminiApiKeyMeta();
    const resolution = backendV2RepoGeminiEnvResolutionDiagnostics();
    const payload: Record<string, unknown> = {
      dryReviewGeminiKeySource: "x-wiki-curation-gemini-api-key_header_only",
      processEnvGeminiMeta: keyMeta,
      geminiKeyFromBackendV2EnvFiles: fromBackendV2Files,
      geminiKeyFromMonorepoLayeredEnvFiles: fromMonorepoLayeredFiles,
      geminiEnvResolution: resolution,
      backendV2FilesMatchProcess:
        keyMeta.configured === fromBackendV2Files.configured &&
        keyMeta.source === fromBackendV2Files.source &&
        keyMeta.keyLength === fromBackendV2Files.keyLength,
      monorepoLayeredDiffersFromBackendV2:
        fromMonorepoLayeredFiles.keyLength !== fromBackendV2Files.keyLength ||
        fromMonorepoLayeredFiles.source !== fromBackendV2Files.source ||
        fromMonorepoLayeredFiles.configured !== fromBackendV2Files.configured,
      model: wikiSpotCurationGeminiModel(),
      hint:
        "Dry review ignores GEMINI_API_KEY / GOOGLE_GEMINI_API_KEY for the Gemini HTTP call — you must send x-wiki-curation-gemini-api-key (paste in /admin/wiki-curation or Wikipedia staging). " +
        "processEnvGeminiMeta is informational only (what happens to exist in process.env from dotenv/shell). " +
        "geminiEnvResolution shows which .env files exist on disk for debugging paths."
    };
    return success(payload);
  });

  app.get(`${base}/runs`, async (request, reply) => {
    setRouteName("admin.wiki_curation.runs.get");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    const q = RunsQuerySchema.parse(request.query ?? {});
    const cacheKey = String(q.limit);
    const now = Date.now();
    const hit = runsCache.get(cacheKey);
    if (hit && hit.expiresAtMs > now) {
      return success({ runs: hit.runs, cached: true });
    }
    const runs = await listWikiCurationRuns({ limit: q.limit });
    runsCache.set(cacheKey, { runs, expiresAtMs: now + RUNS_CACHE_TTL_MS });
    return success({ runs, cached: false });
  });

  app.get(`${base}/runs/:runId/spots`, async (request, reply) => {
    setRouteName("admin.wiki_curation.spots.get");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    const runId = z.string().min(1).max(140).parse((request.params as { runId?: string }).runId);
    const q = SpotsQuerySchema.parse(request.query ?? {});
    const page = await listWikiCurationSpotsPage({ runId, limit: q.limit, cursor: q.cursor ?? null });
    return success(page);
  });

  app.get(`${base}/runs/:runId/spots/:spotId/posts`, async (request, reply) => {
    setRouteName("admin.wiki_curation.spot_posts.get");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    const runId = z.string().min(1).max(140).parse((request.params as { runId?: string }).runId);
    const spotId = z.string().min(1).max(180).parse((request.params as { spotId?: string }).spotId);
    const data = await loadWikiCurationSpotCandidates({ runId, spotId });
    return success({ runId, spotId, ...data });
  });

  app.post(`${base}/runs/:runId/spots/:spotId/dry-review`, async (request, reply) => {
    setRouteName("admin.wiki_curation.dry_review.post");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    const runId = z.string().min(1).max(140).parse((request.params as { runId?: string }).runId);
    const spotId = z.string().min(1).max(180).parse((request.params as { spotId?: string }).spotId);
    const body = DryReviewBodySchema.parse(request.body ?? {});
    const headerRaw = String(request.headers["x-wiki-curation-gemini-api-key"] ?? "").trim();
    if (!headerRaw.length) {
      return reply.status(400).send(
        failure(
          "gemini_api_key_required",
          "Send header x-wiki-curation-gemini-api-key with your Google AI Studio key. Dry review does not use GEMINI_API_KEY from .env."
        )
      );
    }
    if (headerRaw.length < 20 || headerRaw.length > 512) {
      return reply.status(400).send(failure("invalid_gemini_key_header", "x-wiki-curation-gemini-api-key length must be 20–512"));
    }
    const { jobId, secret } = wikiCurationCreateJob();
    void runWikiSpotDryReviewJob({
      jobId,
      runId,
      spotId,
      maxPostsPerSpot: body.maxPostsPerSpot,
      maxCorePostsPerSpot: body.maxCorePostsPerSpot,
      maxContextPostsPerSpot: body.maxContextPostsPerSpot,
      maxTotalPostsPerSpot: body.maxTotalPostsPerSpot,
      maxImagesPerCandidate: body.maxImagesPerCandidate,
      allowContextualFarRelevant: body.allowContextualFarRelevant,
      rejectPlaneViews: body.rejectPlaneViews,
      coreRadiusMeters: body.coreRadiusMeters,
      nearbyRadiusMeters: body.nearbyRadiusMeters,
      extendedContextRadiusMeters: body.extendedContextRadiusMeters,
      geminiApiKey: headerRaw
    });
    return success({
      jobId,
      secret,
      eventsPath: `${base}/jobs/${encodeURIComponent(jobId)}/events`,
      resultPath: `${base}/jobs/${encodeURIComponent(jobId)}/result`
    });
  });

  app.get(`${base}/jobs/:jobId/events`, async (request, reply) => {
    setRouteName("admin.wiki_curation.job_events.get");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    const jobId = z.string().uuid().parse((request.params as { jobId?: string }).jobId);
    const secret = z.string().uuid().parse(String((request.query as { secret?: string })?.secret || ""));
    const job = wikiCurationGetJob(jobId);
    if (!job || !wikiCurationVerifyJobSecret(job, secret)) {
      return reply.status(404).send(failure("not_found", "Unknown job"));
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const writeEvent = (obj: unknown) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    for (const line of job.logs) {
      writeEvent({ line });
    }

    const latest = wikiCurationGetJob(jobId);
    if (latest && latest.status !== "running") {
      writeEvent({ done: true, status: latest.status, error: latest.error });
      res.end();
      return;
    }

    const unsub = wikiCurationSubscribe(jobId, (line) => {
      writeEvent({ line });
      const j = wikiCurationGetJob(jobId);
      if (!j) {
        res.end();
        unsub();
        return;
      }
      if (j.status !== "running") {
        writeEvent({ done: true, status: j.status, error: j.error });
        res.end();
        unsub();
      }
    });

    request.raw.on("close", () => {
      unsub();
    });
  });

  app.get(`${base}/jobs/:jobId/result`, async (request, reply) => {
    setRouteName("admin.wiki_curation.job_result.get");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    const jobId = z.string().uuid().parse((request.params as { jobId?: string }).jobId);
    const secret = z.string().uuid().parse(String((request.query as { secret?: string })?.secret || "").trim());
    const job = wikiCurationGetJob(jobId);
    if (!job || !wikiCurationVerifyJobSecret(job, secret)) {
      return reply.status(404).send(failure("not_found", "Unknown job or invalid secret"));
    }
    return success({
      status: job.status,
      logs: job.logs,
      error: job.error,
      data: job.result
    });
  });

  app.post(`${base}/runs/:runId/spots/:spotId/apply-ai`, async (request, reply) => {
    setRouteName("admin.wiki_curation.apply_ai.post");
    const env = app.config as AppEnv;
    if (!wikiSpotCurationEnabledFromEnv(env)) {
      return reply.status(404).send(failure("wiki_curation_disabled", "Wiki spot curation is disabled"));
    }
    if (!wikiSpotCurationApplyWritesEnabledFromEnv()) {
      return reply
        .status(403)
        .send(failure("apply_disabled", "Set WIKI_CURATION_APPLY_WRITES_ENABLED=true to allow apply writes"));
    }
    const expectedSecret = wikiSpotCurationApplySecret();
    if (!expectedSecret) {
      return reply.status(403).send(
        failure(
          "apply_secret_required",
          "Set WIKI_CURATION_APPLY_SECRET and send it as header x-wiki-curation-apply-secret when apply writes are enabled"
        )
      );
    }
    const provided = String(request.headers["x-wiki-curation-apply-secret"] || "").trim();
    if (provided !== expectedSecret) {
      return reply.status(403).send(failure("forbidden", "Invalid or missing x-wiki-curation-apply-secret header"));
    }
    const runId = z.string().min(1).max(140).parse((request.params as { runId?: string }).runId);
    const spotId = z.string().min(1).max(180).parse((request.params as { spotId?: string }).spotId);
    const body = ApplyBodySchema.parse(request.body ?? {});
    const r = body.result;
    if (String(r.spotId) !== String(spotId)) {
      return reply.status(400).send(failure("spot_mismatch", "result.spotId must match URL spotId"));
    }
    const model = String(body.model || wikiSpotCurationGeminiModel()).slice(0, 80);
    const byPostId: Record<string, { aiCuration: Record<string, unknown> }> = {};
    const reviewedAt = Timestamp.now();
    for (const d of r.decisions) {
      byPostId[d.postId] = {
        aiCuration: {
          source: "wikicommons_spot_curator_v2",
          decision: d.decision,
          moderatorTier: d.moderatorTier,
          visitWorthyScore: d.visitWorthyScore,
          visualAppealScore: d.visualAppealScore,
          authenticityScore: d.authenticityScore,
          captionQualityScore: d.captionQualityScore,
          visualMagnetScore: d.visualMagnetScore,
          viewType: d.viewType,
          locationRelation: d.locationRelation,
          distanceBucket: d.distanceBucket,
          distanceMetersFromAnchor: d.distanceMetersFromAnchor ?? null,
          backendDistanceBucket: d.backendDistanceBucket ?? null,
          selectionLane: d.selectionLane ?? null,
          countsAgainstCoreMax: d.countsAgainstCoreMax ?? null,
          curationWarnings: d.curationWarnings ?? [],
          finalRankForSpot: d.finalRankForSpot,
          shouldUseInFinalSpotSet: d.shouldUseInFinalSpotSet,
          refinedTitle: d.refinedTitle,
          refinedCaption: d.refinedCaption,
          reasons: d.reasons,
          concerns: d.concerns,
          imageNotes: d.imageNotes,
          reviewedAt,
          runId,
          spotId,
          maxPostsForSpot: r.maxPostsForSpot,
          model
        }
      };
    }
    const out = await patchWikiCurationOnStagedPosts({ runId, spotId, byPostId });
    return success({ updated: out.updated, runId, spotId });
  });
}
