import { randomUUID } from "node:crypto";
import type { FeedForYouRepository, ForYouCandidate, ForYouCursorState, ForYouServedWriteRecord, ForYouSourceBucket } from "../../repositories/surfaces/feed-for-you.repository.js";

const CURSOR_PREFIX = "fy:v2:";
const LEGACY_CURSOR_PREFIX = "fy:v1:";
const RANKING_VERSION = "fast-reel-first-v2";
const FIRST_PAGE_BUDGETS = { maxCandidateDocs: 60, maxQueries: 6, maxReadsSoft: 80 } as const;
const NEXT_PAGE_BUDGETS = { maxCandidateDocs: 80, maxQueries: 8, maxReadsSoft: 120 } as const;
type RankedCandidate = ForYouCandidate & { sourceBucket: "reel" | "regular" | "fallback" };
type ForYouPostCard = { postId: string; rankToken: string; author: { userId: string; handle: string; name: string | null; pic: string | null }; activities: string[]; address: string | null; carouselFitWidth?: boolean; layoutLetterbox?: boolean; letterboxGradientTop?: string | null; letterboxGradientBottom?: string | null; letterboxGradients?: Array<{ top: string; bottom: string }>; geo: ForYouCandidate["geo"]; assets: ForYouCandidate["assets"]; comments: ForYouCandidate["comments"]; commentsPreview: ForYouCandidate["commentsPreview"]; title: string | null; captionPreview: string | null; firstAssetUrl: string | null; media: { type: "image" | "video"; posterUrl: string; aspectRatio: number; startupHint: "poster_only" | "poster_then_preview" }; social: { likeCount: number; commentCount: number }; viewer: { liked: boolean; saved: boolean }; createdAtMs: number; updatedAtMs: number };

export class FeedForYouService {
  constructor(private readonly repository: Pick<FeedForYouRepository, "fetchReelWindow" | "fetchRegularWindow" | "fetchServedPostIds" | "writeServedPosts">) {}
  async getForYouPage(input: { viewerId: string; limit: number; cursor: string | null; debug: boolean; requestId?: string }): Promise<{ requestId: string; items: ForYouPostCard[]; nextCursor: string | null; exhausted: boolean; debug: { requestId: string; viewerId: string; requestedLimit: number; returnedCount: number; reelCount: number; regularCount: number; recycledCount: number; candidateWindowSizes: { reels: number; regular: number; regularFallback: number }; servedCheckedCount: number; servedDroppedCount: number; servedWriteCount: number; servedWriteOk: boolean; queryCountEstimate: number; budgetCapped: boolean; latencyMs: number; readEstimate: number; rankingVersion: string; emptyReason: string | null; cursorInfo: ForYouCursorState } }> {
    const started = Date.now();
    const viewerId = input.viewerId.trim() || "anonymous";
    const requestId = input.requestId ?? randomUUID();
    const cursor = decodeCursor(input.cursor);
    const budgets = cursor.page <= 0 ? FIRST_PAGE_BUDGETS : NEXT_PAGE_BUDGETS;
    const reelWindowLimit = Math.min(40, Math.max(input.limit * 3, 12));
    const regularWindowLimit = Math.min(20, Math.max(input.limit + 3, 8));
    const regularFallbackLimit = Math.min(20, Math.max(input.limit + 3, 8));
    let queryCountEstimate = 0;
    let readEstimate = 0;
    let budgetCapped = false;
    const consume = (queries: number, reads: number, candidateDocsFetched: number): boolean => {
      queryCountEstimate += queries;
      readEstimate += reads;
      if (queryCountEstimate >= budgets.maxQueries || readEstimate >= budgets.maxReadsSoft || candidateDocsFetched >= budgets.maxCandidateDocs) {
        budgetCapped = true;
        return false;
      }
      return true;
    };
    const reelRes = await this.repository.fetchReelWindow({ limit: reelWindowLimit, cursorTime: cursor.reelCursorTime, cursorPostId: cursor.reelCursorPostId });
    const reels = reelRes.candidates;
    consume(reelRes.queries, reelRes.reads, reels.length);
    let regular: ForYouCandidate[] = [];
    let regularHasMore = false;
    if (!budgetCapped) {
      const regularRes = await this.repository.fetchRegularWindow({ limit: regularWindowLimit, cursorTime: cursor.regularCursorTime, cursorPostId: cursor.regularCursorPostId });
      regular = regularRes.candidates;
      regularHasMore = regularRes.hasMore;
      consume(regularRes.queries, regularRes.reads, reels.length + regular.length);
    }
    const initialCandidates = dedupeByPostId([...reels, ...regular]);
    const initialServed = await this.repository.fetchServedPostIds(viewerId, initialCandidates.map((c) => c.postId));
    const servedAll = new Set(initialServed);
    queryCountEstimate += Math.ceil(initialCandidates.length / 30);
    readEstimate += initialCandidates.length;
    let servedCheckedCount = initialCandidates.length;
    let servedDroppedCount = initialCandidates.filter((c) => initialServed.has(c.postId)).length;
    const unseenReels = reels.filter((c) => !initialServed.has(c.postId)).map((row) => ({ ...row, sourceBucket: "reel" as const }));
    const unseenRegular = regular.filter((c) => !initialServed.has(c.postId)).map((row) => ({ ...row, sourceBucket: "regular" as const }));
    let fallbackRegular: ForYouCandidate[] = [];
    let picked = mixBuckets(unseenReels, unseenRegular, input.limit);
    if (picked.length < input.limit && !budgetCapped) {
      const lastRegular = regular[regular.length - 1];
      const fallbackRes = await this.repository.fetchRegularWindow({ limit: regularFallbackLimit, cursorTime: lastRegular?.createdAtMs ?? cursor.regularCursorTime, cursorPostId: lastRegular?.postId ?? cursor.regularCursorPostId });
      fallbackRegular = fallbackRes.candidates;
      consume(fallbackRes.queries, fallbackRes.reads, reels.length + regular.length + fallbackRegular.length);
      const fallbackServed = await this.repository.fetchServedPostIds(viewerId, fallbackRegular.map((c) => c.postId));
      for (const postId of fallbackServed) servedAll.add(postId);
      queryCountEstimate += Math.ceil(fallbackRegular.length / 30);
      readEstimate += fallbackRegular.length;
      servedCheckedCount += fallbackRegular.length;
      servedDroppedCount += fallbackRegular.filter((c) => fallbackServed.has(c.postId)).length;
      const unseenFallback = fallbackRegular.filter((c) => !fallbackServed.has(c.postId)).map((row) => ({ ...row, sourceBucket: "regular" as const }));
      picked = mixBuckets(unseenReels, dedupeRanked([...unseenRegular, ...unseenFallback]), input.limit);
    }
    if (picked.length < input.limit) {
      picked = [...picked, ...buildRecyclePool([...reels, ...regular, ...fallbackRegular], picked.map((p) => p.postId), servedAll, input.limit - picked.length)];
    }
    picked = dedupeRanked(picked).slice(0, input.limit);
    const postCards = enforceAuthorDiversity(picked).map((item, index) => toPostCard(item, viewerId, index, requestId));
    const servedWrites: ForYouServedWriteRecord[] = picked.map((item, index) => ({ postId: item.postId, servedAt: Date.now(), feedSurface: "home_for_you", feedRequestId: requestId, rank: index + 1, sourceBucket: item.sourceBucket, authorId: item.authorId, reel: item.reel }));
    let servedWriteCount = 0;
    let servedWriteOk = true;
    try {
      servedWriteCount = await this.repository.writeServedPosts(viewerId, servedWrites);
    } catch (error) {
      servedWriteOk = false;
      console.error("[feed-for-you][served-write-failed]", { requestId, viewerId, returnedPostIds: picked.map((item) => item.postId), error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) });
    }
    const sourceMix = picked.reduce((acc, row) => { acc[row.sourceBucket] += 1; return acc; }, { reel: 0, regular: 0, fallback: 0 } as Record<ForYouSourceBucket, number>);
    const lastReel = reels[reels.length - 1];
    const allRegular = [...regular, ...fallbackRegular];
    const lastRegular = allRegular[allRegular.length - 1];
    const nextCursorState: ForYouCursorState = { page: cursor.page + 1, reelCursorTime: lastReel?.createdAtMs ?? cursor.reelCursorTime, reelCursorPostId: lastReel?.postId ?? cursor.reelCursorPostId, regularCursorTime: lastRegular?.createdAtMs ?? cursor.regularCursorTime, regularCursorPostId: lastRegular?.postId ?? cursor.regularCursorPostId, recycleMode: sourceMix.fallback > 0 };
    const exhausted = postCards.length === 0 && !reelRes.hasMore && !regularHasMore;
    return { requestId, items: postCards, nextCursor: exhausted ? null : encodeCursor(nextCursorState), exhausted, debug: { requestId, viewerId, requestedLimit: input.limit, returnedCount: postCards.length, reelCount: sourceMix.reel, regularCount: sourceMix.regular, recycledCount: sourceMix.fallback, candidateWindowSizes: { reels: reels.length, regular: regular.length, regularFallback: fallbackRegular.length }, servedCheckedCount, servedDroppedCount, servedWriteCount, servedWriteOk, queryCountEstimate, budgetCapped, latencyMs: Date.now() - started, readEstimate, rankingVersion: RANKING_VERSION, emptyReason: postCards.length > 0 ? null : exhausted ? "no_eligible_visible_posts" : "budget_or_cursor_exhausted", cursorInfo: nextCursorState } };
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
  if (!cursor) return { page: 0, reelCursorTime: null, reelCursorPostId: null, regularCursorTime: null, regularCursorPostId: null, recycleMode: false };
  const normalized = cursor.trim();
  if (!normalized.startsWith("fy:")) throw new Error("invalid_feed_for_you_cursor");
  if (normalized.startsWith(LEGACY_CURSOR_PREFIX)) {
    return { page: 0, reelCursorTime: null, reelCursorPostId: null, regularCursorTime: null, regularCursorPostId: null, recycleMode: false };
  }
  if (!normalized.startsWith(CURSOR_PREFIX)) throw new Error("unsupported_feed_for_you_cursor_version");
  try {
    const raw = Buffer.from(normalized.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<ForYouCursorState>;
    const page = Number(parsed.page);
    if (!Number.isFinite(page) || page < 0) throw new Error("invalid_feed_for_you_cursor");
    const reelCursorTime = parsed.reelCursorTime == null ? null : Number(parsed.reelCursorTime);
    const regularCursorTime = parsed.regularCursorTime == null ? null : Number(parsed.regularCursorTime);
    return { page: Math.floor(page), reelCursorTime: Number.isFinite(reelCursorTime) ? reelCursorTime : null, reelCursorPostId: typeof parsed.reelCursorPostId === "string" ? parsed.reelCursorPostId : null, regularCursorTime: Number.isFinite(regularCursorTime) ? regularCursorTime : null, regularCursorPostId: typeof parsed.regularCursorPostId === "string" ? parsed.regularCursorPostId : null, recycleMode: parsed.recycleMode === true };
  } catch {
    throw new Error("invalid_feed_for_you_cursor");
  }
}

function dedupeByPostId(candidates: ForYouCandidate[]): ForYouCandidate[] {
  const seen = new Set<string>();
  const out: ForYouCandidate[] = [];
  for (const row of candidates) {
    if (seen.has(row.postId)) continue;
    seen.add(row.postId);
    out.push(row);
  }
  return out;
}

function dedupeRanked(candidates: RankedCandidate[]): RankedCandidate[] {
  const seen = new Set<string>();
  const out: RankedCandidate[] = [];
  for (const row of candidates) {
    if (seen.has(row.postId)) continue;
    seen.add(row.postId);
    out.push(row);
  }
  return out;
}

function buildRecyclePool(allCandidates: ForYouCandidate[], alreadyPickedIds: string[], served: Set<string>, needed: number): RankedCandidate[] {
  if (needed <= 0) return [];
  const picked = new Set(alreadyPickedIds);
  return allCandidates
    .filter((c) => served.has(c.postId))
    .filter((c) => !picked.has(c.postId))
    .sort((a, b) => (a.createdAtMs === b.createdAtMs ? a.postId.localeCompare(b.postId) : a.createdAtMs - b.createdAtMs))
    .slice(0, needed)
    .map((row) => ({ ...row, sourceBucket: "fallback" as const }));
}
