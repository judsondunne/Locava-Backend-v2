import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingUploadSessionOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: { viewerId: string; clientSessionKey: string; mediaCountHint: number }) {
    const result = await this.service.createUploadSession(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }

    return {
      routeName: "posting.uploadsession.post" as const,
      uploadSession: {
        sessionId: result.session.sessionId,
        state: result.session.state,
        mediaCountHint: result.session.mediaCountHint,
        expiresAtMs: result.session.expiresAtMs
      },
      idempotency: {
        replayed: result.idempotent
      },
      polling: {
        recommendedIntervalMs: 1500
      }
    };
  }
}
