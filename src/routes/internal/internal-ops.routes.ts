import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { failure, success } from "../../lib/response.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import {
  mergeUserSearchFieldsBackfillOptions,
  runUserSearchFieldsBackfill
} from "../../services/ops/user-search-fields-backfill.runner.js";

const BackfillBodySchema = z.object({
  dryRun: z.boolean().optional(),
  /** Omit for unlimited scan length (use with caution). */
  limit: z.number().int().positive().optional(),
  startAfterDocId: z.string().min(1).optional(),
  progressEvery: z.number().int().min(0).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  batchSize: z.number().int().min(1).max(500).optional()
});

export async function registerInternalOpsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/internal/ops/backfill/user-search-fields", async (request, reply) => {
    const token = app.config.INTERNAL_OPS_TOKEN;
    if (!token || token.length === 0) {
      return reply.status(503).send(failure("internal_ops_disabled", "INTERNAL_OPS_TOKEN is not configured"));
    }
    const authHeader = request.headers.authorization;
    if (authHeader !== `Bearer ${token}`) {
      return reply.status(401).send(failure("unauthorized", "Authorization must be Bearer <INTERNAL_OPS_TOKEN>"));
    }

    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("firestore_unavailable", "Firestore client is not available"));
    }

    let body: z.infer<typeof BackfillBodySchema>;
    try {
      body = BackfillBodySchema.parse(request.body ?? {});
    } catch {
      return reply.status(400).send(failure("validation_error", "Invalid JSON body"));
    }

    try {
      const summary = await runUserSearchFieldsBackfill(
        db,
        mergeUserSearchFieldsBackfillOptions({
          dryRun: body.dryRun ?? false,
          limit: body.limit ?? null,
          startAfterDocId: body.startAfterDocId ?? null,
          progressEvery: body.progressEvery ?? 500,
          pageSize: body.pageSize ?? 400,
          batchSize: body.batchSize ?? 400
        })
      );
      return success(summary);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.startsWith("start_after_not_found:")) {
        return reply.status(400).send(failure("invalid_cursor", msg));
      }
      throw error;
    }
  });
}
