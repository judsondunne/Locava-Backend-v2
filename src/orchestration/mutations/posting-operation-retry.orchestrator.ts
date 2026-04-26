import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingOperationRetryOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: { viewerId: string; operationId: string }) {
    const result = await this.service.retryPostingOperation(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }
    return {
      routeName: "posting.operationretry.post" as const,
      operation: {
        operationId: result.operation.operationId,
        postId: result.operation.postId,
        state: result.operation.state,
        terminalReason: result.operation.terminalReason,
        pollAfterMs: result.operation.pollAfterMs,
        retryCount: result.operation.retryCount,
        updatedAtMs: result.operation.updatedAtMs
      },
      idempotency: {
        replayed: result.idempotent
      }
    };
  }
}
