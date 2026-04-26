import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingMediaRegisterOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: {
    viewerId: string;
    sessionId: string;
    assetIndex: number;
    assetType: "photo" | "video";
    clientMediaKey: string | null;
  }) {
    const result = await this.service.registerMedia(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }
    return {
      routeName: "posting.mediaregister.post" as const,
      media: {
        mediaId: result.media.mediaId,
        sessionId: result.media.sessionId,
        assetIndex: result.media.assetIndex,
        assetType: result.media.assetType,
        expectedObjectKey: result.media.expectedObjectKey,
        state: result.media.state,
        pollAfterMs: result.media.pollAfterMs
      },
      upload: {
        strategy: "direct_object_store" as const,
        binaryUploadThroughApi: false as const
      },
      idempotency: {
        replayed: result.idempotent
      }
    };
  }
}
