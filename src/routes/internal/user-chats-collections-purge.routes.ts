import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { failure, success } from "../../lib/response.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { runUserChatsAndOwnedCollectionsPurge } from "../../services/ops/user-chats-collections-purge.runner.js";

const BodySchema = z.object({
  userId: z.string().min(1),
  /** Dry-run: list counts and ids only (no deletes). Shorthand: `d` also accepted. */
  dryRun: z.boolean().optional(),
  d: z.boolean().optional(),
  /** When true, also hard-deletes system-managed / generated `collections/*` this user owns. */
  includeSystemCollections: z.boolean().optional(),
  /**
   * Execute deletes only when `dryRun`/`d` is false AND `confirm` is exactly `yes`.
   * Matches a simple "type yes" safety gate (no interactive TTY on HTTP).
   */
  confirm: z.literal("yes").optional()
});

/**
 * POST /internal/ops/emergency/purge-user-chats-and-owned-collections
 *
 * Intentionally no auth — remove this route immediately after one-off cleanup.
 */
export async function registerUserChatsCollectionsPurgeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/internal/ops/emergency/purge-user-chats-and-owned-collections", async (request, reply) => {
    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("firestore_unavailable", "Firestore client is not available"));
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(request.body ?? {});
    } catch {
      return reply.status(400).send(failure("validation_error", "Invalid JSON body (expected userId, optional dryRun|d, optional confirm)"));
    }

    const dryRun = body.d ?? body.dryRun ?? true;
    if (!dryRun && body.confirm !== "yes") {
      return reply.status(400).send(
        failure(
          "confirm_required",
          "To execute deletes, send dryRun:false (or d:false) and confirm:\"yes\". Run with dryRun:true first."
        )
      );
    }

    try {
      const summary = await runUserChatsAndOwnedCollectionsPurge(db, {
        userId: body.userId,
        dryRun,
        includeSystemCollections: body.includeSystemCollections
      });
      return success(summary);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("purge_failed", msg));
    }
  });
}
