import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostingMutationService } from "../../services/mutations/posting-mutation.service.js";

export class PostingFinalizeOrchestrator {
  constructor(private readonly service: PostingMutationService) {}

  async run(input: {
    viewerId: string;
    sessionId: string;
    stagedSessionId?: string;
    stagedItems?: Array<{
      index: number;
      assetType: "photo" | "video";
      assetId?: string;
      originalKey?: string;
      originalUrl?: string;
      posterKey?: string;
      posterUrl?: string;
    }>;
    idempotencyKey: string;
    mediaCount: number;
    userId?: string;
    title?: string;
    content?: string;
    activities?: string[];
    lat?: number | string;
    long?: number | string;
    address?: string;
    privacy?: string;
    tags?: Array<Record<string, unknown>>;
    texts?: unknown[];
    recordings?: unknown[];
    displayPhotoBase64?: string;
    videoPostersBase64?: Array<string | null>;
    legendStageId?: string;
    authorizationHeader?: string;
  }) {
    const result = await this.service.finalizePosting(input);
    if (result.idempotent) {
      recordIdempotencyHit();
    } else {
      recordIdempotencyMiss();
    }

    return {
      routeName: "posting.finalize.post" as const,
      postId: result.operation.postId,
      operation: {
        operationId: result.operation.operationId,
        state: result.operation.state,
        pollAfterMs: result.operation.pollAfterMs
      },
      ...(result.achievementDelta ? { achievementDelta: result.achievementDelta } : {}),
      legendRewards: {
        postId: result.operation.postId,
        viewerId: input.viewerId,
        hasRewards: false,
        earnedFirstLegends: [],
        earnedRankLegends: [],
        rankChanges: [],
        closeTargets: [],
        overtakenUsers: [],
        displayCards: []
      },
      canonicalCreated: result.canonicalCreated,
      idempotency: {
        replayed: result.idempotent
      },
      invalidation: {
        invalidatedKeysCount: 0,
        invalidationTypes: ["deferred_until_read_routes"]
      }
    };
  }
}
