import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { assertNoPublicPublish } from "../../lib/state-content-factory/assertNoPublicPublish.js";
import {
  listStagedGeneratedPosts,
  reviewStagedGeneratedPost,
} from "../../lib/state-content-factory/stateContentFactoryFirestore.js";
import {
  stateContentFactoryDevPageEnabled,
  stateContentFactoryStagingWritesAllowed,
} from "../../lib/state-content-factory/stateContentFactoryEnv.js";
import { startStateContentFactoryRun } from "../../lib/state-content-factory/stateContentFactoryDevRunner.js";
import {
  getStateContentFactoryRun,
  getStateContentFactoryRunEvents,
  listStateContentFactoryRuns,
  subscribeStateContentFactoryRunEvents,
} from "../../lib/state-content-factory/stateContentFactoryRunStore.js";
import type { StateContentFactoryRunConfig } from "../../lib/state-content-factory/types.js";
import type { StateContentLocationTrustMode } from "../../lib/wikimediaMvp/WikimediaMvpTypes.js";
import { stateContentFactoryDevPageHtml } from "./stateContentFactoryDevPage.js";

const PriorityQueuesSchema = z
  .array(z.enum(["P0", "P1", "P2", "P3"]))
  .optional()
  .default(["P0", "P1"]);

const RunConfigSchema = z.object({
  stateName: z.string().trim().min(1).max(80),
  stateCode: z.string().trim().min(2).max(2).optional(),
  runMode: z.enum(["dry_run", "stage_only"]).optional().default("dry_run"),
  placeDiscoveryMode: z.enum(["fast_smoke", "fast_targeted", "deep_discovery"]).optional().default("fast_targeted"),
  candidateLimit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  priorityQueues: PriorityQueuesSchema,
  maxPlacesToProcess: z.coerce.number().int().min(1).max(80).optional().default(20),
  wikimediaMode: z.enum(["fast_preview", "balanced", "exhaustive"]).optional().default("balanced"),
  /** Legacy: when true and wikimediaMode omitted, resolves to exhaustive. Prefer wikimediaMode. */
  wikimediaFetchAllExhaustive: z.boolean().optional().default(false),
  includeMediaSignals: z.boolean().optional().default(true),
  qualityThreshold: z.enum(["strict", "normal", "loose"]).optional().default("normal"),
  qualityPreviewMode: z.enum(["strict", "normal", "preview_all"]).optional().default("preview_all"),
  maxPostPreviewsPerPlace: z.coerce.number().int().min(1).max(20).optional().default(10),
  maxAssetsPerPostPreview: z.coerce.number().int().min(1).max(20).optional().default(8),
  groupTimeWindowMinutes: z.coerce.number().int().min(1).max(24 * 60).optional().default(180),
  totalTimeoutMs: z.coerce.number().int().min(1000).max(900_000).optional().default(300_000),
  perPlaceTimeoutMs: z.coerce.number().int().min(1000).max(600_000).optional().default(180_000),
  allowStagingWrites: z.boolean().optional().default(false),
  allowPublicPublish: z.boolean().optional().default(false),
  /** Post-test only: optional coordinates (otherwise state centroid is used). */
  postTestLatitude: z.coerce.number().finite().optional(),
  postTestLongitude: z.coerce.number().finite().optional(),
  locationTrustMode: z
    .enum(["asset_geotag_required", "legacy_place_fallback_allowed"])
    .optional()
    .default("asset_geotag_required"),
});

const PostTestSchema = RunConfigSchema.extend({
  place: z.string().trim().min(1).max(200),
});

const ReviewSchema = z.object({
  action: z.enum(["approved", "rejected", "needs_review", "duplicate", "staged"]),
});

const LogsQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional().default(0),
});

function gateDisabled(reply: { status: (n: number) => { send: (b: unknown) => void } }) {
  return reply.status(404).send({ ok: false, error: "state_content_factory_dev_disabled" });
}

function toRunConfig(
  body: z.infer<typeof RunConfigSchema>,
  runKind: StateContentFactoryRunConfig["runKind"],
  postOnlyPlace?: string,
): StateContentFactoryRunConfig {
  if (body.allowPublicPublish) {
    assertNoPublicPublish();
  }
  return {
    runKind,
    stateName: body.stateName,
    stateCode: body.stateCode,
    runMode: body.runMode,
    placeSource: "wikidata",
    placeDiscoveryMode: body.placeDiscoveryMode,
    candidateLimit: body.candidateLimit,
    priorityQueues: body.priorityQueues,
    maxPlacesToProcess: body.maxPlacesToProcess,
    includeMediaSignals: body.includeMediaSignals,
    qualityThreshold: body.qualityThreshold,
    qualityPreviewMode: body.qualityPreviewMode,
    maxPostPreviewsPerPlace: body.maxPostPreviewsPerPlace,
    maxAssetsPerPostPreview: body.maxAssetsPerPostPreview,
    groupTimeWindowMinutes: body.groupTimeWindowMinutes,
    totalTimeoutMs: body.totalTimeoutMs,
    perPlaceTimeoutMs: body.perPlaceTimeoutMs,
    wikimediaMode: body.wikimediaMode,
    wikimediaFetchAllExhaustive: body.wikimediaFetchAllExhaustive,
    postTestLatitude: body.postTestLatitude,
    postTestLongitude: body.postTestLongitude,
    locationTrustMode: body.locationTrustMode as StateContentLocationTrustMode,
    allowStagingWrites: body.allowStagingWrites,
    allowPublicPublish: false,
    postOnlyPlace,
  };
}

export function registerStateContentFactoryDevRoutes(app: FastifyInstance): void {
  const env = app.config as AppEnv;
  const enabled = stateContentFactoryDevPageEnabled(env);

  app.get("/dev/state-content-factory", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    return reply.type("text/html; charset=utf-8").send(stateContentFactoryDevPageHtml());
  });

  app.get("/dev/state-content-factory/api/health", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    return reply.send({
      ok: true,
      enabled,
      dryRunOnly: true,
      writesAllowed: stateContentFactoryStagingWritesAllowed(env),
    });
  });

  app.post("/dev/state-content-factory/api/start", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = RunConfigSchema.parse(req.body ?? {});
    const run = startStateContentFactoryRun({
      env,
      config: toRunConfig(body, "full"),
    });
    return reply.send({ ok: true, runId: run.runId, run });
  });

  app.post("/dev/state-content-factory/api/place-test", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = RunConfigSchema.parse(req.body ?? {});
    const run = startStateContentFactoryRun({
      env,
      config: toRunConfig(body, "place_only"),
    });
    return reply.send({ ok: true, runId: run.runId, run });
  });

  app.post("/dev/state-content-factory/api/post-test", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = PostTestSchema.parse(req.body ?? {});
    const run = startStateContentFactoryRun({
      env,
      config: toRunConfig(body, "post_only", body.place),
    });
    return reply.send({ ok: true, runId: run.runId, run });
  });

  app.get("/dev/state-content-factory/api/run/:runId", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const run = getStateContentFactoryRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });
    return reply.send(run);
  });

  app.get("/dev/state-content-factory/api/runs", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const limit = z.coerce.number().int().min(1).max(100).optional().default(20).parse(
      (req.query as { limit?: string } | undefined)?.limit,
    );
    return reply.send({ ok: true, runs: listStateContentFactoryRuns(limit) });
  });

  app.get("/dev/state-content-factory/api/run/:runId/logs", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const query = LogsQuerySchema.parse(req.query ?? {});
    const run = getStateContentFactoryRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });
    return reply.send({
      runId,
      since: query.since,
      nextCursor: run.nextEventCursor,
      events: getStateContentFactoryRunEvents(runId, query.since),
      logs: run.logs,
    });
  });

  app.get("/dev/state-content-factory/api/run/:runId/events", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const query = LogsQuerySchema.parse(req.query ?? {});
    const run = getStateContentFactoryRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    if (typeof reply.raw.flushHeaders === "function") {
      reply.raw.flushHeaders();
    }

    const writeEvent = (event: ReturnType<typeof getStateContentFactoryRunEvents>[number]) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      const raw = reply.raw as NodeJS.WritableStream & { flush?: () => void };
      raw.flush?.();
    };

    for (const event of getStateContentFactoryRunEvents(runId, query.since)) {
      writeEvent(event);
    }

    const unsubscribe = subscribeStateContentFactoryRunEvents(runId, writeEvent);
    const ping = setInterval(() => {
      reply.raw.write(": ping\n\n");
      const raw = reply.raw as NodeJS.WritableStream & { flush?: () => void };
      raw.flush?.();
    }, 12_000);

    await new Promise<void>((resolve) => {
      req.raw.on("close", () => {
        clearInterval(ping);
        unsubscribe();
        resolve();
      });
    });
  });

  app.get("/dev/state-content-factory/api/staged-posts", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const status = z
      .enum(["staged", "approved", "rejected", "needs_review", "duplicate"])
      .optional()
      .parse((req.query as { status?: string } | undefined)?.status);
    const posts = await listStagedGeneratedPosts({ env, status, limit: 50 });
    return reply.send({ ok: true, posts });
  });

  app.post("/dev/state-content-factory/api/staged-posts/:id/review", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const stagedPostId = z.object({ id: z.string().min(1) }).parse(req.params).id;
    const body = ReviewSchema.parse(req.body ?? {});
    const updated = await reviewStagedGeneratedPost({ env, stagedPostId, action: body.action });
    if (!updated) return reply.status(404).send({ ok: false, error: "staged_post_not_found" });
    return reply.send({ ok: true, stagedPost: updated });
  });
}
