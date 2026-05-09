/**
 * POST /v2/posts/render-standardized:batch
 *
 * Read-only standardized post fetch for the Native real-post-render-data
 * pipeline. The endpoint:
 *   - validates request body
 *   - enforces viewer-scoped privacy (blocked authors, deleted/hidden posts,
 *     private visibility) before returning standardized docs
 *   - emits `RENDER_STANDARDIZED_BATCH_READONLY_VERIFIED` once on first hit
 *     so observability sees the read-only contract is wired
 */

import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  RenderStandardizedBatchBodySchema,
  renderStandardizedBatchContract
} from "../../contracts/standardized-post-doc.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  assertHandlerReadOnly,
  handleRenderStandardizedBatch
} from "../../services/posts/render-standardized-batch.handler.js";

let readOnlyVerifiedLogged = false;

export async function registerV2PostsRenderStandardizedBatchRoutes(
  app: FastifyInstance
): Promise<void> {
  app.post(renderStandardizedBatchContract.path, async (request, reply) => {
    if (!readOnlyVerifiedLogged) {
      readOnlyVerifiedLogged = true;
      assertHandlerReadOnly();
      // eslint-disable-next-line no-console
      console.info("RENDER_STANDARDIZED_BATCH_READONLY_VERIFIED", {
        path: renderStandardizedBatchContract.path,
        routeName: renderStandardizedBatchContract.routeName
      });
    }

    setRouteName(renderStandardizedBatchContract.routeName);

    const viewer = buildViewerContext(request);
    const parsed = RenderStandardizedBatchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(failure("invalid_body", "render_standardized_batch_invalid_body", parsed.error.issues));
    }
    const surfaceHeader = request.headers["x-locava-surface"];
    const surface =
      typeof surfaceHeader === "string"
        ? surfaceHeader
        : Array.isArray(surfaceHeader)
          ? String(surfaceHeader[0] ?? "")
          : null;

    try {
      const payload = await handleRenderStandardizedBatch({
        viewerId: viewer.viewerId,
        postIds: parsed.data.postIds,
        surface
      });
      return success(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("RENDER_STANDARDIZED_BATCH_HANDLER_ERROR", {
        message: err instanceof Error ? err.message : "unknown",
        viewerId: viewer.viewerId,
        idCount: parsed.data.postIds.length,
        surface
      });
      return reply
        .status(500)
        .send(failure("render_standardized_batch_failed", "render_standardized_batch_failed"));
    }
  });
}
