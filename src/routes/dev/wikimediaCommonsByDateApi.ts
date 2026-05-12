import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fetchCommonsSearchGroupedByDate,
  streamCommonsSearchGroupedByDate,
  type CommonsSearchGroupedSnapshot,
} from "../../lib/wikimediaMvp/fetchCommonsSearchGroupedByDate.js";
import { wikimediaCommonsByDateDevPageHtml } from "./wikimediaCommonsByDateDevPage.js";

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(400),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(500),
  /** Query string flag; omit or true = raster photos only. */
  imagesOnly: z
    .string()
    .optional()
    .transform((s) => s !== "false"),
  /** Omit or true = keep only files with Commons coordinates. */
  requireGeo: z
    .string()
    .optional()
    .transform((s) => s !== "false"),
});

export function registerWikimediaCommonsByDateDevRoutes(app: FastifyInstance): void {
  app.get("/dev/wikimedia-commons-by-date", async (_req, reply) => {
    return reply.type("text/html; charset=utf-8").send(wikimediaCommonsByDateDevPageHtml());
  });

  app.get("/dev/wikimedia-commons-by-date/api/search", async (req, reply) => {
    const parsed = SearchQuerySchema.parse(req.query ?? {});
    const t0 = Date.now();
    try {
      const out = await fetchCommonsSearchGroupedByDate({
        searchQuery: parsed.q,
        maxFiles: parsed.limit,
        imagesOnly: parsed.imagesOnly,
        requireGeo: parsed.requireGeo,
      });
      return reply.send({
        ok: true,
        ms: Date.now() - t0,
        ...out,
      });
    } catch (e) {
      return reply.status(502).send({
        ok: false,
        error: e instanceof Error ? e.message : "commons_fetch_failed",
      });
    }
  });

  /** SSE: one JSON event per Commons API batch so the dashboard can paint incrementally. */
  app.get("/dev/wikimedia-commons-by-date/api/search-stream", async (req, reply) => {
    const parsed = SearchQuerySchema.parse(req.query ?? {});
    const t0 = Date.now();
    const ac = new AbortController();
    req.raw.on("close", () => {
      ac.abort();
    });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof reply.raw.flushHeaders === "function") {
      reply.raw.flushHeaders();
    }

    const writeSse = (obj: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
      const raw = reply.raw as NodeJS.WritableStream & { flush?: () => void };
      raw.flush?.();
    };

    try {
      let lastSnap: CommonsSearchGroupedSnapshot | null = null;
      for await (const snap of streamCommonsSearchGroupedByDate({
        searchQuery: parsed.q,
        maxFiles: parsed.limit,
        imagesOnly: parsed.imagesOnly,
        requireGeo: parsed.requireGeo,
        signal: ac.signal,
      })) {
        lastSnap = snap;
        writeSse({
          ok: true,
          done: false,
          ms: Date.now() - t0,
          ...snap,
        });
      }
      const snap = lastSnap ?? {
        query: parsed.q,
        requireGeo: parsed.requireGeo,
        groupCount: 0,
        totalFetched: 0,
        apiRequests: 0,
        byDate: [],
        truncated: false,
        rejected: [],
        rejectedTotal: 0,
        geoSkippedCount: 0,
        scannedCount: 0,
      };
      writeSse({
        ok: true,
        done: true,
        ms: Date.now() - t0,
        ...snap,
      });
    } catch (e) {
      writeSse({
        ok: false,
        done: true,
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : "commons_fetch_failed",
      });
    }
    reply.raw.end();
  });
}
