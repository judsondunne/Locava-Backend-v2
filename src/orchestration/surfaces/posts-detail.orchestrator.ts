import { PostsDetailResponseSchema } from "../../contracts/surfaces/posts-detail.contract.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import {
  toFeedCardDTO,
  toPlaybackPostShellDTO,
  type PlaybackPostShellDTO,
} from "../../dto/compact-surface-dto.js";
import { buildPostMediaReadiness } from "../../lib/posts/media-readiness.js";
import {
  playbackBatchCarouselIncompleteMedia,
  playbackBatchShouldFetchFirestoreDetail,
  selectBestVideoPlaybackAsset,
} from "../../lib/posts/video-playback-selection.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import type { FeedBootstrapCandidateRecord, FeedDetailRecord } from "../../repositories/surfaces/feed.repository.js";
import { z } from "zod";

type PostsDetailResponse = z.infer<typeof PostsDetailResponseSchema>;
type SafeCardSummary = FeedBootstrapCandidateRecord & { rankToken: string };
type DeferredCommentPreview = NonNullable<PostsDetailResponse["deferred"]["commentsPreview"]>;
type DeferredCommentPreviewItem = DeferredCommentPreview[number];
type BatchItemStatus = "ready" | "partial_cached" | "processing" | "missing";

function postMediaSummaryForLog(
  post: Record<string, unknown>,
  opts?: { hydrationMode?: "card" | "playback" | "detail" | "open" | "full" },
) {
  const hydrationMode = opts?.hydrationMode ?? "detail";
  const mediaReadiness = buildPostMediaReadiness(post, { hydrationMode });
  const compactDiag =
    process.env.NODE_ENV !== "production"
      ? {
          selectedVideoVariant: mediaReadiness.selectedVideoVariant,
          isDegradedVideo: Boolean(mediaReadiness.isDegradedVideo),
          processingButPlayable: Boolean(mediaReadiness.processingButPlayable),
        }
      : {};
  return {
    hasVideo: mediaReadiness.hasVideo,
    mediaStatus: mediaReadiness.mediaStatus,
    playbackReady: mediaReadiness.playbackReady,
    playbackUrlPresent: mediaReadiness.playbackUrlPresent,
    fallbackVideoUrlPresent: Boolean(mediaReadiness.fallbackVideoUrl),
    posterPresent: mediaReadiness.posterPresent,
    ...compactDiag,
  };
}

function videoPlaybackDebugEnabled(): boolean {
  return process.env.LOCAVA_VIDEO_MEDIA_DEBUG === "1";
}

function mergePlaybackShellFromDetailRecord(detail: FeedDetailRecord, card: SafeCardSummary): PlaybackPostShellDTO {
  const base = toPlaybackPostShellDTO({
    userId: card.author.userId,
    card: toCompactPlaybackCard(card),
  });
  if (!Array.isArray(detail.assets) || detail.assets.length === 0) {
    return {
      ...base,
      userId: detail.userId,
      thumbUrl: detail.thumbUrl || base.thumbUrl,
      caption: detail.caption ?? base.caption,
      mediaType: detail.mediaType,
      assetsReady: detail.assetsReady ?? base.assetsReady,
    };
  }
  const shellAssets: PlaybackPostShellDTO["assets"] = detail.assets.map((row, index) => ({
    id: row.id ?? `${detail.postId}-asset-${index + 1}`,
    type: row.type,
    original: row.original ?? null,
    poster: row.poster ?? null,
    thumbnail: row.thumbnail ?? null,
    aspectRatio: row.aspectRatio ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    orientation: row.orientation ?? undefined,
    variants: row.variants && typeof row.variants === "object" ? { ...(row.variants as Record<string, unknown>) } : {},
  }));
  return {
    ...base,
    userId: detail.userId,
    caption: detail.caption ?? base.caption,
    thumbUrl: detail.thumbUrl || base.thumbUrl,
    mediaType: detail.mediaType,
    assetsReady: detail.assetsReady ?? false,
    updatedAtMs: (detail as { updatedAtMs?: number }).updatedAtMs ?? card.updatedAtMs,
    assets: shellAssets,
    cardSummary: toCompactPlaybackCard(card),
  };
}

function toCompactPlaybackCard(summary: SafeCardSummary): ReturnType<typeof toFeedCardDTO> {
  const sx = summary as SafeCardSummary & {
    assetsReady?: boolean;
    mediaStatus?: "processing" | "ready" | "failed";
    posterReady?: boolean;
    playbackReady?: boolean;
    playbackUrlPresent?: boolean;
    playbackUrl?: string | null;
    fallbackVideoUrl?: string | null;
    posterUrl?: string | null;
    hasVideo?: boolean;
  };
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
    ...(typeof sx.mediaStatus === "string" ? { mediaStatus: sx.mediaStatus } : {}),
    ...(typeof sx.assetsReady === "boolean" ? { assetsReady: sx.assetsReady } : {}),
    ...(typeof sx.posterReady === "boolean" ? { posterReady: sx.posterReady } : {}),
    ...(typeof sx.playbackReady === "boolean" ? { playbackReady: sx.playbackReady } : {}),
    ...(typeof sx.playbackUrlPresent === "boolean" ? { playbackUrlPresent: sx.playbackUrlPresent } : {}),
    ...(typeof sx.playbackUrl === "string" ? { playbackUrl: sx.playbackUrl } : {}),
    ...(typeof sx.fallbackVideoUrl === "string" ? { fallbackVideoUrl: sx.fallbackVideoUrl } : {}),
    ...(typeof sx.posterUrl === "string" ? { posterUrl: sx.posterUrl } : {}),
    ...(typeof sx.hasVideo === "boolean" ? { hasVideo: sx.hasVideo } : {}),
    ...(typeof (summary as Record<string, unknown>).assetCount === "number"
      ? { assetCount: (summary as Record<string, unknown>).assetCount as number }
      : {}),
    ...(typeof (summary as Record<string, unknown>).hasMultipleAssets === "boolean"
      ? { hasMultipleAssets: (summary as Record<string, unknown>).hasMultipleAssets as boolean }
      : {}),
    ...(typeof (summary as Record<string, unknown>).photoLink === "string"
      ? { photoLink: (summary as Record<string, unknown>).photoLink as string }
      : {}),
    ...(typeof (summary as Record<string, unknown>).displayPhotoLink === "string"
      ? { displayPhotoLink: (summary as Record<string, unknown>).displayPhotoLink as string }
      : {}),
    ...(typeof (summary as Record<string, unknown>).rawFirestoreAssetCount === "number"
      ? { rawFirestoreAssetCount: (summary as Record<string, unknown>).rawFirestoreAssetCount as number }
      : {}),
    ...((summary as Record<string, unknown>).mediaCompleteness === "cover_only"
      ? { mediaCompleteness: "cover_only" as const }
      : {}),
    ...((summary as Record<string, unknown>).requiresAssetHydration === true
      ? { requiresAssetHydration: true as const }
      : {}),
  });
}

function enrichPlaybackShellRecordForCarouselProbe(shell: PlaybackPostShellDTO, card: SafeCardSummary): Record<string, unknown> {
  const out = { ...(shell as Record<string, unknown>) };
  const cardRec = card as Record<string, unknown>;
  for (const key of [
    "photoLink",
    "displayPhotoLink",
    "assetCount",
    "hasMultipleAssets",
    "rawFirestoreAssetCount",
    "requiresAssetHydration",
    "mediaCompleteness",
    "assetLocations",
    "legacy",
  ] as const) {
    if (out[key] == null && cardRec[key] != null) out[key] = cardRec[key];
  }
  return out;
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
  private static readonly playbackCacheDecisionSample = new Map<string, number>();

  constructor(private readonly service: FeedService) {}

  private logEvent(event: string, payload: Record<string, unknown>): void {
    try {
      console.info(`[${event}]`, payload);
    } catch {
      // best effort logging only
    }
  }

  private shouldLogPlaybackCacheDecision(input: {
    postId: string;
    selectedSource: string;
    sourceUpgradeUsed: boolean;
    upgradeSkippedReason: string | null;
  }): boolean {
    if (process.env.LOCAVA_POST_DETAILS_VERBOSE_CACHE_DECISIONS === "1") return true;
    if (input.sourceUpgradeUsed) return true;
    if (input.upgradeSkippedReason && input.upgradeSkippedReason !== "playback_cache_sufficient") return true;
    const now = Date.now();
    const key = `${input.postId}:${input.selectedSource}:${input.upgradeSkippedReason ?? "none"}`;
    const last = PostsDetailOrchestrator.playbackCacheDecisionSample.get(key) ?? 0;
    if (now - last < 10_000) return false;
    PostsDetailOrchestrator.playbackCacheDecisionSample.set(key, now);
    return true;
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
    const mediaReadiness = buildPostMediaReadiness(playbackShell, { hydrationMode: "playback" });
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
            ...postMediaSummaryForLog(fallbackDetail.firstRender.post as Record<string, unknown>, {
              hydrationMode: "playback",
            }),
          });
          this.logEvent("post.detail.media_resolution_summary", {
            postId,
            source: "fallback_cached_projection",
            ...postMediaSummaryForLog(fallbackDetail.firstRender.post as Record<string, unknown>, {
              hydrationMode: "playback",
            }),
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
    const mediaReadiness = buildPostMediaReadiness(post as Record<string, unknown>, { hydrationMode: "detail" });
    const resolutionSummary =
      typeof process.env.NODE_ENV === "string" && process.env.NODE_ENV !== "production"
        ? {
            ...mediaReadiness,
            selectedPlaybackUrlPresent: Boolean(mediaReadiness.playbackUrl),
            processingButPlayable: Boolean(mediaReadiness.processingButPlayable),
          }
        : mediaReadiness;
    console.info("[post.detail.media_readiness]", {
      surface: "posts.detail",
      postId,
      ...resolutionSummary,
    });
    this.logEvent("post.detail.media_resolution_summary", {
      postId,
      source: usedFallbackProjection ? "fallback_cached_projection" : "source_of_truth_detail",
      fallbackSource: usedFallbackProjection ? fallbackSource : undefined,
      ...(process.env.NODE_ENV !== "production"
        ? {
            ...postMediaSummaryForLog(post as Record<string, unknown>, { hydrationMode: "detail" }),
            selectedPlaybackUrlPresent: Boolean(mediaReadiness.playbackUrl),
            fallbackVideoUrlPresent: Boolean(mediaReadiness.fallbackVideoUrl),
            productionPlaybackSelected: Boolean(mediaReadiness.productionPlaybackSelected),
            processingButPlayable: Boolean(mediaReadiness.processingButPlayable),
          }
        : postMediaSummaryForLog(post as Record<string, unknown>, { hydrationMode: "detail" })),
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
    surface?: string | null;
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
          hydrationMode: input.hydrationMode,
          surface: input.surface ?? null,
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
            if (input.hydrationMode === "open" || input.hydrationMode === "full") {
              this.logEvent("PostDetailCacheRejectedForViewer", {
                postId,
                hydrationMode: input.hydrationMode,
                source: "post_card_cache"
              });
              missing.push(postId);
              itemStatuses.push({
                postId,
                status: "missing",
                selectedSource: "post_card_cache_rejected_open_hydration"
              });
              continue;
            }
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
        const summary = postMediaSummaryForLog(row.detail.firstRender.post as Record<string, unknown>, {
          hydrationMode: input.hydrationMode === "playback" ? "playback" : "detail",
        });
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
      surface?: string | null;
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
    const readCapParsed = Number(process.env.LOCAVA_BATCH_PLAYBACK_SOURCE_READ_CAP ?? "3");
    const basePlaybackFirestoreReadCap =
      Number.isFinite(readCapParsed) ? Math.min(32, Math.max(0, Math.floor(readCapParsed))) : 3;
    const playbackFirestoreReadCap =
      input.reason === "prefetch" && input.surface === "collection_detail"
        ? Math.min(basePlaybackFirestoreReadCap, 1)
        : basePlaybackFirestoreReadCap;
    let playbackFirestoreReadsPerformed = 0;

    const byId = new Map(cards.map((card) => [card.postId, this.ensureSafeCardSummary(card, card.postId)] as const));
    const visibleHeadSlotsRaw = Number(process.env.LOCAVA_BATCH_VISIBLE_HEAD_SLOTS ?? "8");
    const visibleHeadSlots = Number.isFinite(visibleHeadSlotsRaw) ? Math.min(32, Math.max(1, Math.floor(visibleHeadSlotsRaw))) : 8;
    const visiblePlaybackHead = cappedIds.slice(0, Math.min(visibleHeadSlots, cappedIds.length));
    const prefetchTail = cappedIds.slice(visiblePlaybackHead.length);
    const visibleHeadSet = new Set(visiblePlaybackHead);
    const isCollectionDetailPrefetch = input.reason === "prefetch" && input.surface === "collection_detail";
    if (prefetchTail.length > 0 && visiblePlaybackHead.length > 0) {
      this.logEvent("DETAIL_BATCH_SPLIT_VISIBLE_FROM_PREFETCH", {
        visibleHead: visiblePlaybackHead,
        prefetchTailPreview: prefetchTail.slice(0, 4),
      });
    }

    type UpgradeIntent = { postId: string; batchIndex: number; carouselNeed: boolean; videoNeed: boolean };
    const upgradeIntents: UpgradeIntent[] = [];
    for (let batchIndex = 0; batchIndex < cappedIds.length; batchIndex += 1) {
      const postId = cappedIds[batchIndex]!;
      const card = byId.get(postId);
      if (!card) continue;
      const playbackShell = toPlaybackPostShellDTO({
        userId: card.author.userId,
        card: toCompactPlaybackCard(card),
      });
      const shellRecord = playbackShell as Record<string, unknown>;
      const carouselProbe = enrichPlaybackShellRecordForCarouselProbe(playbackShell, card);
      const stagedReadiness =
        input.hydrationMode === "playback"
          ? buildPostMediaReadiness(shellRecord, { hydrationMode: "playback" })
          : null;
      const hasRenderablePrimaryAsset = Boolean(
        stagedReadiness?.posterReady ||
          stagedReadiness?.playbackReady ||
          stagedReadiness?.posterUrl ||
          stagedReadiness?.playbackUrl ||
          stagedReadiness?.fallbackVideoUrl
      );
      const videoNeed =
        input.hydrationMode === "playback" &&
        playbackBatchShouldFetchFirestoreDetail(shellRecord) &&
        (!isCollectionDetailPrefetch || !hasRenderablePrimaryAsset);
      const carouselNeed =
        input.hydrationMode === "playback" &&
        playbackBatchCarouselIncompleteMedia(carouselProbe) &&
        !isCollectionDetailPrefetch;
      if (carouselNeed || videoNeed) {
        upgradeIntents.push({ postId, batchIndex, carouselNeed, videoNeed });
      }
    }
    upgradeIntents.sort((a, b) => {
      const va = visibleHeadSet.has(a.postId) ? 0 : 1;
      const vb = visibleHeadSet.has(b.postId) ? 0 : 1;
      if (va !== vb) return va - vb;
      const ca = a.carouselNeed ? 0 : a.videoNeed ? 1 : 9;
      const cb = b.carouselNeed ? 0 : b.videoNeed ? 1 : 9;
      if (ca !== cb) return ca - cb;
      return a.batchIndex - b.batchIndex;
    });
    const grantedFirestoreUpgrade = new Set<string>();
    const playbackUpgradeSkippedReason = new Map<string, string>();
    {
      let reserved = 0;
      for (const intent of upgradeIntents) {
        if (reserved >= playbackFirestoreReadCap) {
          playbackUpgradeSkippedReason.set(intent.postId, "playback_firestore_read_cap");
          continue;
        }
        grantedFirestoreUpgrade.add(intent.postId);
        reserved += 1;
      }
    }

    const found: Array<{ postId: string; detail: PostsDetailResponse }> = [];
    for (let batchIndex = 0; batchIndex < cappedIds.length; batchIndex += 1) {
      const postId = cappedIds[batchIndex]!;
      const card = byId.get(postId);
      if (!card) continue;
      let playbackShell = toPlaybackPostShellDTO({
        userId: card.author.userId,
        card: toCompactPlaybackCard(card),
      });
      if (input.reason === "prefetch" && Array.isArray(playbackShell.assets) && playbackShell.assets.length > 1) {
        playbackShell = {
          ...playbackShell,
          assets: playbackShell.assets.slice(0, 1),
          mediaCompleteness: "cover_only",
          requiresAssetHydration: true,
        };
      }
      const assetCountBeforeUpgrade = Array.isArray(playbackShell.assets) ? playbackShell.assets.length : 0;
      let mediaReadiness = buildPostMediaReadiness(playbackShell as Record<string, unknown>, {
        hydrationMode: "playback",
      });
      let degraded = false;
      let fallbacks: string[] = [];
      let debugHydrationSource: "cache" | "mixed" = "cache";
      let debugReadsForPost = 0;
      const shellRecord = playbackShell as Record<string, unknown>;
      const carouselProbe = enrichPlaybackShellRecordForCarouselProbe(playbackShell, card);
      const stagedReadiness = buildPostMediaReadiness(shellRecord, {
        hydrationMode: "playback",
      });
      const hasRenderablePrimaryAsset = Boolean(
        stagedReadiness.posterReady ||
          stagedReadiness.playbackReady ||
          stagedReadiness.posterUrl ||
          stagedReadiness.playbackUrl ||
          stagedReadiness.fallbackVideoUrl
      );
      const wantsVideoFirestoreUpgrade =
        input.hydrationMode === "playback" &&
        playbackBatchShouldFetchFirestoreDetail(shellRecord) &&
        (!isCollectionDetailPrefetch || !hasRenderablePrimaryAsset);
      const wantsCarouselFirestoreUpgrade =
        input.hydrationMode === "playback" &&
        playbackBatchCarouselIncompleteMedia(carouselProbe) &&
        !isCollectionDetailPrefetch;
      const wantsFirestoreMediaUpgrade =
        input.hydrationMode === "playback" &&
        (wantsCarouselFirestoreUpgrade || wantsVideoFirestoreUpgrade);
      const fetchAllowed =
        wantsFirestoreMediaUpgrade && grantedFirestoreUpgrade.has(postId) && playbackFirestoreReadCap > 0;
      if (wantsFirestoreMediaUpgrade && fetchAllowed) {
        try {
          playbackFirestoreReadsPerformed += 1;
          debugReadsForPost = 1;
          const detail = await this.service.loadPostDetail(postId, input.viewerId);
          const cardSummaryRaw =
            (detail as { cardSummary?: FeedBootstrapCandidateRecord }).cardSummary ??
            card;
          const safeCard = this.ensureSafeCardSummary(cardSummaryRaw, postId, detail);
          playbackShell = mergePlaybackShellFromDetailRecord(detail, safeCard);
          if (input.reason === "prefetch" && Array.isArray(playbackShell.assets) && playbackShell.assets.length > 1) {
            playbackShell = {
              ...playbackShell,
              assets: playbackShell.assets.slice(0, 1),
              mediaCompleteness: "cover_only",
              requiresAssetHydration: true,
            };
          }
          const assetCountAfter = Array.isArray(playbackShell.assets) ? playbackShell.assets.length : 0;
          mediaReadiness = buildPostMediaReadiness(playbackShell as Record<string, unknown>, {
            hydrationMode: "playback",
          });
          let photoAssets = 0;
          let videoAssets = 0;
          if (Array.isArray(playbackShell.assets)) {
            for (const a of playbackShell.assets) {
              const t = String((a as { type?: string }).type ?? "");
              if (t === "video") videoAssets += 1;
              else photoAssets += 1;
            }
          }
          const shellAfter = playbackShell as Record<string, unknown>;
          const stillStaleVideo =
            wantsVideoFirestoreUpgrade && playbackBatchShouldFetchFirestoreDetail(shellAfter);
          degraded = wantsVideoFirestoreUpgrade ? stillStaleVideo : false;
          if (wantsCarouselFirestoreUpgrade && assetCountAfter > assetCountBeforeUpgrade && assetCountAfter > 1) {
            this.logEvent("POST_MEDIA_FULL_ASSETS_UPGRADED_FROM_SOURCE", {
              postId,
              source: "playback_batch_photo_carousel_upgrade",
              assetCountBefore: assetCountBeforeUpgrade,
              assetCountAfter,
              photoAssetCount: photoAssets,
              videoAssetCount: videoAssets,
              selectedSource: "source_of_truth_detail",
            });
          } else if (wantsVideoFirestoreUpgrade && assetCountAfter > 0 && !stillStaleVideo) {
            this.logEvent("POST_MEDIA_FULL_ASSETS_NORMALIZED", {
              postId,
              source: "playback_batch_video_upgrade",
              assetCountBefore: assetCountBeforeUpgrade,
              assetCountAfter,
              photoAssetCount: photoAssets,
              videoAssetCount: videoAssets,
              selectedSource: "post_card_cache_upgraded",
            });
          }

          if (degraded) {
            fallbacks = ["post_card_cache_incomplete", "source_truth_still_missing_media"];
            if (process.env.NODE_ENV !== "production") {
              (playbackShell as Record<string, unknown>).mediaStatus = "missing_source_media";
            }
          } else {
            fallbacks = wantsCarouselFirestoreUpgrade ? ["carousel_assets_upgraded_from_source"] : ["post_card_cache_incomplete"];
            debugHydrationSource = "mixed";
          }
        } catch {
          degraded = wantsVideoFirestoreUpgrade;
          fallbacks = ["post_card_cache_incomplete"];
        }
      } else if (wantsFirestoreMediaUpgrade && !fetchAllowed) {
        degraded = wantsVideoFirestoreUpgrade;
        fallbacks = ["playback_firestore_read_cap"];
        if (input.hydrationMode === "playback" && wantsCarouselFirestoreUpgrade) {
          const shellMut = playbackShell as Record<string, unknown>;
          shellMut.mediaCompleteness = "cover_only";
          shellMut.requiresAssetHydration = true;
          shellMut.carouselUpgradeDeferredReason = "playback_firestore_read_cap";
        }
      }
      const videoPlaybackDebug =
        videoPlaybackDebugEnabled() && input.hydrationMode === "playback"
          ? selectBestVideoPlaybackAsset(playbackShell as Record<string, unknown>, {
              hydrationMode: "playback",
              allowPreviewOnly: true,
              includeDiagnostics: true,
            })
          : null;
      if (process.env.NODE_ENV !== "production" && input.hydrationMode === "playback") {
        const hintedRaw = carouselProbe.assetCount;
        const hinted =
          typeof hintedRaw === "number" && Number.isFinite(hintedRaw) ? Math.floor(hintedRaw) : null;
        const shellLenNow = Array.isArray(playbackShell.assets) ? playbackShell.assets.length : 0;
        const cardBrief = toCompactPlaybackCard(card);
        const skippedReadCap = playbackUpgradeSkippedReason.get(postId);
        const sourceUpgradeUsed = debugHydrationSource === "mixed";
        const rawFromCardBrief =
          typeof cardBrief.rawFirestoreAssetCount === "number" &&
          Number.isFinite(cardBrief.rawFirestoreAssetCount)
            ? Math.floor(cardBrief.rawFirestoreAssetCount as number)
            : null;
        const rawProbe =
          typeof carouselProbe.rawFirestoreAssetCount === "number" &&
          Number.isFinite(carouselProbe.rawFirestoreAssetCount)
            ? Math.floor(carouselProbe.rawFirestoreAssetCount as number)
            : null;
        const rawAssetCountIfKnown = rawFromCardBrief ?? rawProbe ?? hinted;
        const effectiveAssetCountHint =
          typeof cardBrief.assetCount === "number" && Number.isFinite(cardBrief.assetCount)
            ? Math.floor(cardBrief.assetCount as number)
            : hinted;
        const upgradeSkippedReason =
          skippedReadCap ??
          (wantsFirestoreMediaUpgrade && !fetchAllowed
            ? "playback_firestore_read_cap"
            : !wantsFirestoreMediaUpgrade
              ? "playback_cache_sufficient"
              : null);
        const selectedSource =
          sourceUpgradeUsed ? "post_card_cache_upgraded" : "post_card_cache";
        if (
          this.shouldLogPlaybackCacheDecision({
            postId,
            selectedSource,
            sourceUpgradeUsed,
            upgradeSkippedReason,
          })
        ) {
          this.logEvent("POST_DETAILS_BATCH_PLAYBACK_CACHE_DECISION", {
            postId,
            selectedSource,
            hydrationMode: input.hydrationMode,
            rawAssetCountIfKnown,
            cachedAssetCount: assetCountBeforeUpgrade,
            returnedAssetCount: shellLenNow,
            assetCount: effectiveAssetCountHint,
            hasMultipleAssets:
              cardBrief.hasMultipleAssets === true ||
              carouselProbe.hasMultipleAssets === true,
            mediaCompleteness:
              (playbackShell as Record<string, unknown>).mediaCompleteness ??
              cardBrief.mediaCompleteness ??
              (wantsCarouselFirestoreUpgrade ? "cover_only" : "full"),
            sourceUpgradeUsed,
            upgradeSkippedReason,
            visibleHead: visibleHeadSet.has(postId),
            isCoverOnlyCard: Boolean(
              cardBrief.requiresAssetHydration === true ||
                cardBrief.mediaCompleteness === "cover_only" ||
                wantsCarouselFirestoreUpgrade,
            ),
          });
        }
        const effectiveHint = effectiveAssetCountHint;
        if (
          effectiveHint != null &&
          effectiveHint > shellLenNow &&
          !sourceUpgradeUsed &&
          (upgradeSkippedReason === "playback_firestore_read_cap" || wantsCarouselFirestoreUpgrade)
        ) {
          console.warn("[POST_DETAILS_BATCH_PLAYBACK_CAROUSEL_PARTIAL]", {
            postId,
            effectiveHint,
            shellLenNow,
            upgradeSkippedReason,
          });
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
              ...(videoPlaybackDebug
                ? {
                    selectedVariantLabel: videoPlaybackDebug.selectedVariantLabel,
                    selectedVariantHeight: videoPlaybackDebug.selectedVariantHeight,
                    selectedVariantCodec: videoPlaybackDebug.selectedVariantCodec,
                    selectedVideoSource: videoPlaybackDebug.selectedVariantSource,
                    usedPreviewFallback: videoPlaybackDebug.isPreviewOnly,
                    productionVariantAvailable: videoPlaybackDebug.isProductionPlayback,
                    productionVariantSelected: videoPlaybackDebug.productionPlaybackSelected,
                    selectedVideoVariant: videoPlaybackDebug.selectedVideoVariant,
                    cacheMediaUpgraded: debugHydrationSource === "mixed",
                    videoPlaybackDiagnostics: videoPlaybackDebug.diagnostics,
                  }
                : {}),
            } as PostsDetailResponse["firstRender"]["post"],
            author: card.author,
            social: card.social,
            viewer: card.viewer,
          },
          deferred: { commentsPreview: null },
          degraded,
          fallbacks,
          debugHydrationSource,
          debugReads: debugReadsForPost,
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
      playbackFirestoreReadsPerformed,
      playbackFirestoreReadCap,
      mediaSummary: found.map((row) => {
        const summary = postMediaSummaryForLog(row.detail.firstRender.post as Record<string, unknown>, {
          hydrationMode: input.hydrationMode === "playback" ? "playback" : "card",
        });
        const upgraded = row.detail.debugHydrationSource === "mixed";
        return {
          postId: row.postId,
          status: summary.mediaStatus === "ready" ? "ready" : "partial_cached",
          selectedSource: upgraded ? "post_card_cache_upgraded" : "post_card_cache",
          playbackUrlPresent: summary.playbackUrlPresent,
          fallbackVideoUrlPresent: summary.fallbackVideoUrlPresent,
          posterPresent: summary.posterPresent,
          ...(process.env.NODE_ENV !== "production"
            ? {
                selectedVideoVariant:
                  typeof (summary as { selectedVideoVariant?: string }).selectedVideoVariant === "string"
                    ? (summary as { selectedVideoVariant?: string }).selectedVideoVariant
                    : undefined,
                isDegradedVideo:
                  typeof (summary as { isDegradedVideo?: boolean }).isDegradedVideo === "boolean"
                    ? (summary as { isDegradedVideo?: boolean }).isDegradedVideo
                    : undefined,
                repairedCachedVideoMedia:
                  input.hydrationMode === "playback" &&
                  Boolean(summary.playbackUrlPresent && summary.hasVideo) &&
                  !upgraded,
                sourceUpgradeUsed: upgraded,
              }
            : {}),
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
      debugReads: playbackFirestoreReadsPerformed,
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
    const compactCard = toCompactPlaybackCard(cardSummary);
    const trimmedCardSummary = toPlaybackPostShellDTO({
      userId: cardSummary.author.userId,
      card: compactCard,
    }).cardSummary;
    const compatibilityDetail = {
      ...detail,
      cardSummary: trimmedCardSummary,
      mediaType: detail.mediaType ?? cardSummary.media.type,
      thumbUrl: detail.thumbUrl ?? cardSummary.media.posterUrl,
      assets: Array.isArray(detail.assets) ? detail.assets : [],
      letterboxGradients: Array.isArray(detail.letterboxGradients) ? detail.letterboxGradients : undefined
    };
    const openPlaybackSelection = selectBestVideoPlaybackAsset(compatibilityDetail as Record<string, unknown>, {
      hydrationMode: input.hydrationMode,
      allowPreviewOnly: true,
      includeDiagnostics: true,
    });
    const detailWithPlaybackSelection = {
      ...compatibilityDetail,
      ...(openPlaybackSelection.playbackUrl ? { playbackUrl: openPlaybackSelection.playbackUrl } : {}),
      ...(openPlaybackSelection.fallbackVideoUrl ? { fallbackVideoUrl: openPlaybackSelection.fallbackVideoUrl } : {}),
      ...(openPlaybackSelection.posterUrl ? { posterUrl: openPlaybackSelection.posterUrl } : {}),
      ...(openPlaybackSelection.selectedVariantLabel
        ? {
            selectedVariantLabel: openPlaybackSelection.selectedVariantLabel,
            selectedVariantHeight: openPlaybackSelection.selectedVariantHeight,
            selectedVariantCodec: openPlaybackSelection.selectedVariantCodec,
            selectedVideoSource: openPlaybackSelection.selectedVariantSource,
            usedPreviewFallback: openPlaybackSelection.isPreviewOnly,
            productionVariantAvailable: openPlaybackSelection.isProductionPlayback,
            productionVariantSelected: openPlaybackSelection.productionPlaybackSelected,
            selectedVideoVariant: openPlaybackSelection.selectedVideoVariant,
            videoPlaybackDiagnostics: openPlaybackSelection.diagnostics,
          }
        : {}),
    };
    if (input.hydrationMode === "open" || input.hydrationMode === "full") {
      const commentsPreview =
        input.hydrationMode === "open"
          ? null
          : Array.isArray(detail.commentsPreview)
            ? normalizeCommentsPreview(detail.commentsPreview)
            : await this.service.loadCommentsPreview(input.postId, 0).catch(() => null);
      return {
        routeName: "posts.detail.get",
        firstRender: {
          post: detailWithPlaybackSelection,
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
        post: detailWithPlaybackSelection,
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
