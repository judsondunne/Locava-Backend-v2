import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { startPlaceCandidateDevRun } from "../../lib/place-candidates/placeCandidateDevRunner.js";
import { generateStatePlaceCandidates } from "../../lib/place-candidates/generateStatePlaceCandidates.js";
import { placeCandidateDevPageEnabled } from "../../lib/place-candidates/placeCandidateEnv.js";
import {
  clearPlaceCandidateRuns,
  getPlaceCandidateRun,
  getPlaceCandidateRunEvents,
  subscribePlaceCandidateRunEvents,
} from "../../lib/place-candidates/placeCandidateRunStore.js";
import { listSupportedUsStates } from "../../lib/place-candidates/statePlaceCandidateConfig.js";
import { placeCandidatesDevPageHtml } from "./placeCandidatesDevPage.js";

const StateBodySchema = z.object({
  stateName: z.string().trim().min(1).max(80),
  stateCode: z.string().trim().min(2).max(2).optional(),
  mode: z.enum(["fast_smoke", "fast_targeted", "deep_discovery"]).optional().default("fast_targeted"),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  totalTimeoutMs: z.coerce.number().int().min(500).max(300_000).optional(),
  perQueryTimeoutMs: z.coerce.number().int().min(500).max(60_000).optional(),
  sources: z.array(z.string().trim().min(1)).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  includeRaw: z.boolean().optional().default(false),
  includeMediaSignals: z.boolean().optional(),
  strictMinScore: z.boolean().optional(),
  dryRun: z.boolean().optional().default(true),
});

const LogsQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional().default(0),
});

function gateDisabled(reply: { status: (n: number) => { send: (b: unknown) => void } }) {
  return reply.status(404).send({ ok: false, error: "place_candidate_dev_disabled" });
}

export function registerPlaceCandidateDevRoutes(app: FastifyInstance): void {
  const env = app.config as AppEnv;
  const enabled = placeCandidateDevPageEnabled(env);

  app.get("/dev/place-candidates", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    return reply.type("text/html; charset=utf-8").send(placeCandidatesDevPageHtml());
  });

  app.get("/dev/place-candidates/api/health", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    return reply.send({ ok: true, enabled, dryRunOnly: true, supportedStates: listSupportedUsStates() });
  });

  app.post("/dev/place-candidates/api/start", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = StateBodySchema.parse(req.body ?? {});
    const run = startPlaceCandidateDevRun({
      stateName: body.stateName,
      stateCode: body.stateCode,
      mode: body.mode,
      limit: body.limit,
      totalTimeoutMs: body.totalTimeoutMs,
      perQueryTimeoutMs: body.perQueryTimeoutMs,
      sources: body.sources,
      minScore: body.minScore,
      includeRaw: body.includeRaw,
      includeMediaSignals: body.includeMediaSignals,
      strictMinScore: body.strictMinScore,
      dryRun: true,
    });
    return reply.send({ ok: true, runId: run.runId, run });
  });

  app.get("/dev/place-candidates/api/run/:runId", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const run = getPlaceCandidateRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });
    return reply.send(run);
  });

  app.get("/dev/place-candidates/api/run/:runId/logs", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const query = LogsQuerySchema.parse(req.query ?? {});
    const run = getPlaceCandidateRun(runId);
    if (!run) return reply.status(404).send({ ok: false, error: "run_not_found" });
    return reply.send({
      runId,
      since: query.since,
      nextCursor: run.nextEventCursor,
      events: getPlaceCandidateRunEvents(runId, query.since),
      logs: run.logs,
    });
  });

  app.get("/dev/place-candidates/api/run/:runId/events", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const runId = z.object({ runId: z.string().min(1) }).parse(req.params).runId;
    const query = LogsQuerySchema.parse(req.query ?? {});
    const run = getPlaceCandidateRun(runId);
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

    const writeEvent = (event: ReturnType<typeof getPlaceCandidateRunEvents>[number]) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      const raw = reply.raw as NodeJS.WritableStream & { flush?: () => void };
      raw.flush?.();
    };

    for (const event of getPlaceCandidateRunEvents(runId, query.since)) {
      writeEvent(event);
    }

    const unsubscribe = subscribePlaceCandidateRunEvents(runId, writeEvent);
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

  app.post("/dev/place-candidates/state", async (req, reply) => {
    if (!enabled) return gateDisabled(reply);
    const body = StateBodySchema.parse(req.body ?? {});
    try {
      const result = await generateStatePlaceCandidates({
        stateName: body.stateName,
        stateCode: body.stateCode,
        mode: body.mode,
        limit: body.limit,
        totalTimeoutMs: body.totalTimeoutMs,
        perQueryTimeoutMs: body.perQueryTimeoutMs,
        sources: body.sources,
        minScore: body.minScore,
        includeRaw: body.includeRaw,
        includeMediaSignals: body.includeMediaSignals,
        strictMinScore: body.strictMinScore,
        dryRun: true,
      });
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ ok: false, error: message });
    }
  });

  app.post("/dev/place-candidates/api/clear", async (_req, reply) => {
    if (!enabled) return gateDisabled(reply);
    clearPlaceCandidateRuns();
    return reply.send({ ok: true });
  });
}
