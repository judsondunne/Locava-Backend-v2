import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingMediaMarkUploadedOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: { viewerId: string; mediaId: string; uploadedObjectKey: string | null }) {
    const result = await this.service.markMediaUploaded(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }
    return {
      routeName: "posting.mediamarkuploaded.post" as const,
      media: {
        mediaId: result.media.mediaId,
        state: result.media.state,
        uploadedAtMs: result.media.uploadedAtMs,
        expectedObjectKey: result.media.expectedObjectKey,
        pollAfterMs: result.media.pollAfterMs
      },
      idempotency: {
        replayed: result.idempotent
      }
    };
  }
}
