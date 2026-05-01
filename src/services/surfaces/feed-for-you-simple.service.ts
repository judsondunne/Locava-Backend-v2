import { randomBytes } from "node:crypto";
import { toFeedCardDTO, type FeedCardDTO } from "../../dto/compact-surface-dto.js";
import type { FeedForYouSimpleRepository, SimpleFeedCandidate, SimpleFeedSortMode } from "../../repositories/surfaces/feed-for-you-simple.repository.js";

const CURSOR_PREFIX = "fys:v1:";
const MAX_SEEN_IDS = 50;
const MAX_BATCHES = 6;

type FeedForYouSimpleCursor = {
  v: 1;
  mode: SimpleFeedSortMode;
  anchor: number | string;
  wrapped: boolean;
  lastValue: number | string | null;
  seen: string[];
};

export class FeedForYouSimpleService {
  constructor(
    private readonly repository: Pick<FeedForYouSimpleRepository, "isEnabled" | "resolveSortMode" | "fetchBatch">
  ) {}

  async getPage(input: {
    viewerId: string;
    limit: number;
    cursor: string | null;
  }): Promise<{
    routeName: "feed.for_you_simple.get";
    items: FeedCardDTO[];
    nextCursor: string | null;
    debug: {
      source: "firestore_random_simple";
      requestedLimit: number;
      returnedCount: number;
      cursorUsed: boolean;
      randomSeedOrAnchor: string;
    };
  }> {
    if (!this.repository.isEnabled()) {
      throw new Error("feed_for_you_simple_source_unavailable");
    }

    const limit = Math.max(1, Math.min(10, Math.floor(input.limit || 5)));
    const cursorState = decodeCursor(input.cursor);
    const mode = cursorState?.mode ?? (await this.repository.resolveSortMode());
    const anchor = cursorState?.anchor ?? (mode === "randomKey" ? Math.random() : createDocIdAnchor());
    const seen = new Set((cursorState?.seen ?? []).filter(Boolean).slice(-MAX_SEEN_IDS));
    const items: SimpleFeedCandidate[] = [];
    let wrapped = cursorState?.wrapped ?? false;
    let lastValue = cursorState?.lastValue ?? null;
    let batches = 0;
    let exhaustedAllSegments = false;

    while (items.length < limit && batches < MAX_BATCHES) {
      const scanLimit = Math.max(10, Math.min(30, (limit - items.length) * 3));
      const batch = await this.repository.fetchBatch({
        mode,
        anchor,
        wrapped,
        lastValue,
        limit: scanLimit
      });
      batches += 1;
      for (const candidate of batch.items) {
        if (seen.has(candidate.postId)) continue;
        seen.add(candidate.postId);
        items.push(candidate);
        lastValue = candidate.sortValue;
        if (items.length >= limit) break;
      }

      if (items.length >= limit) break;

      if (batch.segmentExhausted || batch.rawCount === 0) {
        if (!wrapped) {
          wrapped = true;
          lastValue = null;
          continue;
        }
        exhaustedAllSegments = true;
        break;
      }
    }

    const nextCursor =
      items.length === 0 && exhaustedAllSegments
        ? null
        : items.length === 0
          ? null
          : encodeCursor({
              v: 1,
              mode,
              anchor,
              wrapped,
              lastValue,
              seen: [...seen].slice(-MAX_SEEN_IDS)
            });

    return {
      routeName: "feed.for_you_simple.get",
      items: items.map((candidate, index) => toPostCard(candidate, index, input.viewerId)),
      nextCursor,
      debug: {
        source: "firestore_random_simple",
        requestedLimit: limit,
        returnedCount: items.length,
        cursorUsed: Boolean(input.cursor),
        randomSeedOrAnchor: mode === "randomKey" ? String(anchor) : `doc:${String(anchor)}`
      }
    };
  }
}

function toPostCard(candidate: SimpleFeedCandidate, index: number, viewerId: string): FeedCardDTO {
  return toFeedCardDTO({
    postId: candidate.postId,
    rankToken: `fys:${viewerId.slice(0, 8) || "anon"}:${index + 1}`,
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
    title: candidate.title,
    captionPreview: candidate.captionPreview,
    firstAssetUrl: candidate.firstAssetUrl,
    media: {
      type: candidate.mediaType,
      posterUrl: candidate.posterUrl,
      aspectRatio: candidate.assets[0]?.aspectRatio ?? 9 / 16,
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
  });
}

function encodeCursor(cursor: FeedForYouSimpleCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | null): FeedForYouSimpleCursor | null {
  if (!cursor) return null;
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error("invalid_simple_feed_cursor");
  try {
    const parsed = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8")) as FeedForYouSimpleCursor;
    if (parsed.v !== 1) throw new Error("version");
    if (parsed.mode !== "randomKey" && parsed.mode !== "docId") throw new Error("mode");
    if (!Array.isArray(parsed.seen)) throw new Error("seen");
    if (parsed.mode === "randomKey") {
      const anchor = typeof parsed.anchor === "number" ? parsed.anchor : Number(parsed.anchor);
      if (!Number.isFinite(anchor)) throw new Error("anchor");
      if (parsed.lastValue != null && !Number.isFinite(Number(parsed.lastValue))) throw new Error("lastValue");
      return {
        ...parsed,
        anchor,
        lastValue: parsed.lastValue == null ? null : Number(parsed.lastValue),
        seen: parsed.seen.map((value) => String(value)).filter(Boolean).slice(-MAX_SEEN_IDS)
      };
    }
    const anchor = typeof parsed.anchor === "string" ? parsed.anchor.trim() : "";
    if (!anchor) throw new Error("anchor");
    return {
      ...parsed,
      anchor,
      lastValue: typeof parsed.lastValue === "string" && parsed.lastValue.trim() ? parsed.lastValue.trim() : null,
      seen: parsed.seen.map((value) => String(value)).filter(Boolean).slice(-MAX_SEEN_IDS)
    };
  } catch {
    throw new Error("invalid_simple_feed_cursor");
  }
}

function createDocIdAnchor(): string {
  return randomBytes(10).toString("hex");
}
