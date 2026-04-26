import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingUploadSessionContract,
  PostingUploadSessionBodySchema
} from "../../contracts/surfaces/posting-upload-session.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostingUploadSessionOrchestrator } from "../../orchestration/mutations/posting-upload-session.orchestrator.js";
import { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export async function registerV2PostingUploadSessionRoutes(app: FastifyInstance): Promise<void> {
  const service = new PostingMutationService();
  const orchestrator = new PostingUploadSessionOrchestrator(service);

  app.post(postingUploadSessionContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    const body = PostingUploadSessionBodySchema.parse(request.body);
    setRouteName(postingUploadSessionContract.routeName);
    const payload = await orchestrator.run({
      viewerId: viewer.viewerId,
      clientSessionKey: body.clientSessionKey,
      mediaCountHint: body.mediaCountHint
    });

    return success(payload);
  });
}
