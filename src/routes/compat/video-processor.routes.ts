import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadEnv } from "../../config/env.js";
import { failure, success } from "../../lib/response.js";
import { processDeferred1080UpgradeJob } from "../../services/video/deferred-1080-upgrade.processor.js";
import { processVideoPostJob } from "../../services/video/video-post-processor.service.js";

const BodySchema = z.object({
  postId: z.string().min(1),
  userId: z.string().min(1),
  videoAssets: z.array(z.object({ id: z.string().min(1), original: z.string().url() })).min(1),
  correlationId: z.string().optional(),
  jobType: z.enum(["faststart", "deferred_1080_upgrade"]).optional()
});

/**
 * Cloud Tasks-compatible entrypoint (same JSON body as legacy `video-processor` Cloud Function).
 * When `VIDEO_PROCESSOR_TASK_SECRET` is set in env, requests must include header
 * `x-locava-video-processor-secret: <secret>`.
 */
export async function registerVideoProcessorRoutes(app: FastifyInstance): Promise<void> {
  app.post("/video-processor", async (request, reply) => {
    const env = loadEnv();
    const secret = process.env.VIDEO_PROCESSOR_TASK_SECRET?.trim();
    if (secret) {
      const got = String(request.headers["x-locava-video-processor-secret"] ?? "").trim();
      if (got !== secret) {
        return reply.status(401).send(failure("unauthorized", "Invalid video processor secret"));
      }
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(request.body ?? {});
    } catch {
      return reply.status(400).send(failure("validation_error", "Invalid JSON body"));
    }

    const started = Date.now();
    const jobType = body.jobType ?? "faststart";
    const result =
      jobType === "deferred_1080_upgrade"
        ? await processDeferred1080UpgradeJob({
            postId: body.postId,
            userId: body.userId,
            videoAssets: body.videoAssets
          })
        : await processVideoPostJob({
            postId: body.postId,
            userId: body.userId,
            videoAssets: body.videoAssets
          });
    const ms = Date.now() - started;
    if (!result.ok) {
      app.log.warn({ postId: body.postId, ms, err: result.error }, "video.processor.failed");
      return reply.status(500).send(failure("video_processor_failed", result.error));
    }
    app.log.info({ postId: body.postId, ms }, "video.processor.ok");
    return success({ ok: true, postId: body.postId, ms, service: env.SERVICE_NAME });
  });
}
