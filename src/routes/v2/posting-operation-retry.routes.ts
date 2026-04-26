import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingOperationRetryContract,
  PostingOperationRetryParamsSchema
} from "../../contracts/surfaces/posting-operation-retry.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostingOperationRetryOrchestrator } from "../../orchestration/mutations/posting-operation-retry.orchestrator.js";
import { PostingMutationError } from "../../repositories/mutations/posting-mutation.repository.js";
import { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export async function registerV2PostingOperationRetryRoutes(app: FastifyInstance): Promise<void> {
  const service = new PostingMutationService();
  const orchestrator = new PostingOperationRetryOrchestrator(service);

  app.post(postingOperationRetryContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    const params = PostingOperationRetryParamsSchema.parse(request.params);
    setRouteName(postingOperationRetryContract.routeName);
    try {
      const payload = await orchestrator.run({
        viewerId: viewer.viewerId,
        operationId: params.operationId
      });
      return success(payload);
    } catch (error) {
      if (error instanceof PostingMutationError) {
        if (error.code === "operation_not_found") {
          return reply.status(404).send(failure("operation_not_found", error.message));
        }
        if (error.code === "operation_not_owned") {
          return reply.status(403).send(failure("operation_not_owned", error.message));
        }
        if (error.code === "operation_retry_not_allowed") {
          return reply.status(409).send(failure("operation_retry_not_allowed", error.message));
        }
      }
      throw error;
    }
  });
}
