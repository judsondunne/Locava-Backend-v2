import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingMediaStatusOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: { viewerId: string; mediaId: string }) {
    const media = await this.service.getMediaStatus(input);
    const shouldPoll = media.state === "registered" || media.state === "uploaded";
    return {
      routeName: "posting.mediastatus.get" as const,
      media: {
        mediaId: media.mediaId,
        sessionId: media.sessionId,
        assetIndex: media.assetIndex,
        assetType: media.assetType,
        state: media.state,
        expectedObjectKey: media.expectedObjectKey,
        uploadedAtMs: media.uploadedAtMs,
        readyAtMs: media.readyAtMs,
        pollCount: media.pollCount,
        pollAfterMs: media.pollAfterMs,
        failureReason: media.failureReason
      },
      polling: {
        shouldPoll,
        recommendedIntervalMs: media.pollAfterMs
      }
    };
  }
}
