import { PostsDetailResponseSchema } from "../../contracts/surfaces/posts-detail.contract.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import type { FeedBootstrapCandidateRecord, FeedDetailRecord } from "../../repositories/surfaces/feed.repository.js";
import { z } from "zod";

type PostsDetailResponse = z.infer<typeof PostsDetailResponseSchema>;
type SafeCardSummary = FeedBootstrapCandidateRecord & { rankToken: string };

export class PostsDetailOrchestrator {
  constructor(private readonly service: FeedService) {}

  async run(input: { viewerId: string; postId: string }): Promise<PostsDetailResponse> {
    const startedAt = Date.now();
    const { viewerId, postId } = input;
    const [cardSummary, post] = await Promise.all([
      this.service.loadPostCardSummary(viewerId, postId),
      this.service.loadPostDetail(postId, viewerId)
    ]);
    const author = cardSummary.author;
    const social = cardSummary.social;
    const viewer = cardSummary.viewer;
    void this.service.loadCommentsPreview(postId, 0).catch(() => undefined);
    return {
      routeName: "posts.detail.get",
      firstRender: {
        post: {
          postId: post.postId,
          userId: post.userId,
          caption: post.caption,
          title: post.title ?? null,
          description: post.description ?? null,
          activities: post.activities ?? [],
          address: post.address ?? null,
          lat: post.lat ?? null,
          lng: post.lng ?? null,
          carouselFitWidth: post.carouselFitWidth,
          layoutLetterbox: post.layoutLetterbox,
          letterboxGradientTop: post.letterboxGradientTop ?? null,
          letterboxGradientBottom: post.letterboxGradientBottom ?? null,
          letterboxGradients: post.letterboxGradients ?? undefined,
          location: {
            address: post.address ?? null,
            lat: post.lat ?? null,
            lng: post.lng ?? null
          },
          mentions: post.mentions ?? [],
          tags: post.tags ?? [],
          visibility: post.visibility,
          deleted: post.deleted,
          blocked: post.blocked,
          createdAtMs: post.createdAtMs,
          mediaType: post.mediaType,
          thumbUrl: post.thumbUrl,
          assets: post.assets,
          cardSummary: {
            ...cardSummary,
            rankToken: `rank-${viewerId.slice(0, 6)}-post-detail-${postId}`,
            captionPreview: post.caption,
            media: {
              type: post.mediaType,
              posterUrl: post.thumbUrl,
              aspectRatio: 9 / 16,
              startupHint: post.mediaType === "video" ? "poster_then_preview" : "poster_only"
            },
            author,
            social,
            viewer,
            updatedAtMs: post.createdAtMs
          }
        },
        author,
        social,
        viewer: {
          ...viewer,
          viewerFollowsCreator:
            "viewerFollowsCreator" in viewer
              ? Boolean((viewer as { viewerFollowsCreator?: unknown }).viewerFollowsCreator)
              : undefined
        }
      },
      deferred: { commentsPreview: null },
      degraded: false,
      fallbacks: [],
      debugHydrationSource: "mixed",
      debugReads: 0,
      debugPostIds: [postId],
      debugMissingIds: [],
      debugDurationMs: Date.now() - startedAt
    };
  }

  async runBatch(input: {
    viewerId: string;
    postIds: string[];
    reason: "prefetch" | "open" | "surface_bootstrap" | "presentation_hints";
    hydrationMode: "card" | "playback" | "open" | "full";
  }): Promise<{
    routeName: "posts.detail.batch";
    reason: "prefetch" | "open" | "surface_bootstrap" | "presentation_hints";
    hydrationMode: "card" | "playback" | "open" | "full";
    found: Array<{ postId: string; detail: PostsDetailResponse }>;
    missing: string[];
    forbidden: string[];
    debugHydrationSource: "cache" | "firestore" | "mixed";
    debugReads: number;
    debugEntityConstructionCount: number;
    debugPayloadCategory: "tiny" | "small" | "medium" | "heavy";
    debugPostIds: string[];
    debugMissingIds: string[];
    debugDurationMs: number;
  }> {
    const startedAt = Date.now();
    const ordered = input.postIds.map((id) => id.trim()).filter(Boolean);
    const unique = [...new Set(ordered)];
    const found: Array<{ postId: string; detail: PostsDetailResponse }> = [];
    const missing: string[] = [];
    const skipped: string[] = [];
    let entityConstructionCount = 0;
    for (const postId of unique) {
      try {
        const detail = await dedupeInFlight(
          `posts-detail-batch:${input.viewerId}:${postId}:${input.hydrationMode}`,
          () => this.runHydrated({ viewerId: input.viewerId, postId, hydrationMode: input.hydrationMode })
        );
        found.push({ postId, detail });
        entityConstructionCount += this.estimateEntityConstructionCount(detail);
      } catch (error) {
        if (error instanceof Error && error.message === "feed_post_not_found") {
          missing.push(postId);
          continue;
        }
        if (error instanceof SourceOfTruthRequiredError) {
          missing.push(postId);
          continue;
        }
        skipped.push(postId);
      }
    }
    return {
      routeName: "posts.detail.batch",
      reason: input.reason,
      hydrationMode: input.hydrationMode,
      found,
      missing,
      forbidden: [],
      debugHydrationSource: "mixed",
      debugReads: 0,
      debugEntityConstructionCount: entityConstructionCount,
      debugPayloadCategory: classifyPayloadCategory(found.length, input.hydrationMode),
      debugPostIds: unique,
      debugMissingIds: [...missing, ...skipped],
      debugDurationMs: Date.now() - startedAt
    };
  }

  private async runHydrated(input: {
    viewerId: string;
    postId: string;
    hydrationMode: "card" | "playback" | "open" | "full";
  }): Promise<PostsDetailResponse> {
    if (input.hydrationMode === "card") {
      const cardSummary: SafeCardSummary = this.ensureSafeCardSummary(
        await this.service.loadPostCardSummary(input.viewerId, input.postId),
        input.postId
      );
      return {
        routeName: "posts.detail.get",
        firstRender: {
          post: {
            postId: cardSummary.postId,
            userId: cardSummary.author.userId,
            caption: cardSummary.captionPreview,
            createdAtMs: cardSummary.createdAtMs,
            mediaType: cardSummary.media.type,
            thumbUrl: cardSummary.media.posterUrl,
            assets: [],
            cardSummary
          },
          author: cardSummary.author,
          social: cardSummary.social,
          viewer: cardSummary.viewer
        },
        deferred: { commentsPreview: null },
        degraded: false,
        fallbacks: [],
        debugHydrationSource: "cache",
        debugReads: 0,
        debugPostIds: [input.postId],
        debugMissingIds: [],
        debugDurationMs: 0
      };
    }

    const detail = await this.service.loadPostDetail(input.postId, input.viewerId);
    const cardSummaryRaw =
      (detail as { cardSummary?: FeedBootstrapCandidateRecord }).cardSummary ??
      (await this.service.loadPostCardSummary(input.viewerId, input.postId));
    const cardSummary: SafeCardSummary = this.ensureSafeCardSummary(cardSummaryRaw, input.postId, detail);
    const compatibilityDetail = {
      ...detail,
      cardSummary,
      mediaType: detail.mediaType ?? cardSummary.media.type,
      thumbUrl: detail.thumbUrl ?? cardSummary.media.posterUrl,
      assets: Array.isArray(detail.assets) && detail.assets.length > 0 ? detail.assets : [],
      letterboxGradients: Array.isArray(detail.letterboxGradients) ? detail.letterboxGradients : undefined
    };
    if (input.hydrationMode === "full") {
      const commentsPreview = await this.service.loadCommentsPreview(input.postId, 0).catch(() => null);
      return {
        routeName: "posts.detail.get",
        firstRender: {
          post: compatibilityDetail,
          author: cardSummary.author,
          social: cardSummary.social,
          viewer: cardSummary.viewer
        },
        deferred: { commentsPreview },
        degraded: false,
        fallbacks: [],
        debugHydrationSource: "mixed",
        debugReads: 0,
        debugPostIds: [input.postId],
        debugMissingIds: [],
        debugDurationMs: 0
      };
    }

    return {
      routeName: "posts.detail.get",
      firstRender: {
        post: compatibilityDetail,
        author: cardSummary.author,
        social: cardSummary.social,
        viewer: cardSummary.viewer
      },
      deferred: { commentsPreview: null },
      degraded: false,
      fallbacks: [],
      debugHydrationSource: "cache",
      debugReads: 0,
      debugPostIds: [input.postId],
      debugMissingIds: [],
      debugDurationMs: 0
    };
  }

  private estimateEntityConstructionCount(detail: PostsDetailResponse): number {
    const hasAssets = detail.firstRender.post.assets.length > 0;
    return hasAssets ? 2 : 1;
  }

  private ensureSafeCardSummary(
    summary: FeedBootstrapCandidateRecord,
    postId: string,
    detail?: FeedDetailRecord
  ): SafeCardSummary {
    const fallbackUserId = String(detail?.userId ?? summary?.author?.userId ?? `unknown-author:${postId}`);
    const fallbackHandle =
      summary?.author?.handle?.trim() || fallbackUserId.replace(/^unknown-author:/, "").replace(/^@+/, "") || "unknown";
    const fallbackMediaType: "image" | "video" = detail?.mediaType ?? summary?.media?.type ?? "image";
    const fallbackPoster = String(detail?.thumbUrl ?? summary?.media?.posterUrl ?? "");
    return {
      ...summary,
      postId: String(summary?.postId ?? postId),
      author: {
        userId: fallbackUserId,
        handle: fallbackHandle,
        name: summary?.author?.name ?? null,
        pic: summary?.author?.pic ?? null
      },
      media: {
        type: fallbackMediaType,
        posterUrl: fallbackPoster,
        aspectRatio: summary?.media?.aspectRatio ?? 9 / 16,
        startupHint:
          summary?.media?.startupHint ??
          (fallbackMediaType === "video" ? "poster_then_preview" : "poster_only")
      },
      social: {
        likeCount: summary?.social?.likeCount ?? 0,
        commentCount: summary?.social?.commentCount ?? 0
      },
      viewer: {
        liked: summary?.viewer?.liked ?? false,
        saved: summary?.viewer?.saved ?? false
      },
      rankToken: (summary as { rankToken?: string } | undefined)?.rankToken ?? `rank-${postId}`
    } as SafeCardSummary;
  }
}

function classifyPayloadCategory(
  count: number,
  hydrationMode: "card" | "playback" | "open" | "full"
): "tiny" | "small" | "medium" | "heavy" {
  if (hydrationMode === "card") return "tiny";
  if (hydrationMode === "playback") return "small";
  if (hydrationMode === "open") return count <= 2 ? "small" : "medium";
  return "heavy";
}
