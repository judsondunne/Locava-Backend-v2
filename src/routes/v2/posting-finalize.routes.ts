import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingFinalizeContract,
  PostingFinalizeBodySchema,
  POSTING_FINALIZE_BODY_LIMIT_BYTES
} from "../../contracts/surfaces/posting-finalize.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostingFinalizeOrchestrator } from "../../orchestration/mutations/posting-finalize.orchestrator.js";
import { PostingMutationError } from "../../repositories/mutations/posting-mutation.repository.js";
import { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export async function registerV2PostingFinalizeRoutes(app: FastifyInstance): Promise<void> {
  const service = new PostingMutationService();
  const orchestrator = new PostingFinalizeOrchestrator(service);

  app.post(postingFinalizeContract.path, { bodyLimit: POSTING_FINALIZE_BODY_LIMIT_BYTES }, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    const body = PostingFinalizeBodySchema.parse(request.body);
    setRouteName(postingFinalizeContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        sessionId: body.sessionId,
        stagedSessionId: body.stagedSessionId,
        stagedItems: body.stagedItems,
        idempotencyKey: body.idempotencyKey,
        mediaCount: body.mediaCount,
        userId: body.userId,
        title: body.title,
        content: body.content,
        activities: body.activities,
        lat: body.lat,
        long: body.long,
        address: body.address,
        privacy: body.privacy,
        tags: body.tags,
        texts: body.texts,
        recordings: body.recordings,
        displayPhotoBase64: body.displayPhotoBase64,
        videoPostersBase64: body.videoPostersBase64,
        legendStageId: body.legendStageId,
        authorizationHeader: typeof request.headers.authorization === "string" ? request.headers.authorization : undefined
      });
      return success(payload);
    } catch (error) {
      if (error instanceof PostingMutationError) {
        if (error.code === "session_not_found") {
          return reply.status(404).send(failure("session_not_found", error.message));
        }
        if (error.code === "session_expired") {
          return reply.status(410).send(failure("session_expired", error.message));
        }
        if (error.code === "session_not_open") {
          return reply.status(409).send(failure("session_not_open", error.message));
        }
        if (error.code === "session_not_owned") {
          return reply.status(403).send(failure("session_not_owned", error.message));
        }
      }
      throw error;
    }
  });
}
