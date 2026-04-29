import { incrementDbOps } from "../../observability/request-context.js";
import { recordFallback, recordTimeout } from "../../observability/request-context.js";
import { applyAuthorSpacingToFeedCards, DEFAULT_FEED_AUTHOR_SPACING } from "../../lib/feed-author-spacing.js";
import { logFirestoreDebug } from "../source-of-truth/firestore-debug.js";
import { mutationStateRepository } from "../mutations/mutation-state.repository.js";
import { commentsRepository } from "./comments.repository.js";
import { FeedFirestoreAdapter } from "../source-of-truth/feed-firestore.adapter.js";
import {
  FeedDetailFirestoreAdapter,
  type FirestoreFeedDetailBundle
} from "../source-of-truth/feed-detail-firestore.adapter.js";
import { ProfilePostDetailFirestoreAdapter } from "../source-of-truth/profile-post-detail-firestore.adapter.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import {
  enforceSourceOfTruthStrictness,
  isStrictSourceOfTruthEnabled,
  SourceOfTruthRequiredError
} from "../source-of-truth/strict-mode.js";

type FirestoreUserSummary = {
  userId: string;
  handle: string;
  name: string | null;
  pic: string | null;
};

export type FeedBootstrapCandidateRecord = {
  postId: string;
  author: {
    userId: string;
    handle: string;
    name: string | null;
    pic: string | null;
  };
  activities: string[];
  address: string | null;
  geo: {
    lat: number | null;
    long: number | null;
    city: string | null;
    state: string | null;
    country: string | null;
    geohash: string | null;
  };
  assets: Array<{
    id: string;
    type: "image" | "video";
    previewUrl: string | null;
    posterUrl: string | null;
    originalUrl: string | null;
    blurhash: string | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    orientation: string | null;
  }>;
  title: string | null;
  description?: string | null;
  captionPreview: string | null;
  tags?: string[];
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  createdAtMs: number;
  firstAssetUrl: string | null;
  media: {
    type: "image" | "video";
    posterUrl: string;
    aspectRatio: number;
    startupHint: "poster_only" | "poster_then_preview";
  };
  social: {
    likeCount: number;
    commentCount: number;
  };
  viewer: {
    liked: boolean;
    saved: boolean;
  };
  updatedAtMs: number;
};

export type FeedDetailRecord = {
  postId: string;
  userId: string;
  caption: string | null;
  title?: string | null;
  description?: string | null;
  activities?: string[];
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  tags?: string[];
  mentions?: string[];
  visibility?: "public" | "followers" | "private";
  deleted?: boolean;
  blocked?: boolean;
  createdAtMs: number;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }> | null;
  mediaType: "image" | "video";
  thumbUrl: string;
  assets: Array<{
    id: string;
    type: "image" | "video";
    poster: string | null;
    thumbnail: string | null;
    variants?: {
      startup720FaststartAvc?: string;
      main720Avc?: string;
      hls?: string;
    };
  }>;
};

export type FeedSessionHintsRecord = {
  recommendationPath: "for_you_light";
  staleAfterMs: number;
};

export type FeedPageRecord = {
  cursorIn: string | null;
  items: FeedBootstrapCandidateRecord[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type FeedQueryContext = {
  tab: "explore" | "following";
  lat?: number;
  lng?: number;
  radiusKm?: number;
};

const FEED_TOTAL_ITEMS = 160;

function seeded(seed: string): number {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) {
    n = (n + seed.charCodeAt(i) * (i + 13)) % 1_000_003;
  }
  return n;
}

function buildFeedCardShell(
  viewerId: string,
  candidate: {
    postId: string;
    authorId: string;
    updatedAtMs: number;
    mediaType: "image" | "video";
    posterUrl: string;
    firstAssetUrl: string | null;
    title: string | null;
    description?: string | null;
    captionPreview: string | null;
    tags?: string[];
    createdAtMs: number;
    authorHandle: string | null;
    authorName: string | null;
    authorPic: string | null;
    activities: string[];
    address: string | null;
    geo: {
      lat: number | null;
      long: number | null;
      city: string | null;
      state: string | null;
      country: string | null;
      geohash: string | null;
    };
    assets: Array<{
      id: string;
      type: "image" | "video";
      previewUrl: string | null;
      posterUrl: string | null;
      originalUrl: string | null;
      blurhash: string | null;
      width: number | null;
      height: number | null;
      aspectRatio: number | null;
      orientation: string | null;
    }>;
    carouselFitWidth?: boolean;
    layoutLetterbox?: boolean;
    letterboxGradientTop?: string | null;
    letterboxGradientBottom?: string | null;
    letterboxGradients?: Array<{ top: string; bottom: string }> | null;
    likeCount: number;
    commentCount: number;
    likedByUserIds: string[];
  }
): FeedBootstrapCandidateRecord {
  const aid = candidate.authorId.trim();
  return {
    postId: candidate.postId,
    author: {
      userId: aid,
      handle: candidate.authorHandle ?? (aid ? aid.replace(/^@+/, "") : "unknown"),
      name: candidate.authorName,
      pic: candidate.authorPic
    },
    activities: candidate.activities,
    address: candidate.address,
    carouselFitWidth: candidate.carouselFitWidth,
    layoutLetterbox: candidate.layoutLetterbox,
    letterboxGradientTop: candidate.letterboxGradientTop ?? undefined,
    letterboxGradientBottom: candidate.letterboxGradientBottom ?? undefined,
    letterboxGradients: candidate.letterboxGradients ?? undefined,
    geo: candidate.geo,
    assets: candidate.assets,
    description: candidate.description ?? null,
    captionPreview: candidate.captionPreview,
    tags: candidate.tags ?? [],
    createdAtMs: candidate.createdAtMs,
    title: candidate.title,
    firstAssetUrl: candidate.firstAssetUrl,
    media: {
      type: candidate.mediaType,
      posterUrl: candidate.posterUrl,
      aspectRatio: 9 / 16,
      startupHint: candidate.mediaType === "video" ? "poster_then_preview" : "poster_only"
    },
    social: {
      likeCount: Math.max(0, candidate.likeCount + mutationStateRepository.getPostLikeDelta(candidate.postId)),
      commentCount: Math.max(0, candidate.commentCount)
    },
    viewer: {
      liked:
        mutationStateRepository.hasViewerLikedPost(viewerId, candidate.postId) ||
        candidate.likedByUserIds.includes(viewerId),
      saved: mutationStateRepository.resolveViewerSavedPost(viewerId, candidate.postId, false)
    },
    updatedAtMs: candidate.updatedAtMs
  };
}

function buildSyntheticTestFeedCard(viewerId: string, postId: string): FeedBootstrapCandidateRecord | null {
  if (process.env.NODE_ENV !== "test") return null;
  const { slot, valid } = resolvePostSlot(postId);
  if (!valid || !postId.startsWith("internal-viewer-feed-post-")) return null;
  const mediaType: "image" | "video" = slot % 4 === 0 ? "video" : "image";
  const authorId = `source-user-${(slot % 6) + 1}`;
  const posterUrl = `https://cdn.locava.test/posts/${encodeURIComponent(postId)}/poster.jpg`;
  return buildFeedCardShell(viewerId, {
    postId,
    authorId,
    updatedAtMs: Date.now() - slot * 60_000,
    createdAtMs: Date.now() - slot * 60_000,
    mediaType,
    posterUrl,
    firstAssetUrl: posterUrl,
    title: `Saved post ${slot}`,
    description: null,
    captionPreview: `Saved test post ${slot}`,
    tags: [],
    authorHandle: authorId,
    authorName: `Source User ${((slot % 6) + 1).toString()}`,
    authorPic: null,
    activities: [],
    address: null,
    geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
    assets: [
      {
        id: `${postId}-asset-1`,
        type: mediaType,
        previewUrl: posterUrl,
        posterUrl,
        originalUrl: posterUrl,
        blurhash: null,
        width: 1080,
        height: 1920,
        aspectRatio: 9 / 16,
        orientation: "portrait"
      }
    ],
    likeCount: Math.max(0, 80 - slot),
    commentCount: Math.max(0, 20 - Math.floor(slot / 2)),
    likedByUserIds: []
  });
}

function mergeBundleIntoFeedCard(
  viewerId: string,
  card: FeedBootstrapCandidateRecord,
  bundle: FirestoreFeedDetailBundle
): FeedBootstrapCandidateRecord {
  const postId = bundle.post.postId;
  const mediaType = bundle.post.mediaType;
  const posterUrl = bundle.post.thumbUrl;
  return {
    ...card,
    postId,
    author: bundle.author,
    activities: card.activities,
    address: card.address,
    geo: card.geo,
    assets: card.assets,
    title: card.title,
    description: bundle.post.description ?? card.description ?? null,
    captionPreview: bundle.post.caption,
    tags: bundle.post.tags ?? card.tags ?? [],
    carouselFitWidth:
      typeof bundle.post.carouselFitWidth === "boolean"
        ? bundle.post.carouselFitWidth
        : card.carouselFitWidth,
    layoutLetterbox:
      typeof bundle.post.layoutLetterbox === "boolean"
        ? bundle.post.layoutLetterbox
        : card.layoutLetterbox,
    letterboxGradientTop:
      typeof bundle.post.letterboxGradientTop === "string" || bundle.post.letterboxGradientTop === null
        ? bundle.post.letterboxGradientTop
        : card.letterboxGradientTop,
    letterboxGradientBottom:
      typeof bundle.post.letterboxGradientBottom === "string" || bundle.post.letterboxGradientBottom === null
        ? bundle.post.letterboxGradientBottom
        : card.letterboxGradientBottom,
    letterboxGradients:
      Array.isArray(bundle.post.letterboxGradients) && bundle.post.letterboxGradients.length > 0
        ? bundle.post.letterboxGradients
        : card.letterboxGradients,
    createdAtMs: bundle.post.createdAtMs,
    firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? card.firstAssetUrl,
    media: {
      type: mediaType,
      posterUrl,
      aspectRatio: 9 / 16,
      startupHint: mediaType === "video" ? "poster_then_preview" : "poster_only"
    },
    social: {
      likeCount: Math.max(0, bundle.social.likeCount + mutationStateRepository.getPostLikeDelta(postId)),
      commentCount: bundle.social.commentCount
    },
    viewer: {
      liked: mutationStateRepository.hasViewerLikedPost(viewerId, postId) || bundle.viewer.liked,
      saved: mutationStateRepository.resolveViewerSavedPost(viewerId, postId, bundle.viewer.saved)
    },
    updatedAtMs: bundle.post.updatedAtMs
  };
}

function resolvePostSlot(postId: string): { slot: number; valid: boolean } {
  const feedMatch = /-feed-post-(\d+)$/.exec(postId);
  if (feedMatch) {
    const parsed = Number(feedMatch[1]);
    return { slot: parsed, valid: Number.isFinite(parsed) && parsed > 0 && parsed <= FEED_TOTAL_ITEMS };
  }
  const profileMatch = /-post-(\d+)$/.exec(postId);
  if (profileMatch) {
    const parsed = Number(profileMatch[1]);
    return { slot: parsed, valid: Number.isFinite(parsed) && parsed > 0 };
  }
  // Non-pattern IDs are still supported in degraded mode via deterministic hashing.
  return { slot: (seeded(postId) % FEED_TOTAL_ITEMS) + 1, valid: true };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FeedRepository {
  private readonly detailBundleInFlight = new Map<string, Promise<FirestoreFeedDetailBundle | null>>();
  private readonly db = getFirestoreSourceClient();

  constructor(
    private readonly firestoreAdapter: FeedFirestoreAdapter = new FeedFirestoreAdapter(),
    private readonly detailFirestoreAdapter: FeedDetailFirestoreAdapter = new FeedDetailFirestoreAdapter(),
    private readonly profilePostDetailAdapter: ProfilePostDetailFirestoreAdapter = new ProfilePostDetailFirestoreAdapter()
  ) {}

  parsePageCursor(cursor: string | null): { offset: number; context?: FeedQueryContext } {
    if (!cursor) return { offset: 0 };
    const match = /^cursor:(\d+)$/.exec(cursor.trim());
    if (!match) {
      const modern = /^fc:v1:(.+)$/.exec(cursor.trim());
      if (!modern?.[1]) throw new Error("invalid_feed_cursor");
      try {
        const raw = Buffer.from(modern[1], "base64url").toString("utf8");
        const parsed = JSON.parse(raw) as { offset?: unknown; tab?: unknown; lat?: unknown; lng?: unknown; radiusKm?: unknown };
        const offset = Number(parsed.offset);
        if (!Number.isFinite(offset) || offset < 0) throw new Error("invalid_feed_cursor");
        const tab = parsed.tab === "following" ? "following" : "explore";
        const lat = typeof parsed.lat === "number" && Number.isFinite(parsed.lat) ? parsed.lat : undefined;
        const lng = typeof parsed.lng === "number" && Number.isFinite(parsed.lng) ? parsed.lng : undefined;
        const radiusKm = typeof parsed.radiusKm === "number" && Number.isFinite(parsed.radiusKm) ? parsed.radiusKm : undefined;
        return { offset: Math.floor(offset), context: { tab, lat, lng, radiusKm } };
      } catch {
        throw new Error("invalid_feed_cursor");
      }
    }
    const offset = Number(match[1]);
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error("invalid_feed_cursor");
    }
    return { offset: Math.floor(offset) };
  }

  async getBootstrapCandidates(viewerId: string, limit: number, context?: FeedQueryContext): Promise<FeedBootstrapCandidateRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 8));
    const queryContext: FeedQueryContext = context ?? { tab: "explore" };
    if (this.firestoreAdapter.isEnabled()) {
      try {
        const page = await this.firestoreAdapter.getFeedCandidatesPage({
          viewerId,
          tab: queryContext.tab,
          cursorOffset: 0,
          limit: safeLimit,
          lat: queryContext.lat,
          lng: queryContext.lng,
          radiusKm: queryContext.radiusKm
        });
        incrementDbOps("queries", page.queryCount);
        incrementDbOps("reads", page.readCount);
        const shells = page.items.map((item) =>
          buildFeedCardShell(viewerId, item)
        );
        const withAuthors = await this.hydrateCardAuthors(shells);
        return applyAuthorSpacingToFeedCards(withAuthors, { spacing: DEFAULT_FEED_AUTHOR_SPACING });
      } catch (error) {
        logFirestoreDebug("feed_candidates_firestore_failure", {
          strictSourceOfTruthLabel: "feed_candidates_firestore",
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        });
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("feed_candidates_firestore");
        }
        recordFallback("feed_candidates_firestore_fallback");
        enforceSourceOfTruthStrictness("feed_candidates_firestore");
        throw new SourceOfTruthRequiredError("feed_candidates_firestore");
      }
    }
    throw new SourceOfTruthRequiredError("feed_candidates_firestore_unavailable");
  }

  async getPostCardSummary(viewerId: string, postId: string): Promise<FeedBootstrapCandidateRecord> {
    const bundle = await this.tryGetDetailBundleForPost(postId, viewerId);
    if (!bundle) {
      const synthetic = buildSyntheticTestFeedCard(viewerId, postId);
      if (synthetic) {
        return synthetic;
      }
      if (this.db) {
        incrementDbOps("queries", 1);
        const postDoc = await this.db.collection("posts").doc(postId).get();
        incrementDbOps("reads", postDoc.exists ? 1 : 0);
        if (!postDoc.exists) {
          throw new Error("feed_post_not_found");
        }
      }
      throw new SourceOfTruthRequiredError("feed_detail_firestore");
    }
    const shell = buildFeedCardShell(viewerId, {
      postId,
      authorId: bundle.author.userId,
      updatedAtMs: bundle.post.updatedAtMs,
      createdAtMs: bundle.post.createdAtMs,
      mediaType: bundle.post.mediaType,
      posterUrl: bundle.post.thumbUrl,
      firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? bundle.post.thumbUrl,
      title: null,
      description: bundle.post.description ?? null,
      captionPreview: bundle.post.caption,
      tags: bundle.post.tags ?? [],
      authorHandle: bundle.author.handle,
      authorName: bundle.author.name,
      authorPic: bundle.author.pic,
      activities: [],
      address: null,
      geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
      assets: bundle.post.assets.map((a) => ({
        id: a.id,
        type: a.type,
        previewUrl: a.thumbnail,
        posterUrl: a.poster,
        originalUrl: a.poster,
        blurhash: null,
        width: null,
        height: null,
        aspectRatio: null,
        orientation: null
      })),
      carouselFitWidth: bundle.post.carouselFitWidth,
      layoutLetterbox: bundle.post.layoutLetterbox,
      letterboxGradientTop: bundle.post.letterboxGradientTop ?? null,
      letterboxGradientBottom: bundle.post.letterboxGradientBottom ?? null,
      letterboxGradients: bundle.post.letterboxGradients ?? null,
      likeCount: bundle.social.likeCount,
      commentCount: bundle.social.commentCount,
      likedByUserIds: bundle.viewer.liked && viewerId ? [viewerId] : []
    });
    return mergeBundleIntoFeedCard(viewerId, shell, bundle);
  }

  async getPostCardSummariesByPostIds(viewerId: string, postIds: string[]): Promise<FeedBootstrapCandidateRecord[]> {
    const uniqueIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    if (this.firestoreAdapter.isEnabled()) {
      try {
        const page = await this.firestoreAdapter.getCandidatesByPostIds(uniqueIds);
        incrementDbOps("queries", page.queryCount);
        incrementDbOps("reads", page.readCount);
        const byId = new Map(page.items.map((item) => [item.postId, item] as const));
        const shells = uniqueIds
          .map((postId) => byId.get(postId))
          .filter((item): item is NonNullable<typeof item> => item !== undefined)
          .map((item) => buildFeedCardShell(viewerId, item));
        return await this.hydrateCardAuthors(shells);
      } catch (error) {
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("feed_card_batch_firestore");
        }
        recordFallback("feed_card_batch_firestore_fallback");
      }
    }
    const hydrated = await Promise.all(uniqueIds.map((postId) => this.getPostCardSummary(viewerId, postId)));
    return hydrated;
  }

  async getAuthorSummary(authorUserId: string, sourcePostId?: string): Promise<FeedBootstrapCandidateRecord["author"]> {
    const fromSource = sourcePostId ? await this.tryGetDetailBundleForPost(sourcePostId) : null;
    if (fromSource) {
      return fromSource.author;
    }
    const loaded = await this.loadUserSummaries([authorUserId]);
    const summary = loaded.get(authorUserId);
    if (!summary) {
      throw new SourceOfTruthRequiredError("feed_author_firestore");
    }
    return summary;
  }

  async getAuthorSummariesByUserIds(authorUserIds: string[]): Promise<FeedBootstrapCandidateRecord["author"][]> {
    const unique = [...new Set(authorUserIds.map((id) => id.trim()).filter(Boolean))];
    return Promise.all(unique.map((authorUserId) => this.getAuthorSummary(authorUserId)));
  }

  async getSocialSummary(postId: string): Promise<FeedBootstrapCandidateRecord["social"]> {
    const fromSource = await this.tryGetDetailBundleForPost(postId);
    if (fromSource) {
      return {
        likeCount: Math.max(0, fromSource.social.likeCount + mutationStateRepository.getPostLikeDelta(postId)),
        commentCount: fromSource.social.commentCount
      };
    }
    throw new SourceOfTruthRequiredError("feed_social_firestore");
  }

  async getViewerPostState(viewerId: string, postId: string): Promise<FeedBootstrapCandidateRecord["viewer"]> {
    const fromSource = await this.tryGetDetailBundleForPost(postId, viewerId);
    if (fromSource) {
      return {
        liked: mutationStateRepository.hasViewerLikedPost(viewerId, postId) || fromSource.viewer.liked,
        saved: mutationStateRepository.resolveViewerSavedPost(viewerId, postId, fromSource.viewer.saved)
      };
    }
    throw new SourceOfTruthRequiredError("feed_viewer_state_firestore");
  }

  async getPostDetail(postId: string, viewerId: string): Promise<FeedDetailRecord> {
    const fromSource = await this.tryGetDetailBundleForPost(postId, viewerId);
    if (fromSource) {
      return {
        postId: fromSource.post.postId,
        userId: fromSource.post.userId,
        caption: fromSource.post.caption,
        title: fromSource.post.title ?? null,
        description: fromSource.post.description ?? null,
        activities: fromSource.post.activities ?? [],
        address: fromSource.post.address ?? null,
        lat: fromSource.post.lat ?? null,
        lng: fromSource.post.lng ?? null,
        tags: fromSource.post.tags ?? [],
        createdAtMs: fromSource.post.createdAtMs,
        carouselFitWidth: fromSource.post.carouselFitWidth,
        layoutLetterbox: fromSource.post.layoutLetterbox,
        letterboxGradientTop: fromSource.post.letterboxGradientTop ?? null,
        letterboxGradientBottom: fromSource.post.letterboxGradientBottom ?? null,
        letterboxGradients: fromSource.post.letterboxGradients ?? null,
        mediaType: fromSource.post.mediaType,
        thumbUrl: fromSource.post.thumbUrl,
        assets: fromSource.post.assets
      };
    }

    if (this.db) {
      incrementDbOps("queries", 1);
      const postDoc = await this.db.collection("posts").doc(postId).get();
      incrementDbOps("reads", postDoc.exists ? 1 : 0);
      if (!postDoc.exists) {
        throw new Error("feed_post_not_found");
      }
      const raw = (postDoc.data() ?? {}) as Record<string, unknown>;
      const privacy = typeof raw.privacy === "string" ? raw.privacy.toLowerCase() : "public";
      if (
        Boolean(raw.deleted) ||
        Boolean(raw.isDeleted) ||
        Boolean(raw.archived) ||
        Boolean(raw.hidden) ||
        privacy === "private"
      ) {
        throw new Error("feed_post_not_found");
      }
    }

    throw new SourceOfTruthRequiredError("feed_detail_firestore");
  }

  async getCommentsPreview(postId: string, slowMs: number): Promise<Array<{ commentId: string; userId: string; text: string; createdAtMs: number }>> {
    const page = await commentsRepository.listTopLevelComments({
      viewerId: "anonymous",
      postId,
      cursor: null,
      limit: 10
    });
    if (slowMs > 0) {
      await delay(slowMs);
    }
    return page.items.map((item) => ({
      commentId: item.commentId,
      userId: item.author.userId,
      text: item.text,
      createdAtMs: item.createdAtMs
    }));
  }

  async getFeedPage(viewerId: string, cursor: string | null, limit: number, context?: FeedQueryContext): Promise<FeedPageRecord> {
    const safeLimit = Math.max(1, Math.min(limit, 8));
    const parsedCursor = this.parsePageCursor(cursor);
    const offset = parsedCursor.offset;
    const queryContext: FeedQueryContext = context ?? parsedCursor.context ?? { tab: "explore" };

    if (this.firestoreAdapter.isEnabled()) {
      try {
        const page = await this.firestoreAdapter.getFeedCandidatesPage({
          viewerId,
          tab: queryContext.tab,
          cursorOffset: offset,
          limit: safeLimit,
          lat: queryContext.lat,
          lng: queryContext.lng,
          radiusKm: queryContext.radiusKm
        });
        incrementDbOps("queries", page.queryCount);
        incrementDbOps("reads", page.readCount);
        const shells = page.items.map((item) =>
          buildFeedCardShell(viewerId, item)
        );
        const withAuthors = await this.hydrateCardAuthors(shells);
        const spaced = applyAuthorSpacingToFeedCards(withAuthors, { spacing: DEFAULT_FEED_AUTHOR_SPACING });
        return {
          cursorIn: cursor,
          items: spaced,
          hasMore: page.hasMore,
          nextCursor:
            page.nextCursor != null
              ? encodeFeedCursor({
                  offset: Number(/^cursor:(\d+)$/.exec(page.nextCursor)?.[1] ?? offset + page.items.length),
                  ...queryContext
                })
              : null
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("feed_page_firestore");
        }
        recordFallback("feed_page_firestore_fallback");
        enforceSourceOfTruthStrictness("feed_page_firestore");
        throw new SourceOfTruthRequiredError("feed_page_firestore");
      }
    }
    throw new SourceOfTruthRequiredError("feed_page_firestore_unavailable");
  }

  private async hydrateCardAuthors(cards: FeedBootstrapCandidateRecord[]): Promise<FeedBootstrapCandidateRecord[]> {
    if (!cards.length) return cards;
    const ids = [...new Set(cards.map((c) => c.author?.userId).filter((v): v is string => typeof v === "string" && v.trim().length > 0))];
    if (!ids.length) return cards;
    const summaries = await this.loadUserSummaries(ids);
    return cards.map((card) => {
      const authorId = card.author?.userId ?? "";
      const s = summaries.get(authorId);
      if (!s) return card;
      return {
        ...card,
        author: {
          userId: s.userId,
          handle: s.handle || card.author.handle,
          name: s.name ?? card.author.name ?? null,
          pic: s.pic ?? card.author.pic ?? null
        }
      };
    });
  }

  private async loadUserSummaries(userIds: string[]): Promise<Map<string, FirestoreUserSummary>> {
    const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    const out = new Map<string, FirestoreUserSummary>();
    if (!this.db || unique.length === 0) return out;

    const chunkSize = 50;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const refs = chunk.map((id) => this.db!.collection("users").doc(id));
      // getAll does not count as a "query" in Firestore, but we keep dbOps consistent with other codepaths.
      incrementDbOps("queries", 1);
      const snaps = await this.db.getAll(...refs);
      incrementDbOps("reads", snaps.length);
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const d = (snap.data() ?? {}) as Record<string, unknown>;
        const handle = String(d.handle ?? "").replace(/^@+/, "").trim();
        const nameCandidate = typeof d.name === "string" ? d.name : typeof d.displayName === "string" ? d.displayName : "";
        const name = nameCandidate.trim() ? nameCandidate.trim() : null;
        const picCandidate =
          typeof d.profilePic === "string"
            ? d.profilePic
            : typeof d.profilePicture === "string"
              ? d.profilePicture
              : typeof d.photo === "string"
                ? d.photo
                : "";
        const pic = picCandidate.trim() ? picCandidate.trim() : null;
        out.set(snap.id, {
          userId: snap.id,
          handle: handle || `user_${snap.id.slice(0, 8)}`,
          name,
          pic
        });
      }
    }
    return out;
  }

  async getSessionHints(viewerId: string, slowMs: number): Promise<FeedSessionHintsRecord> {
    if (slowMs > 0) {
      await delay(slowMs);
    }
    return {
      recommendationPath: "for_you_light",
      staleAfterMs: 30_000
    };
  }

  private async hydrateFeedCardsFromFirestore(
    viewerId: string,
    cards: FeedBootstrapCandidateRecord[]
  ): Promise<FeedBootstrapCandidateRecord[]> {
    if (!this.detailFirestoreAdapter.isEnabled()) {
      return cards;
    }
    const hydrated = await Promise.all(
      cards.map(async (card) => {
        const bundle = await this.tryGetDetailBundleForPost(card.postId, viewerId);
        if (!bundle) return card;
        return mergeBundleIntoFeedCard(viewerId, card, bundle);
      })
    );
    return hydrated;
  }

  private async tryGetDetailBundleForPost(postId: string, viewerId?: string): Promise<FirestoreFeedDetailBundle | null> {
    if (!this.detailFirestoreAdapter.isEnabled()) return null;

    const key = `${viewerId ?? "_"}:${postId}`;
    const existing = this.detailBundleInFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        const vid = viewerId ?? "anonymous";
        const syntheticMatch = /-feed-post-(\d+)$/.exec(postId);
        if (!syntheticMatch) {
          const byId = await this.detailFirestoreAdapter.tryGetFeedDetailBundleByPostId(postId, vid);
          if (byId) {
            incrementDbOps("queries", byId.queryCount);
            incrementDbOps("reads", byId.readCount);
            return byId;
          }
          if (this.profilePostDetailAdapter.isEnabled()) {
            const profileById = await this.profilePostDetailAdapter.getPostDetailByPostId({
              postId,
              viewerId: vid
            });
            if (profileById?.data) {
              incrementDbOps("queries", profileById.queryCount);
              incrementDbOps("reads", profileById.readCount);
              return {
                post: {
                  postId: profileById.data.postId,
                  userId: profileById.data.userId,
                  caption: profileById.data.caption ?? null,
                  createdAtMs: profileById.data.createdAtMs,
                  updatedAtMs: profileById.data.createdAtMs,
                  mediaType: profileById.data.mediaType,
                  thumbUrl: profileById.data.thumbUrl,
                  assets: profileById.data.assets.map((asset, idx) => ({
                    id: asset.id || `${profileById.data.postId}-asset-${idx + 1}`,
                    type: (asset.type === "video" ? "video" : "image") as "image" | "video",
                    original: undefined,
                    poster: asset.poster ?? asset.thumbnail ?? profileById.data.thumbUrl,
                    thumbnail: asset.thumbnail ?? asset.poster ?? profileById.data.thumbUrl,
                    variants: (asset.variants ?? {}) as Record<string, unknown>
                  })),
                  title: null,
                  description: null,
                  activities: [],
                  address: null,
                  lat: null,
                  lng: null,
                  tags: []
                },
                author: {
                  userId: profileById.data.author.userId,
                  handle: profileById.data.author.handle,
                  name: profileById.data.author.name,
                  pic: profileById.data.author.profilePic
                },
                social: {
                  likeCount: profileById.data.social.likeCount,
                  commentCount: profileById.data.social.commentCount
                },
                viewer: {
                  liked: profileById.data.social.viewerHasLiked,
                  saved: false
                },
                queryCount: profileById.queryCount,
                readCount: profileById.readCount
              };
            }
          }
          return null;
        }
        const slot = Number(syntheticMatch[1]);
        if (!Number.isFinite(slot) || slot <= 0 || slot > FEED_TOTAL_ITEMS) return null;

        const bundle = await this.detailFirestoreAdapter.getFeedDetailBundle({
          syntheticPostId: postId,
          slot,
          viewerId: vid
        });
        incrementDbOps("queries", bundle.queryCount);
        incrementDbOps("reads", bundle.readCount);
        return bundle;
      } catch (error) {
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("feed_detail_firestore");
        }
        this.detailFirestoreAdapter.markUnavailableBriefly();
        recordFallback("feed_detail_firestore_fallback");
        enforceSourceOfTruthStrictness("feed_detail_firestore");
        if (isStrictSourceOfTruthEnabled()) {
          throw new SourceOfTruthRequiredError("feed_detail_firestore");
        }
        return null;
      } finally {
        this.detailBundleInFlight.delete(key);
      }
    })();

    this.detailBundleInFlight.set(key, promise);
    return promise;
  }
}

function encodeFeedCursor(input: { offset: number; tab: "explore" | "following"; lat?: number; lng?: number; radiusKm?: number }): string {
  const payload = JSON.stringify(input);
  return `fc:v1:${Buffer.from(payload, "utf8").toString("base64url")}`;
}
