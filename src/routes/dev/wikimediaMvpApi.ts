import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import {
  clearWikimediaMvpRunState,
  runNextWikimediaMvpPlace,
  startWikimediaMvpRun,
} from "../../lib/wikimediaMvp/WikimediaMvpRunner.js";
import { runWikimediaPlacePreviewPipeline } from "../../lib/wikimediaMvp/runWikimediaPlacePreviewPipeline.js";
import {
  getWikimediaMvpRun,
  getWikimediaMvpRunEvents,
  subscribeWikimediaMvpRunEvents,
} from "../../lib/wikimediaMvp/wikimediaMvpRunStore.js";
import { wikimediaMvpDevPageEnabled } from "../../lib/wikimediaMvp/wikimediaMvpEnv.js";
import { wikimediaMvpDevPageHtml } from "./wikimediaMvpDevPage.js";

const StartBodySchema = z.object({
  places: z.string().default(""),
  singlePlace: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  fetchAll: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(true),
});

const RunNextBodySchema = z.object({
  runId: z.string().min(1),
});

const RunPlaceBodySchema = z.object({
  place: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  fetchAll: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(true),
});

const LogsQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional().default(0),
});

function gateDisabled(reply: { status: (n: number) => { send: (b: unknown) => void } }) {
  return reply.status(404).send({ ok: false, error: "wikimedia_mvp_dev_disabled" });
}

export function registerWikimediaMvpDevRoutes(app: FastifyInstance): void {
  const env = app.config as AppEnv;
  const enabled = wikimediaMvpDevPageEnabled(env);

  app.get("/dev/wikimedia-mvp", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    return reply.type("text/html; charset=utf-8").send(wikimediaMvpDevPageHtml());
  });

  app.get("/dev/wikimedia-mvp/api/health", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    return reply.send({ ok: true, enabled, writesAllowed: String(env.WIKIMEDIA_MVP_ALLOW_WRITES ?? "").trim() === "true" });
  });

  app.post("/dev/wikimedia-mvp/api/start", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = StartBodySchema.parse(req.body ?? {});
    const run = startWikimediaMvpRun({
      env,
      places: body.singlePlace ? [body.singlePlace] : undefined,
      placesText: body.singlePlace ? undefined : body.places,
      limitPerPlace: body.limit,
      fetchAll: body.fetchAll,
      dryRun: body.dryRun,
    });
    return reply.send({ ok: true, runId: run.runId, run });
  });

  app.post("/dev/wikimedia-mvp/api/run-next", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = RunNextBodySchema.parse(req.body ?? {});
    const placeResult = await runNextWikimediaMvpPlace(body.runId, env);
    const run = getWikimediaMvpRun(body.runId);
    return reply.send({ ok: true, placeResult, run, summary: placeResult?.summary ?? null });
  });

  app.post("/dev/wikimedia-mvp/api/run-place", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = RunPlaceBodySchema.parse(req.body ?? {});
    const { runId, placeResult, summary } = await runWikimediaPlacePreviewPipeline({
      env,
      placeLabel: body.place,
      limit: body.limit,
      fetchAll: body.fetchAll,
      dryRun: body.dryRun,
      matchStandaloneDevApi: true,
    });
    const run = getWikimediaMvpRun(runId);
    return reply.send({
      ok: true,
      runId,
      summary,
      candidateAnalysis: placeResult.candidateAnalysis,
      generatedPosts: placeResult.generatedPosts,
      placeResult,
      run: run ?? null,
    });
  });

  app.get("/dev/wikimedia-mvp/api/run/:runId", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const run = getWikimediaMvpRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });
    return reply.send(run);
  });

  app.get("/dev/wikimedia-mvp/api/run/:runId/logs", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const query = LogsQuerySchema.parse(req.query ?? {});
    const events = getWikimediaMvpRunEvents(runId, query.since);
    const run = getWikimediaMvpRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });
    return reply.send({
      runId,
      since: query.since,
      nextCursor: run.nextEventCursor,
      events,
      logs: run.logs,
    });
  });

  app.get("/dev/wikimedia-mvp/api/run/:runId/events", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const query = LogsQuerySchema.parse(req.query ?? {});
    const run = getWikimediaMvpRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const backlog = getWikimediaMvpRunEvents(runId, query.since);
    for (const event of backlog) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const unsubscribe = subscribeWikimediaMvpRunEvents(runId, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.raw.on("close", () => {
      unsubscribe();
    });
  });

  app.post("/dev/wikimedia-mvp/api/clear", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    clearWikimediaMvpRunState();
    return reply.send({ ok: true });
  });
}
