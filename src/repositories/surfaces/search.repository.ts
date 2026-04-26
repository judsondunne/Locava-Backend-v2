import { incrementDbOps } from "../../observability/request-context.js";
import { recordFallback, recordTimeout } from "../../observability/request-context.js";
import { SearchResultsFirestoreAdapter } from "../source-of-truth/search-results-firestore.adapter.js";
import { enforceSourceOfTruthStrictness, SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export type SearchResultCandidateRecord = {
  postId: string;
  rank: number;
  userId: string;
  userHandle: string;
  userName: string;
  userPic: string | null;
  activities: string[];
  title: string;
  thumbUrl: string;
  displayPhotoLink: string;
  mediaType: "image" | "video";
  likeCount: number;
  commentCount: number;
  updatedAtMs: number;
};

export type SearchResultsPageRecord = {
  query: string;
  cursorIn: string | null;
  items: SearchResultCandidateRecord[];
  hasMore: boolean;
  nextCursor: string | null;
};

const SEARCH_TOTAL_RESULTS_CAP = 96;

function seeded(seed: string): number {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) {
    n = (n + seed.charCodeAt(i) * (i + 23)) % 1_000_003;
  }
  return n;
}

export class SearchRepository {
  constructor(private readonly firestoreAdapter: SearchResultsFirestoreAdapter = new SearchResultsFirestoreAdapter()) {}

  parseCursor(cursor: string | null): number {
    if (!cursor) return 0;
    const match = /^cursor:(\d+)$/.exec(cursor.trim());
    if (!match) {
      throw new Error("invalid_search_cursor");
    }
    const offset = Number(match[1]);
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error("invalid_search_cursor");
    }
    return Math.floor(offset);
  }

  async getSearchResultsPage(input: {
    viewerId: string;
    query: string;
    cursor: string | null;
    limit: number;
    lat: number | null;
    lng: number | null;
  }): Promise<SearchResultsPageRecord> {
    const { viewerId, query, cursor, limit, lat, lng } = input;
    const normalized = query.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(limit, 12));
    const offset = this.parseCursor(cursor);

    if (this.firestoreAdapter.isEnabled()) {
      try {
        const page = await this.firestoreAdapter.searchResultsPage({
          viewerId,
          query: normalized,
          cursorOffset: offset,
          limit: safeLimit,
          lat,
          lng
        });
        incrementDbOps("queries", page.queryCount);
        incrementDbOps("reads", page.readCount);
        return {
          query: normalized,
          cursorIn: cursor,
          items: page.items,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("search_results_firestore");
        }
        recordFallback("search_results_firestore_fallback");
        enforceSourceOfTruthStrictness("search_results_firestore");
        throw new SourceOfTruthRequiredError("search_results_firestore");
      }
    }
    enforceSourceOfTruthStrictness("search_results_firestore_unavailable");
    throw new SourceOfTruthRequiredError("search_results_firestore_unavailable");
  }
}
