import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingMediaRegisterContract,
  PostingMediaRegisterBodySchema
} from "../../contracts/surfaces/posting-media-register.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostingMediaRegisterOrchestrator } from "../../orchestration/mutations/posting-media-register.orchestrator.js";
import { PostingMutationError } from "../../repositories/mutations/posting-mutation.repository.js";
import { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export async function registerV2PostingMediaRegisterRoutes(app: FastifyInstance): Promise<void> {
  const service = new PostingMutationService();
  const orchestrator = new PostingMediaRegisterOrchestrator(service);

  app.post(postingMediaRegisterContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    const body = PostingMediaRegisterBodySchema.parse(request.body);
    setRouteName(postingMediaRegisterContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        sessionId: body.sessionId,
        assetIndex: body.assetIndex,
        assetType: body.assetType,
        clientMediaKey: body.clientMediaKey ?? null
      });
      return success(payload);
    } catch (error) {
      if (error instanceof PostingMutationError) {
        if (error.code === "session_not_found") {
          return reply.status(404).send(failure("session_not_found", error.message));
        }
        if (error.code === "session_not_owned") {
          return reply.status(403).send(failure("session_not_owned", error.message));
        }
      }
      throw error;
    }
  });
}
