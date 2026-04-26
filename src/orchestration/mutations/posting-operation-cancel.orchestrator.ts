import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingOperationCancelOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: { viewerId: string; operationId: string }) {
    const result = await this.service.cancelPostingOperation(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }
    return {
      routeName: "posting.operationcancel.post" as const,
      operation: {
        operationId: result.operation.operationId,
        state: result.operation.state,
        terminalReason: result.operation.terminalReason,
        retryCount: result.operation.retryCount,
        updatedAtMs: result.operation.updatedAtMs
      },
      idempotency: {
        replayed: result.idempotent
      }
    };
  }
}
