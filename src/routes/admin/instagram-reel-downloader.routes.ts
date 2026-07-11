import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { failure } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { renderInstagramReelDownloaderPage } from "../../dashboard/instagram-reel-downloader.js";
import {
  downloadInstagramReelFileRequest,
  instagramDownloaderHealth,
  probeInstagramReel,
  resolveInstagramReelRequest,
} from "../../services/admin/instagramReel.service.js";

const ResolveBodySchema = z.object({
  url: z.string().min(8),
  cookies: z.array(z.record(z.unknown())).optional(),
});

const FileBodySchema = z.object({
  url: z.string().min(8),
  sourceUrl: z.string().optional(),
  shortcode: z.string().optional(),
  resolverMethod: z.string().optional(),
  preferMuxedAudio: z.boolean().optional(),
  cookies: z.array(z.record(z.unknown())).optional(),
  filename: z.string().optional(),
  download: z.boolean().optional(),
});

const apiBase = "/admin/instagram-downloader/api";

export async function registerInstagramReelDownloaderRoutes(
  app: FastifyInstance,
  env: AppEnv,
): Promise<void> {
  app.get("/admin/instagram-downloader", async (_request, reply) => {
    setRouteName("admin.instagram_downloader.page");
    reply.type("text/html; charset=utf-8");
    return reply.send(renderInstagramReelDownloaderPage());
  });

  app.get(`${apiBase}/health`, async () => {
    setRouteName("admin.instagram_downloader.health");
    return instagramDownloaderHealth(env);
  });

  app.get(`${apiBase}/probe`, async (_request, reply) => {
    setRouteName("admin.instagram_downloader.probe");
    try {
      const out = await probeInstagramReel();
      reply.status(out.status);
      if (out.kind === "json") {
        reply.header("Content-Type", out.contentType);
        return reply.send(out.body);
      }
      return reply.send(out.body);
    } catch (e: unknown) {
      return reply.status(502).send(
        failure("probe_failed", e instanceof Error ? e.message : String(e)),
      );
    }
  });

  app.post(`${apiBase}/resolve`, async (request, reply) => {
    setRouteName("admin.instagram_downloader.resolve");
    const body = ResolveBodySchema.parse(request.body ?? {});
    try {
      const out = await resolveInstagramReelRequest(body, {
        debug: true,
        userAgent: request.headers["user-agent"],
      });
      reply.status(out.status);
      if (out.kind === "json") {
        reply.header("Content-Type", out.contentType);
        return reply.send(out.body);
      }
      return reply.send(out.body);
    } catch (e: unknown) {
      return reply.status(502).send(
        failure("resolve_failed", e instanceof Error ? e.message : String(e)),
      );
    }
  });

  app.post(`${apiBase}/file`, async (request, reply) => {
    setRouteName("admin.instagram_downloader.file");
    const body = FileBodySchema.parse(request.body ?? {});
    try {
      const out = await downloadInstagramReelFileRequest(body);
      reply.status(out.status);
      if (out.kind === "json") {
        reply.header("Content-Type", out.contentType);
        return reply.send(out.body);
      }
      for (const [k, v] of Object.entries(out.headers)) {
        reply.header(k, v);
      }
      return reply.send(out.body);
    } catch (e: unknown) {
      return reply.status(502).send(
        failure("file_failed", e instanceof Error ? e.message : String(e)),
      );
    }
  });
}
