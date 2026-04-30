import { randomUUID } from "node:crypto";
import type {
  FeedForYouRepository,
  ForYouCandidate,
  ForYouCursorState,
  ForYouServedWriteRecord,
  ForYouSourceBucket
} from "../../repositories/surfaces/feed-for-you.repository.js";

const CURSOR_PREFIX = "fy:v1:";
const RANKING_VERSION = "for_you_v2_simple_2026_04";

type RankedCandidate = ForYouCandidate & { score: number; sourceBucket: "reel" | "regular" };
type ForYouPostCard = {
  postId: string;
  rankToken: string;
  author: { userId: string; handle: string; name: string | null; pic: string | null };
  activities: string[];
  address: string | null;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  geo: ForYouCandidate["geo"];
  assets: ForYouCandidate["assets"];
  comments: ForYouCandidate["comments"];
  commentsPreview: ForYouCandidate["commentsPreview"];
  title: string | null;
  captionPreview: string | null;
  firstAssetUrl: string | null;
  media: { type: "image" | "video"; posterUrl: string; aspectRatio: number; startupHint: "poster_only" | "poster_then_preview" };
  social: { likeCount: number; commentCount: number };
  viewer: { liked: boolean; saved: boolean };
  createdAtMs: number;
  updatedAtMs: number;
};

export class FeedForYouService {
  constructor(private readonly repository: Pick<FeedForYouRepository, "fetchUnservedReelCandidates" | "fetchUnservedRegularCandidates" | "fetchServedPostIds" | "writeServedPosts">) {}

  async getForYouPage(input: {
    viewerId: string;
    limit: number;
    cursor: string | null;
    debug: boolean;
    requestId?: string;
  }): Promise<{
    requestId: string;
    items: ForYouPostCard[];
    nextCursor: string | null;
    exhausted: boolean;
    debug: {
      requestId: string;
      viewerId: string;
      requestedLimit: number;
      returnedCount: number;
      reelCandidateCount: number;
      regularCandidateCount: number;
      servedWriteCount: number;
      servedWriteOk: boolean;
      sourceMix: { reel: number; regular: number; fallback: number };
      latencyMs: number;
      readEstimate: number;
      rankingVersion: string;
      cursorInfo: ForYouCursorState;
    };
  }> {
    const started = Date.now();
    const viewerId = input.viewerId.trim() || "anonymous";
    const requestId = input.requestId ?? randomUUID();
    const cursor = decodeCursor(input.cursor);
    const oversampleLimit = Math.max(input.limit * 4, 24);
    let scannedReads = 0;
    let rankedReels: RankedCandidate[] = [];
    let rankedRegular: RankedCandidate[] = [];
    let sourceExhausted = false;
    const maxScanWindows = 32;
    for (let scan = 0; scan < maxScanWindows; scan += 1) {
      const windowCursor: ForYouCursorState = {
        page: cursor.page,
        reelOffset: cursor.page * oversampleLimit + scan * oversampleLimit,
        regularOffset: cursor.page * oversampleLimit + scan * oversampleLimit
      };
      const [reelRes, regularRes] = await Promise.all([
        this.repository.fetchUnservedReelCandidates(viewerId, oversampleLimit, windowCursor),
        this.repository.fetchUnservedRegularCandidates(viewerId, oversampleLimit, windowCursor)
      ]);
      scannedReads += reelRes.reads + regularRes.reads;
      const candidateIds = [...reelRes.candidates.map((c) => c.postId), ...regularRes.candidates.map((c) => c.postId)];
      const servedIds = await this.repository.fetchServedPostIds(viewerId, candidateIds);
      rankedReels = rankCandidates(reelRes.candidates.filter((c) => !servedIds.has(c.postId)), viewerId, "reel");
      rankedRegular = rankCandidates(regularRes.candidates.filter((c) => !servedIds.has(c.postId)), viewerId, "regular");
      if (rankedReels.length + rankedRegular.length > 0) break;
      if (!reelRes.hasMore && !regularRes.hasMore) {
        sourceExhausted = true;
        break;
      }
    }
    const picked = mixBuckets(rankedReels, rankedRegular, input.limit);
    const postCards = enforceAuthorDiversity(picked).map((item, index) => toPostCard(item, viewerId, index, requestId));

    const servedWrites: ForYouServedWriteRecord[] = picked.map((item, index) => ({
      postId: item.postId,
      servedAt: Date.now(),
      feedSurface: "home_for_you",
      feedRequestId: requestId,
      rank: index + 1,
      sourceBucket: item.sourceBucket,
      authorId: item.authorId,
      reel: item.reel
    }));
    let servedWriteCount = 0;
    let servedWriteOk = true;
    try {
      servedWriteCount = await this.repository.writeServedPosts(viewerId, servedWrites);
    } catch (error) {
      servedWriteOk = false;
      console.error("[feed-for-you][served-write-failed]", {
        requestId,
        viewerId,
        returnedPostIds: picked.map((item) => item.postId),
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
      });
    }

    const sourceMix = picked.reduce(
      (acc, row) => {
        acc[row.sourceBucket] += 1;
        return acc;
      },
      { reel: 0, regular: 0, fallback: 0 } as Record<ForYouSourceBucket, number>
    );
    const nextCursorState: ForYouCursorState = {
      page: cursor.page + 1,
      reelOffset: (cursor.page + 1) * oversampleLimit,
      regularOffset: (cursor.page + 1) * oversampleLimit
    };
    const exhausted = postCards.length === 0 && sourceExhausted;

    return {
      requestId,
      items: postCards,
      nextCursor: exhausted ? null : encodeCursor(nextCursorState),
      exhausted,
      debug: {
        requestId,
        viewerId,
        requestedLimit: input.limit,
        returnedCount: postCards.length,
        reelCandidateCount: rankedReels.length,
        regularCandidateCount: rankedRegular.length,
        servedWriteCount,
        servedWriteOk,
        sourceMix: {
          reel: sourceMix.reel,
          regular: sourceMix.regular,
          fallback: sourceMix.fallback
        },
        latencyMs: Date.now() - started,
        readEstimate: scannedReads,
        rankingVersion: RANKING_VERSION,
        cursorInfo: nextCursorState
      }
    };
  }
}

function toPostCard(candidate: RankedCandidate, _viewerId: string, idx: number, requestId: string): ForYouPostCard {
  return {
    postId: candidate.postId,
    rankToken: `fy:${requestId.slice(0, 8)}:${idx + 1}`,
    author: {
      userId: candidate.authorId,
      handle: candidate.authorHandle,
      name: candidate.authorName,
      pic: candidate.authorPic
    },
    activities: candidate.activities,
    address: candidate.address,
    carouselFitWidth: candidate.carouselFitWidth,
    layoutLetterbox: candidate.layoutLetterbox,
    letterboxGradientTop: candidate.letterboxGradientTop,
    letterboxGradientBottom: candidate.letterboxGradientBottom,
    letterboxGradients: candidate.letterboxGradients,
    geo: candidate.geo,
    assets: candidate.assets,
    comments: candidate.comments,
    commentsPreview: candidate.commentsPreview,
    title: candidate.title,
    captionPreview: candidate.captionPreview,
    firstAssetUrl: candidate.firstAssetUrl,
    media: {
      type: candidate.mediaType,
      posterUrl: candidate.posterUrl,
      aspectRatio: 9 / 16,
      startupHint: candidate.mediaType === "video" ? "poster_then_preview" : "poster_only"
    },
    social: {
      likeCount: candidate.likeCount,
      commentCount: candidate.commentCount
    },
    viewer: {
      liked: false,
      saved: false
    },
    createdAtMs: candidate.createdAtMs,
    updatedAtMs: candidate.updatedAtMs
  };
}

function rankCandidates(candidates: ForYouCandidate[], viewerId: string, bucket: "reel" | "regular"): RankedCandidate[] {
  const now = Date.now();
  return candidates
    .map((candidate) => {
      const ageHours = Math.max(1, (now - candidate.createdAtMs) / (1000 * 60 * 60));
      const recencyScore = 1000 / ageHours;
      const reelBoost = candidate.reel ? 500 : 0;
      const engagementScore = Math.log10(1 + candidate.likeCount + candidate.commentCount * 2) * 20;
      const tieBreaker = hash(`${viewerId}:${candidate.postId}`) % 1000;
      const sourceBias = bucket === "reel" ? 150 : 20;
      return {
        ...candidate,
        sourceBucket: bucket,
        score: reelBoost + recencyScore + engagementScore + sourceBias + tieBreaker / 1000
      };
    })
    .sort((a, b) => (b.score === a.score ? a.postId.localeCompare(b.postId) : b.score - a.score));
}

function mixBuckets(reels: RankedCandidate[], regular: RankedCandidate[], limit: number): RankedCandidate[] {
  const out: RankedCandidate[] = [];
  let r = 0;
  let n = 0;
  while (out.length < limit && (r < reels.length || n < regular.length)) {
    const pos = out.length + 1;
    const shouldInjectRegular = pos % 6 === 0 || pos % 7 === 0;
    if (shouldInjectRegular && n < regular.length) {
      const nextRegular = regular[n++];
      if (nextRegular) out.push(nextRegular);
      continue;
    }
    if (r < reels.length) {
      const next = reels[r++];
      if (next) out.push(next);
      continue;
    }
    if (n < regular.length) {
      const next = regular[n++];
      if (next) out.push(next);
    }
  }
  return out;
}

function enforceAuthorDiversity(items: RankedCandidate[]): RankedCandidate[] {
  if (items.length < 3) return items;
  const pool = [...items];
  const out: RankedCandidate[] = [];
  while (pool.length > 0) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    const blockedAuthor = last && prev && last.authorId === prev.authorId ? last.authorId : null;
    let pickIdx = pool.findIndex((candidate) => candidate.authorId !== blockedAuthor);
    if (pickIdx < 0) pickIdx = 0;
    const [picked] = pool.splice(pickIdx, 1);
    if (picked) out.push(picked);
  }
  return out;
}

function encodeCursor(state: ForYouCursorState): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(state), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | null): ForYouCursorState {
  if (!cursor) return { page: 0, reelOffset: 0, regularOffset: 0 };
  const normalized = cursor.trim();
  if (!normalized.startsWith("fy:")) throw new Error("invalid_feed_for_you_cursor");
  if (!normalized.startsWith(CURSOR_PREFIX)) throw new Error("unsupported_feed_for_you_cursor_version");
  try {
    const raw = Buffer.from(normalized.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<ForYouCursorState>;
    const page = Number(parsed.page);
    const reelOffset = Number(parsed.reelOffset ?? 0);
    const regularOffset = Number(parsed.regularOffset ?? 0);
    if (![page, reelOffset, regularOffset].every((n) => Number.isFinite(n) && n >= 0)) {
      throw new Error("invalid_feed_for_you_cursor");
    }
    return { page: Math.floor(page), reelOffset: Math.floor(reelOffset), regularOffset: Math.floor(regularOffset) };
  } catch {
    throw new Error("invalid_feed_for_you_cursor");
  }
}

function hash(seed: string): number {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) n = (n * 33 + seed.charCodeAt(i)) >>> 0;
  return n;
}
