import { recordIdempotencyHit, recordIdempotencyMiss } from "../../observability/request-context.js";
import type { PostsPublishService } from "../../services/mutations/posts-publish.service.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";
import { PostsDetailOrchestrator } from "../surfaces/posts-detail.orchestrator.js";

export class PostsPublishOrchestrator {
  private readonly feedService = new FeedService(new FeedRepository());
  private readonly detailOrchestrator = new PostsDetailOrchestrator(this.feedService);

  constructor(private readonly service: PostsPublishService) {}

  async stage(input: {
    viewerId: string;
    clientMutationId: string;
    title?: string;
    caption?: string;
    activities: string[];
    privacy: "Public Spot" | "Friends Spot" | "Secret Spot";
    lat?: number | null;
    long?: number | null;
    address?: string;
    tags: string[];
    assets: Array<{ assetIndex: number; assetType: "photo" | "video"; contentType?: string; destinationKey?: string }>;
  }) {
    const result = await this.service.stage(input);
    if (result.replayed) recordIdempotencyHit();
    else recordIdempotencyMiss();
    return {
      routeName: "posts.stage.post" as const,
      stage: {
        stageId: result.stage.stageId,
        viewerId: result.stage.viewerId,
        state: result.stage.state,
        createdAtMs: result.stage.createdAtMs,
        updatedAtMs: result.stage.updatedAtMs,
        expiresAtMs: result.stage.expiresAtMs
      },
      idempotency: {
        replayed: result.replayed
      }
    };
  }

  async signUpload(input: {
    viewerId: string;
    stageId: string;
    items: Array<{ assetIndex: number; assetType: "photo" | "video"; destinationKey?: string }>;
  }) {
    const result = await this.service.signUpload(input.viewerId, input.stageId, input.items);
    return {
      routeName: "posts.mediasignupload.post" as const,
      stageId: result.stage.stageId,
      urls: result.urls
    };
  }

  async completeUpload(input: {
    viewerId: string;
    stageId: string;
    items: Array<{ assetIndex: number; assetType: "photo" | "video"; objectKey?: string }>;
  }) {
    const result = await this.service.completeUpload(input.viewerId, input.stageId, input.items);
    return {
      routeName: "posts.mediacomplete.post" as const,
      stageId: result.stage.stageId,
      ready: result.missingKeys.length === 0,
      completedAssetCount: result.stage.assets.filter((asset) => asset.uploaded === true).length,
      missingKeys: result.missingKeys
    };
  }

  async publish(input: {
    viewerId: string;
    authorizationHeader: string | undefined;
    stageId: string;
    clientMutationId: string;
    title?: string;
    caption?: string;
    activities: string[];
    privacy: "Public Spot" | "Friends Spot" | "Secret Spot";
    lat?: number | null;
    long?: number | null;
    address?: string;
    tags: string[];
    texts?: unknown[];
    recordingsList?: unknown[];
  }) {
    const result = await this.service.publish(input);
    if (result.replayed) recordIdempotencyHit();
    else recordIdempotencyMiss();
    return {
      routeName: "posts.publish.post" as const,
      stageId: input.stageId,
      postId: result.postId,
      idempotency: {
        replayed: result.replayed
      },
      detail: await this.detailOrchestrator.run({
        viewerId: input.viewerId,
        postId: result.postId
      }),
      card: await this.feedService.loadPostCardSummary(input.viewerId, result.postId)
    };
  }
}
