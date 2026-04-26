import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingMediaMarkUploadedContract,
  PostingMediaMarkUploadedBodySchema,
  PostingMediaMarkUploadedParamsSchema
} from "../../contracts/surfaces/posting-media-mark-uploaded.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostingMediaMarkUploadedOrchestrator } from "../../orchestration/mutations/posting-media-mark-uploaded.orchestrator.js";
import { PostingMutationError } from "../../repositories/mutations/posting-mutation.repository.js";
import { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export async function registerV2PostingMediaMarkUploadedRoutes(app: FastifyInstance): Promise<void> {
  const service = new PostingMutationService();
  const orchestrator = new PostingMediaMarkUploadedOrchestrator(service);

  app.post(postingMediaMarkUploadedContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    const params = PostingMediaMarkUploadedParamsSchema.parse(request.params);
    const body = PostingMediaMarkUploadedBodySchema.parse(request.body);
    setRouteName(postingMediaMarkUploadedContract.routeName);
    try {
      // invalidation: mark-uploaded advances posting operation/media state so operation status readers observe the upload transition.
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        mediaId: params.mediaId,
        uploadedObjectKey: body.uploadedObjectKey ?? null
      });
      return success(payload);
    } catch (error) {
      if (error instanceof PostingMutationError) {
        if (error.code === "media_not_found") {
          return reply.status(404).send(failure("media_not_found", error.message));
        }
        if (error.code === "media_not_owned") {
          return reply.status(403).send(failure("media_not_owned", error.message));
        }
      }
      throw error;
    }
  });
}
