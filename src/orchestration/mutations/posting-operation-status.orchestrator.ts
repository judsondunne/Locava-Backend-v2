import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingOperationStatusOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: { viewerId: string; operationId: string }) {
    const operation = await this.service.getPostingOperation(input);
    const shouldPoll = operation.state === "processing";
    const completionInvalidated = operation.completionInvalidatedAtMs != null;

    return {
      routeName: "posting.operationstatus.get" as const,
      operation: {
        operationId: operation.operationId,
        sessionId: operation.sessionId,
        postId: operation.postId,
        state: operation.state,
        terminalReason: operation.terminalReason,
        pollCount: operation.pollCount,
        pollAfterMs: operation.pollAfterMs,
        retryCount: operation.retryCount,
        completionInvalidatedAtMs: operation.completionInvalidatedAtMs,
        updatedAtMs: operation.updatedAtMs
      },
      polling: {
        shouldPoll,
        recommendedIntervalMs: operation.pollAfterMs
      },
      invalidation: {
        applied: completionInvalidated,
        invalidationTypes: completionInvalidated
          ? ["post.social", "post.card", "post.detail", "post.viewer_state", "route.detail"]
          : []
      }
    };
  }
}
