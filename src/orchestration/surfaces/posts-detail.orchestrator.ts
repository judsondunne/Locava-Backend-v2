import { PostsDetailResponseSchema } from "../../contracts/surfaces/posts-detail.contract.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { toFeedCardDTO, toPlaybackPostShellDTO } from "../../dto/compact-surface-dto.js";
import { buildPostMediaReadiness } from "../../lib/posts/media-readiness.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import type { FeedBootstrapCandidateRecord, FeedDetailRecord } from "../../repositories/surfaces/feed.repository.js";
import { z } from "zod";

type PostsDetailResponse = z.infer<typeof PostsDetailResponseSchema>;
type SafeCardSummary = FeedBootstrapCandidateRecord & { rankToken: string };
type DeferredCommentPreview = NonNullable<PostsDetailResponse["deferred"]["commentsPreview"]>;
type DeferredCommentPreviewItem = DeferredCommentPreview[number];
type BatchItemStatus = "ready" | "partial_cached" | "processing" | "missing";

function postMediaSummaryForLog(post: Record<string, unknown>) {
  const mediaReadiness = buildPostMediaReadiness(post);
  return {
    hasVideo: mediaReadiness.hasVideo,
    mediaStatus: mediaReadiness.mediaStatus,
    playbackReady: mediaReadiness.playbackReady,
    playbackUrlPresent: mediaReadiness.playbackUrlPresent,
    fallbackVideoUrlPresent: Boolean(mediaReadiness.fallbackVideoUrl),
    posterPresent: mediaReadiness.posterPresent,
  };
}

function playbackNeedsSourceTruth(media: ReturnType<typeof buildPostMediaReadiness>): boolean {
  return !media.posterPresent && !media.playbackUrlPresent && !media.fallbackVideoUrl;
}

function toCompactPlaybackCard(summary: SafeCardSummary): ReturnType<typeof toFeedCardDTO> {
  return toFeedCardDTO({
    postId: summary.postId,
    rankToken: summary.rankToken,
    author: {
      userId: summary.author.userId,
      handle: summary.author.handle,
      name: summary.author.name,
      pic: summary.author.pic,
    },
    title: summary.title ?? null,
    captionPreview: summary.captionPreview ?? null,
    activities: summary.activities ?? [],
    address: summary.address ?? null,
    geo: summary.geo ?? null,
    assets: summary.assets ?? [],
    /** Match search/mix cards so playback shells keep all carousel assets, not a single synthetic row. */
    compactAssetLimit: 12,
    media: summary.media,
    social: summary.social,
    viewer: summary.viewer,
    createdAtMs: summary.createdAtMs,
    updatedAtMs: summary.updatedAtMs,
    firstAssetUrl: summary.firstAssetUrl ?? null,
    carouselFitWidth: summary.carouselFitWidth,
    layoutLetterbox: summary.layoutLetterbox,
    letterboxGradientTop: summary.letterboxGradientTop ?? null,
    letterboxGradientBottom: summary.letterboxGradientBottom ?? null,
    letterboxGradients: summary.letterboxGradients ?? null,
  });
}

function normalizeCommentsPreview(value: unknown): DeferredCommentPreview {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const wire = entry as Record<string, unknown>;
    const commentId = String(wire.commentId ?? wire.id ?? "").trim();
    const userId = String(wire.userId ?? "").trim();
    const text = String(wire.text ?? wire.content ?? "").trim();
    const createdAtMsRaw = wire.createdAtMs;
    const createdAtMs =
      typeof createdAtMsRaw === "number" && Number.isFinite(createdAtMsRaw)
        ? Math.max(0, Math.floor(createdAtMsRaw))
        : 0;
    if (!commentId || !userId || !text) return [];
    const item: DeferredCommentPreviewItem = {
      commentId,
      userId,
      text,
      createdAtMs,
      userName: typeof wire.userName === "string" ? wire.userName : null,
      userHandle: typeof wire.userHandle === "string" ? wire.userHandle : null,
      userPic: typeof wire.userPic === "string" ? wire.userPic : null
    };
    return [item];
  });
}

export class PostsDetailOrchestrator {
  constructor(private readonly service: FeedService) {}

  private logEvent(event: string, payload: Record<string, unknown>): void {
    try {
      console.info(`[${event}]`, payload);
    } catch {
      // best effort logging only
    }
  }

  private buildFallbackDetailFromCard(input: {
    postId: string;
    card: SafeCardSummary;
    fallbackSource: string;
    sourceOfTruthFailed: boolean;
  }): PostsDetailResponse {
    const playbackShell = toPlaybackPostShellDTO({
      userId: input.card.author.userId,
      card: toCompactPlaybackCard(input.card),
    }) as Record<string, unknown>;
    const mediaReadiness = buildPostMediaReadiness(playbackShell);
    const post = {
      ...playbackShell,
      mediaReadiness,
      mediaStatus: mediaReadiness.mediaStatus,
      posterReady: mediaReadiness.posterReady,
      posterPresent: mediaReadiness.posterPresent,
      posterUrl: mediaReadiness.posterUrl,
      playbackReady: mediaReadiness.playbackReady,
      playbackUrlPresent: mediaReadiness.playbackUrlPresent,
      playbackUrl: mediaReadiness.playbackUrl,
      fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,
      instantPlaybackReady: mediaReadiness.instantPlaybackReady,
      hasVideo: mediaReadiness.hasVideo,
      aspectRatio: mediaReadiness.aspectRatio ?? null,
      width: mediaReadiness.width ?? null,
      height: mediaReadiness.height ?? null,
      resizeMode: mediaReadiness.resizeMode,
      letterboxGradients: mediaReadiness.letterboxGradients ?? undefined,
      diagnostics: {
        source: "fallback_cached_projection",
        fallbackSource: input.fallbackSource,
        sourceOfTruthFailed: input.sourceOfTruthFailed,
      },
    };
    return {
      routeName: "posts.detail.get",
      firstRender: {
        post: post as unknown as PostsDetailResponse["firstRender"]["post"],
        author: input.card.author,
        social: input.card.social,
        viewer: input.card.viewer,
      },
      deferred: { commentsPreview: null },
      degraded: true,
      fallbacks: ["fallback_cached_projection", input.fallbackSource],
      debugHydrationSource: "cache",
      debugReads: 0,
      debugPostIds: [input.postId],
      debugMissingIds: [],
      debugDurationMs: 0,
    };
  }

  async run(input: { viewerId: string; postId: string }): Promise<PostsDetailResponse> {
    const startedAt = Date.now();
    const { viewerId, postId } = input;
    let post: FeedDetailRecord;
    let usedFallbackProjection = false;
    let fallbackSource = "";
    try {
      this.logEvent("post.detail.source_attempt", {
        postId,
        source: "source_of_truth_detail",
      });
      post = await this.service.loadPostDetail(postId, viewerId);
    } catch (error) {
      if (error instanceof SourceOfTruthRequiredError) {
        this.logEvent("post.detail.source_failure", {
          postId,
          source: "source_of_truth_detail",
          error: error.message,
          statusCode: 503,
        });
        const cachedProjection = await this.service.loadPostDetailCachedProjection(postId);
        if (cachedProjection?.source === "post_detail_cache") {
          post = cachedProjection.detail;
          usedFallbackProjection = true;
          fallbackSource = cachedProjection.source;
        } else if (cachedProjection?.source === "post_card_cache") {
          const safeCard = this.ensureSafeCardSummary(cachedProjection.card, postId);
          const fallbackDetail = this.buildFallbackDetailFromCard({
            postId,
            card: safeCard,
            fallbackSource: cachedProjection.source,
            sourceOfTruthFailed: true,
          });
          this.logEvent("post.detail.fallback_selected", {
            postId,
            source: cachedProjection.source,
            statusCode: 200,
            ...postMediaSummaryForLog(fallbackDetail.firstRender.post as Record<string, unknown>),
          });
          this.logEvent("post.detail.media_resolution_summary", {
            postId,
            source: "fallback_cached_projection",
            ...postMediaSummaryForLog(fallbackDetail.firstRender.post as Record<string, unknown>),
            statusCode: 200,
          });
          return fallbackDetail;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    const cardSummary = this.ensureSafeCardSummary(
      post.cardSummary ?? (await this.service.loadPostCardSummary(viewerId, postId)),
      postId,
      post
    );
    const author = cardSummary.author;
    const social = cardSummary.social;
    const viewer = cardSummary.viewer;
    const commentsPreview =
      Array.isArray(post.commentsPreview)
        ? normalizeCommentsPreview(post.commentsPreview)
        : await this.service.loadCommentsPreview(postId, 0).catch(() => null);
    const mediaReadiness = buildPostMediaReadiness(post as Record<string, unknown>);
    console.info("[post.detail.media_readiness]", {
      surface: "posts.detail",
      postId,
      ...mediaReadiness
    });
    this.logEvent("post.detail.media_resolution_summary", {
      postId,
      source: usedFallbackProjection ? "fallback_cached_projection" : "source_of_truth_detail",
      fallbackSource: usedFallbackProjection ? fallbackSource : undefined,
      ...postMediaSummaryForLog(post as Record<string, unknown>),
      statusCode: 200,
    });
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
          geoData: post.geoData,
          coordinates: post.coordinates,
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
          updatedAtMs: (post as { updatedAtMs?: number }).updatedAtMs,
          mediaType: post.mediaType,
          thumbUrl: post.thumbUrl,
          assetsReady: (post as { assetsReady?: boolean }).assetsReady,
          mediaReadiness,
          mediaStatus: mediaReadiness.mediaStatus,
          videoProcessingStatus: mediaReadiness.videoProcessingStatus,
          posterReady: mediaReadiness.posterReady,
          posterPresent: mediaReadiness.posterPresent,
          posterUrl: mediaReadiness.posterUrl,
          playbackReady: mediaReadiness.playbackReady,
          playbackUrlPresent: mediaReadiness.playbackUrlPresent,
          playbackUrl: mediaReadiness.playbackUrl,
          fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,
          instantPlaybackReady: mediaReadiness.instantPlaybackReady,
          playbackLab: (post as { playbackLab?: Record<string, unknown> }).playbackLab,
          assetLocations: (post as { assetLocations?: Array<Record<string, unknown>> }).assetLocations,
          hasVideo: mediaReadiness.hasVideo,
          aspectRatio: mediaReadiness.aspectRatio ?? null,
          width: mediaReadiness.width ?? null,
          height: mediaReadiness.height ?? null,
          resizeMode: mediaReadiness.resizeMode,
          assets: post.assets,
          diagnostics: usedFallbackProjection
            ? {
                source: "fallback_cached_projection",
                fallbackSource,
                sourceOfTruthFailed: true,
              }
            : undefined,
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
      deferred: { commentsPreview },
      degraded: false,
      fallbacks: usedFallbackProjection ? ["fallback_cached_projection", fallbackSource] : [],
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
    debugPayloadBytes?: number;
    debugPostIds: string[];
    debugMissingIds: string[];
    debugDurationMs: number;
    itemStatuses?: Array<{ postId: string; status: BatchItemStatus; selectedSource: string }>;
  }> {
    const startedAt = Date.now();
    const ordered = input.postIds.map((id) => id.trim()).filter(Boolean);
    const unique = [...new Set(ordered)];
    if (input.hydrationMode === "card" || input.hydrationMode === "playback") {
      return this.runBatchLightweight(
        {
          viewerId: input.viewerId,
          postIds: input.postIds,
          reason: input.reason,
          hydrationMode: input.hydrationMode
        },
        unique,
        startedAt
      );
    }
    const found: Array<{ postId: string; detail: PostsDetailResponse }> = [];
    const missing: string[] = [];
    const itemStatuses: Array<{ postId: string; status: BatchItemStatus; selectedSource: string }> = [];
    const skipped: string[] = [];
    let entityConstructionCount = 0;
    for (const postId of unique) {
      try {
        const detail = await dedupeInFlight(
          `posts-detail-batch:${input.viewerId}:${postId}:${input.hydrationMode}`,
          () => this.runHydrated({ viewerId: input.viewerId, postId, hydrationMode: input.hydrationMode })
        );
        found.push({ postId, detail });
        const mediaReadiness = buildPostMediaReadiness(detail.firstRender.post as Record<string, unknown>);
        itemStatuses.push({
          postId,
          status: mediaReadiness.mediaStatus === "ready" ? "ready" : "processing",
          selectedSource: detail.degraded ? "partial_cached" : "source_of_truth",
        });
        entityConstructionCount += this.estimateEntityConstructionCount(detail);
      } catch (error) {
        if (error instanceof Error && error.message === "feed_post_not_found") {
          missing.push(postId);
          itemStatuses.push({ postId, status: "missing", selectedSource: "not_found" });
          continue;
        }
        if (error instanceof SourceOfTruthRequiredError) {
          const cachedProjection = await this.service.loadPostDetailCachedProjection(postId);
          if (cachedProjection?.source === "post_detail_cache") {
            const mediaReadiness = buildPostMediaReadiness(cachedProjection.detail as Record<string, unknown>);
            const safeCard = this.ensureSafeCardSummary(
              cachedProjection.detail.cardSummary ??
                (await this.service.loadPostCardSummary(input.viewerId, postId).catch(() => undefined as never)),
              postId,
              cachedProjection.detail
            );
            const partialDetail: PostsDetailResponse = {
              routeName: "posts.detail.get",
              firstRender: {
                post: {
                  ...cachedProjection.detail,
                  mediaReadiness,
                  mediaStatus: mediaReadiness.mediaStatus,
                  posterReady: mediaReadiness.posterReady,
                  posterPresent: mediaReadiness.posterPresent,
                  posterUrl: mediaReadiness.posterUrl,
                  playbackReady: mediaReadiness.playbackReady,
                  playbackUrlPresent: mediaReadiness.playbackUrlPresent,
                  playbackUrl: mediaReadiness.playbackUrl,
                  fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,
                  hasVideo: mediaReadiness.hasVideo,
                  aspectRatio: mediaReadiness.aspectRatio ?? null,
                  width: mediaReadiness.width ?? null,
                  height: mediaReadiness.height ?? null,
                  resizeMode: mediaReadiness.resizeMode,
                } as PostsDetailResponse["firstRender"]["post"],
                author: safeCard.author,
                social: safeCard.social,
                viewer: safeCard.viewer,
              },
              deferred: { commentsPreview: null },
              degraded: true,
              fallbacks: ["fallback_cached_projection", cachedProjection.source],
              debugHydrationSource: "cache",
              debugReads: 0,
              debugPostIds: [postId],
              debugMissingIds: [],
              debugDurationMs: 0,
            };
            found.push({ postId, detail: partialDetail });
            itemStatuses.push({ postId, status: "partial_cached", selectedSource: cachedProjection.source });
            continue;
          }
          if (cachedProjection?.source === "post_card_cache") {
            const safeCard = this.ensureSafeCardSummary(cachedProjection.card, postId);
            const partial = this.buildFallbackDetailFromCard({
              postId,
              card: safeCard,
              fallbackSource: cachedProjection.source,
              sourceOfTruthFailed: true,
            });
            found.push({ postId, detail: partial });
            itemStatuses.push({ postId, status: "partial_cached", selectedSource: cachedProjection.source });
            continue;
          }
          missing.push(postId);
          itemStatuses.push({ postId, status: "missing", selectedSource: "source_of_truth_unavailable" });
          continue;
        }
        skipped.push(postId);
        itemStatuses.push({ postId, status: "missing", selectedSource: "unexpected_error" });
      }
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(found), "utf8");
    this.logEvent("posts.batch.media_resolution_summary", {
      hydrationMode: input.hydrationMode,
      statuses: itemStatuses,
      mediaSummary: found.map((row) => {
        const summary = postMediaSummaryForLog(row.detail.firstRender.post as Record<string, unknown>);
        return {
          postId: row.postId,
          status:
            summary.mediaStatus === "ready"
              ? "ready"
              : row.detail.degraded
                ? "partial_cached"
                : "processing",
          selectedSource: row.detail.degraded ? "partial_cached" : "source_of_truth",
          playbackUrlPresent: summary.playbackUrlPresent,
          fallbackVideoUrlPresent: summary.fallbackVideoUrlPresent,
          posterPresent: summary.posterPresent,
        };
      }),
    });
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
      debugPayloadBytes: payloadBytes,
      debugPostIds: unique,
      debugMissingIds: [...missing, ...skipped],
      debugDurationMs: Date.now() - startedAt,
      itemStatuses
    };
  }

  private async runBatchLightweight(
    input: {
      viewerId: string;
      postIds: string[];
      reason: "prefetch" | "open" | "surface_bootstrap" | "presentation_hints";
      hydrationMode: "card" | "playback";
    },
    unique: string[],
    startedAt: number
  ): Promise<{
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
    debugPayloadBytes?: number;
    debugPostIds: string[];
    debugMissingIds: string[];
    debugDurationMs: number;
    itemStatuses?: Array<{ postId: string; status: BatchItemStatus; selectedSource: string }>;
  }> {
    const MAX_BATCH = input.hydrationMode === "playback" ? 5 : 15;
    const cappedIds = unique.slice(0, MAX_BATCH);
    const missingFromCap = unique.slice(MAX_BATCH);
    const serviceWithBatch = this.service as FeedService & {
      loadPostCardSummaryBatch?: (viewerId: string, postIds: string[]) => Promise<FeedBootstrapCandidateRecord[]>;
      loadPostCardSummaryBatchLightweight?: (viewerId: string, postIds: string[]) => Promise<FeedBootstrapCandidateRecord[]>;
    };
    const cards =
      typeof serviceWithBatch.loadPostCardSummaryBatchLightweight === "function"
        ? await serviceWithBatch.loadPostCardSummaryBatchLightweight(input.viewerId, cappedIds)
        : typeof serviceWithBatch.loadPostCardSummaryBatch === "function"
          ? await serviceWithBatch.loadPostCardSummaryBatch(input.viewerId, cappedIds)
        : (
            await Promise.all(
              cappedIds.map((postId) =>
                this.service.loadPostCardSummary(input.viewerId, postId).catch(() => null)
              )
            )
          ).filter((row): row is FeedBootstrapCandidateRecord => row !== null);
    const byId = new Map(cards.map((card) => [card.postId, this.ensureSafeCardSummary(card, card.postId)] as const));
    const found: Array<{ postId: string; detail: PostsDetailResponse }> = [];
    for (const postId of cappedIds) {
      const card = byId.get(postId);
      if (!card) continue;
      let playbackShell = toPlaybackPostShellDTO({
        userId: card.author.userId,
        card: toCompactPlaybackCard(card),
      });
      let mediaReadiness = buildPostMediaReadiness(playbackShell as Record<string, unknown>);
      let degraded = false;
      let fallbacks: string[] = [];
      let debugHydrationSource: "cache" | "mixed" = "cache";
      if (input.hydrationMode === "playback" && playbackNeedsSourceTruth(mediaReadiness)) {
        try {
          const detail = await this.service.loadPostDetail(postId, input.viewerId);
          const cardSummaryRaw =
            (detail as { cardSummary?: FeedBootstrapCandidateRecord }).cardSummary ??
            (await this.service.loadPostCardSummary(input.viewerId, postId));
          const safeCard = this.ensureSafeCardSummary(cardSummaryRaw, postId, detail);
          playbackShell = toPlaybackPostShellDTO({
            userId: safeCard.author.userId,
            card: toCompactPlaybackCard(safeCard),
          });
          mediaReadiness = buildPostMediaReadiness(playbackShell as Record<string, unknown>);
          degraded = playbackNeedsSourceTruth(mediaReadiness);
          if (degraded) {
            fallbacks = ["post_card_cache_incomplete", "source_truth_still_missing_media"];
            if (process.env.NODE_ENV !== "production") {
              (playbackShell as Record<string, unknown>).mediaStatus = "missing_source_media";
            }
          } else {
            fallbacks = ["post_card_cache_incomplete"];
            debugHydrationSource = "mixed";
          }
        } catch {
          // Keep lightweight cache projection; client may retry open hydration.
        }
      }
      found.push({
        postId: card.postId,
        detail: {
          routeName: "posts.detail.get" as const,
          firstRender: {
            post: {
              ...playbackShell,
              mediaReadiness,
              mediaStatus: mediaReadiness.mediaStatus,
              posterReady: mediaReadiness.posterReady,
              posterPresent: mediaReadiness.posterPresent,
              posterUrl: mediaReadiness.posterUrl,
              playbackReady: mediaReadiness.playbackReady,
              playbackUrlPresent: mediaReadiness.playbackUrlPresent,
              playbackUrl: mediaReadiness.playbackUrl,
              fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,
              hasVideo: mediaReadiness.hasVideo,
              aspectRatio: mediaReadiness.aspectRatio ?? null,
              width: mediaReadiness.width ?? null,
              height: mediaReadiness.height ?? null,
              resizeMode: mediaReadiness.resizeMode,
            } as PostsDetailResponse["firstRender"]["post"],
            author: card.author,
            social: card.social,
            viewer: card.viewer,
          },
          deferred: { commentsPreview: null },
          degraded,
          fallbacks,
          debugHydrationSource,
          debugReads: 0,
          debugPostIds: [card.postId],
          debugMissingIds: [],
          debugDurationMs: 0,
        },
      });
    }
    const missing = cappedIds.filter((id) => !byId.has(id)).concat(missingFromCap);
    const foundById = new Map(found.map((row) => [row.postId, row.detail] as const));
    const itemStatuses = cappedIds.map((postId) => {
      const has = byId.has(postId);
      if (!has) {
        return { postId, status: "missing" as BatchItemStatus, selectedSource: "missing" };
      }
      const detail = foundById.get(postId);
      const upgraded = detail?.debugHydrationSource === "mixed";
      return {
        postId,
        status: "partial_cached" as BatchItemStatus,
        selectedSource: upgraded ? "post_card_cache_upgraded" : "post_card_cache",
      };
    });
    const payloadBytes = Buffer.byteLength(JSON.stringify(found), "utf8");
    this.logEvent("posts.batch.media_resolution_summary", {
      hydrationMode: input.hydrationMode,
      statuses: itemStatuses,
      mediaSummary: found.map((row) => {
        const summary = postMediaSummaryForLog(row.detail.firstRender.post as Record<string, unknown>);
        const upgraded = row.detail.debugHydrationSource === "mixed";
        return {
          postId: row.postId,
          status: summary.mediaStatus === "ready" ? "ready" : "partial_cached",
          selectedSource: upgraded ? "post_card_cache_upgraded" : "post_card_cache",
          playbackUrlPresent: summary.playbackUrlPresent,
          fallbackVideoUrlPresent: summary.fallbackVideoUrlPresent,
          posterPresent: summary.posterPresent,
        };
      }),
    });
    return {
      routeName: "posts.detail.batch",
      reason: input.reason,
      hydrationMode: input.hydrationMode,
      found,
      missing,
      forbidden: [],
      debugHydrationSource: "cache",
      debugReads: 0,
      debugEntityConstructionCount: found.length,
      debugPayloadCategory: classifyPayloadCategory(found.length, input.hydrationMode),
      debugPayloadBytes: payloadBytes,
      debugPostIds: unique,
      debugMissingIds: missing,
      debugDurationMs: Date.now() - startedAt,
      itemStatuses
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
    if (input.hydrationMode === "open" || input.hydrationMode === "full") {
      const commentsPreview =
        Array.isArray(detail.commentsPreview)
          ? normalizeCommentsPreview(detail.commentsPreview)
          : await this.service.loadCommentsPreview(input.postId, 0).catch(() => null);
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
