import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  commentsCreateContract,
  CommentsCreateBodySchema,
  CommentsCreateParamsSchema
} from "../../contracts/surfaces/comments-create.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CommentsCreateOrchestrator } from "../../orchestration/mutations/comments-create.orchestrator.js";
import { commentsRepository } from "../../repositories/surfaces/comments.repository.js";
import { CommentsService } from "../../services/surfaces/comments.service.js";

export async function registerV2CommentsCreateRoutes(app: FastifyInstance): Promise<void> {
  const service = new CommentsService(commentsRepository);
  const orchestrator = new CommentsCreateOrchestrator(service);

  app.post(commentsCreateContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("comments", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Comments v2 surface is not enabled for this viewer"));
    }

    const params = CommentsCreateParamsSchema.parse(request.params);
    const body = CommentsCreateBodySchema.parse(request.body);
    setRouteName(commentsCreateContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      postId: params.postId,
      text: body.text,
      replyingTo: body.replyingTo ?? null,
      clientMutationKey: body.clientMutationKey ?? null
    });
    return success(payload);
  });
}
