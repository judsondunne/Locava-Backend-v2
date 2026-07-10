import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { failure, success } from "../../lib/response.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { embedAndStorePost } from "../../services/search/write-post-embedding.js";
import { POST_EMBEDDING_TASK_SECRET_HEADER } from "../../services/search/post-embedding-cloud-task.service.js";

const BodySchema = z.object({
  postId: z.string().min(1),
  userId: z.string().optional(),
  correlationId: z.string().optional(),
  force: z.boolean().optional()
});

/**
 * POST /internal/search/post-embedding-worker
 *
 * Cloud Task target that computes and stores a single post's semantic-search embedding.
 * Protected by the shared `POST_EMBEDDING_TASK_SECRET` (when configured) to match the video-processor
 * worker's secret-header pattern.
 */
export async function registerPostEmbeddingWorkerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/internal/search/post-embedding-worker", async (request, reply) => {
    const secret = process.env.POST_EMBEDDING_TASK_SECRET?.trim();
    if (secret) {
      const provided = request.headers[POST_EMBEDDING_TASK_SECRET_HEADER];
      if (provided !== secret) {
        return reply.status(401).send(failure("unauthorized", "Invalid or missing task secret"));
      }
    }

    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("firestore_unavailable", "Firestore client is not available"));
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(request.body ?? {});
    } catch {
      return reply.status(400).send(failure("validation_error", "Invalid JSON body (expected postId)"));
    }

    try {
      const result = await embedAndStorePost(db, body.postId, { force: body.force });
      if (!result.ok) {
        // 404 for missing post so Cloud Tasks does not retry indefinitely.
        const status = result.reason === "post_not_found" ? 404 : 500;
        return reply.status(status).send(failure("embedding_failed", result.reason));
      }
      return reply.send(success({ routeName: "internal.search.post-embedding-worker", postId: body.postId, ...result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[search.embedding.worker_failed]", { postId: body.postId, message });
      return reply.status(500).send(failure("embedding_error", message));
    }
  });
}
