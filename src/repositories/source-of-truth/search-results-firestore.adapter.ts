import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  type SearchActivityIntent,
  extractResidualTokens,
  normalizeSearchText,
  parseSearchQueryIntent,
  resolveStateNameFromAny,
} from "../../lib/search-query-intent.js";
import { searchPlacesIndexService } from "../../services/surfaces/search-places-index.service.js";
import { getFirestoreSourceClient } from "./firestore-client.js";

export type FirestoreSearchResultCandidate = {
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

export type FirestoreSearchResultsPage = {
  items: FirestoreSearchResultCandidate[];
  hasMore: boolean;
  nextCursor: string | null;
  queryCount: number;
  readCount: number;
};

type SearchablePost = {
  postId: string;
  userId: string;
  userHandle: string;
  userName: string;
  userPic: string | null;
  updatedAtMs: number;
  activities: string[];
  title: string;
  caption: string;
  description: string;
  thumbUrl: string;
  displayPhotoLink: string;
  mediaType: "image" | "video";
  stateRegionId: string | null;
  cityRegionId: string | null;
  lat: number | null;
  lng: number | null;
  likeCount: number;
  commentCount: number;
};

const MAX_PER_QUERY = 8;
const POST_SELECT_FIELDS = [
  "userId",
  "userHandle",
  "userName",
  "userPic",
  "updatedAtMs",
  "createdAtMs",
  "time",
  "activities",
  "title",
  "caption",
  "description",
  "thumbUrl",
  "displayPhotoLink",
  "photoLink",
  "mediaType",
  "stateRegionId",
  "cityRegionId",
  "lat",
  "lng",
  "long",
  "likeCount",
  "likesCount",
  "commentCount",
  "commentsCount",
] as const;

export class SearchResultsFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly FIRESTORE_TIMEOUT_MS = 1_200;

  isEnabled(): boolean {
    return this.db !== null;
  }

  async searchResultsPage(input: {
    viewerId: string;
    query: string;
    cursorOffset: number;
    limit: number;
    lat: number | null;
    lng: number | null;
  }): Promise<FirestoreSearchResultsPage> {
    if (!this.db) {
      throw new Error("firestore_source_unavailable");
    }
    const { query, cursorOffset, limit, lat, lng } = input;
    const safeLimit = Math.max(1, Math.min(limit, 12));
    const intent = parseSearchQueryIntent(query, (normalizedQuery) =>
      resolveIntentPlace(normalizedQuery)
    );
    const viewerCoords =
      typeof lat === "number" &&
      Number.isFinite(lat) &&
      typeof lng === "number" &&
      Number.isFinite(lng)
        ? { lat, lng }
        : null;

    const collected = new Map<string, SearchablePost>();
    let queryCount = 0;
    let readCount = 0;

    const addDocs = (docs: QueryDocumentSnapshot[]): void => {
      queryCount += 1;
      readCount += docs.length;
      for (const doc of docs) {
        if (!collected.has(doc.id)) {
          collected.set(doc.id, mapDoc(doc));
        }
      }
    };

    const perQueryLimit = Math.min(MAX_PER_QUERY, Math.max(4, safeLimit));
    const activityTerms = intent.activity?.queryActivities.slice(0, 1) ?? [];
    const fetches: Array<Promise<QueryDocumentSnapshot[]>> = [];
    const shouldRunRecentQuery =
      intent.nearMe ||
      (activityTerms.length === 0 && !intent.location?.cityRegionId && !intent.location?.stateRegionId);

    if (!shouldRunRecentQuery) {
      for (const activity of activityTerms) {
        fetches.push(
          withTimeout(
            this.db
              .collection("posts")
              .where("activities", "array-contains", activity)
              .select(...POST_SELECT_FIELDS)
              .limit(perQueryLimit)
              .get()
              .then((snap) => snap.docs),
            SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "search-results-firestore-activity-query"
          )
        );
      }

      if (intent.location?.cityRegionId) {
        fetches.push(
          withTimeout(
            this.db
              .collection("posts")
              .where("cityRegionId", "==", intent.location.cityRegionId)
              .select(...POST_SELECT_FIELDS)
              .limit(perQueryLimit)
              .get()
              .then((snap) => snap.docs),
            SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "search-results-firestore-city-query"
          )
        );
      } else if (intent.location?.stateRegionId) {
        fetches.push(
          withTimeout(
            this.db
              .collection("posts")
              .where("stateRegionId", "==", intent.location.stateRegionId)
              .select(...POST_SELECT_FIELDS)
              .limit(perQueryLimit)
              .get()
              .then((snap) => snap.docs),
            SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "search-results-firestore-state-query"
          )
        );
      }
    }

    if (shouldRunRecentQuery) {
      fetches.push(
        withTimeout(
          this.db
            .collection("posts")
            .orderBy("time", "desc")
            .select(...POST_SELECT_FIELDS)
            .limit(intent.nearMe ? Math.max(14, safeLimit * 2) : Math.max(8, safeLimit + 1))
            .get()
            .then((snap) => snap.docs),
          SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
          "search-results-firestore-recent-query"
        )
      );
    }

    const settled = await Promise.allSettled(fetches);
    let sawAny = false;
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      sawAny = true;
      addDocs(result.value);
    }
    if (!sawAny) {
      try {
        const fallbackDocs = await withTimeout(
          this.db
            .collection("posts")
            .orderBy("time", "desc")
            .select(...POST_SELECT_FIELDS)
            .limit(Math.max(10, safeLimit * 2))
            .get()
            .then((snap) => snap.docs),
          SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
          "search-results-firestore-fallback-recent-query"
        );
        if (fallbackDocs.length > 0) {
          sawAny = true;
          addDocs(fallbackDocs);
        }
      } catch {
        // keep strict failure below if fallback recent query also fails
      }
    }
    if (!sawAny) {
      throw new Error("search-results-firestore-query_timeout");
    }

    const ranked = [...collected.values()]
      .map((post) => ({
        postId: post.postId,
        rank: scoreCandidate(post, intent.activity, intent.location, query, intent.nearMe, viewerCoords),
        userId: post.userId,
        userHandle: post.userHandle,
        userName: post.userName,
        userPic: post.userPic,
        activities: post.activities,
        title: post.title,
        thumbUrl: post.thumbUrl,
        displayPhotoLink: post.displayPhotoLink,
        mediaType: post.mediaType,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        updatedAtMs: post.updatedAtMs,
      }))
      .filter((row) => Number.isFinite(row.rank))
      .sort((a, b) => a.rank - b.rank || a.postId.localeCompare(b.postId));

    if (cursorOffset >= ranked.length) {
      return {
        items: [],
        hasMore: false,
        nextCursor: null,
        queryCount,
        readCount,
      };
    }

    const endExclusive = Math.min(ranked.length, cursorOffset + safeLimit);
    return {
      items: ranked.slice(cursorOffset, endExclusive),
      hasMore: endExclusive < ranked.length,
      nextCursor: endExclusive < ranked.length ? `cursor:${endExclusive}` : null,
      queryCount,
      readCount,
    };
  }
}

function resolveIntentPlace(normalizedQuery: string) {
  const exactStateName = resolveStateNameFromAny(normalizedQuery);
  if (exactStateName && normalizeSearchText(exactStateName) === normalizedQuery) {
    return null;
  }
  return (
    searchPlacesIndexService.searchExact(normalizedQuery) ??
    searchPlacesIndexService.search(normalizedQuery, 1)[0] ??
    null
  );
}

function mapDoc(doc: QueryDocumentSnapshot): SearchablePost {
  const data = doc.data() as Record<string, unknown>;
  const updatedAtMs = Number(data.updatedAtMs ?? data.createdAtMs ?? data.time ?? 0);
  const lat = Number(data.lat ?? NaN);
  const lng = Number(data.lng ?? data.long ?? NaN);
  return {
    postId: doc.id,
    userId: String(data.userId ?? "").trim(),
    userHandle: String(data.userHandle ?? "").trim(),
    userName: String(data.userName ?? "").trim(),
    userPic: typeof data.userPic === "string" && data.userPic.trim() ? data.userPic.trim() : null,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    activities: Array.isArray(data.activities) ? data.activities.map((value) => String(value ?? "").trim()).filter(Boolean) : [],
    title: String(data.title ?? "").trim(),
    caption: String(data.caption ?? "").trim(),
    description: String(data.description ?? "").trim(),
    thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim(),
    displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "").trim(),
    mediaType: String(data.mediaType ?? "").toLowerCase() === "video" ? "video" : "image",
    stateRegionId: String(data.stateRegionId ?? "").trim() || null,
    cityRegionId: String(data.cityRegionId ?? "").trim() || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    likeCount: Number(data.likeCount ?? data.likesCount ?? 0) || 0,
    commentCount: Number(data.commentCount ?? data.commentsCount ?? 0) || 0,
  };
}

function activityMatchScore(post: SearchablePost, activity: SearchActivityIntent | null): number {
  if (!activity) return 0;
  const postActivities = post.activities.map((value) => normalizeSearchText(value).replace(/\s+/g, ""));
  let score = 0;
  for (const queryActivity of activity.queryActivities) {
    const key = normalizeSearchText(queryActivity).replace(/\s+/g, "");
    if (postActivities.some((candidate) => candidate === key || candidate.includes(key) || key.includes(candidate))) {
      score += 32;
    }
  }
  if (score === 0 && postActivities.length > 20) {
    return -40;
  }
  return score;
}

function textMatchScore(post: SearchablePost, query: string): number {
  const normalizedQuery = normalizeSearchText(query);
  const residual = extractResidualTokens(query);
  const corpus = normalizeSearchText(`${post.title} ${post.caption} ${post.description}`);
  let score = 0;
  if (normalizedQuery && corpus.includes(normalizedQuery)) score += 18;
  for (const token of residual) {
    if (corpus.includes(token)) score += 8;
  }
  return score;
}

function locationMatchScore(
  post: SearchablePost,
  location: { cityRegionId: string | null; stateRegionId: string | null } | null,
): number {
  if (!location) return 0;
  if (location.cityRegionId && post.cityRegionId === location.cityRegionId) return 28;
  if (location.stateRegionId && post.stateRegionId === location.stateRegionId) return 18;
  return -12;
}

function locationMatches(
  post: SearchablePost,
  location: { cityRegionId: string | null; stateRegionId: string | null } | null,
): boolean {
  return locationMatchScore(post, location) >= 0;
}

function scoreCandidate(
  post: SearchablePost,
  activity: SearchActivityIntent | null,
  location: { cityRegionId: string | null; stateRegionId: string | null } | null,
  query: string,
  nearMe: boolean,
  viewerCoords: { lat: number; lng: number } | null,
): number {
  const activityScore = activityMatchScore(post, activity);
  const locationScore = locationMatchScore(post, location);
  const textScore = textMatchScore(post, query);
  const socialScore = Math.min(8, post.likeCount / 10) + Math.min(4, post.commentCount / 5);
  const distanceScore = nearMe ? computeDistanceScore(post, viewerCoords) : 0;
  const freshnessPenalty = post.updatedAtMs > 0 ? Math.floor(post.updatedAtMs / 1000) : 0;
  const total = activityScore + locationScore + textScore + socialScore + distanceScore;
  if (activity && activityScore <= 0 && textScore <= 0) return Number.POSITIVE_INFINITY;
  if (location && locationScore < 0 && total < 12) return Number.POSITIVE_INFINITY;
  if (total <= 0) return Number.POSITIVE_INFINITY;
  return 1_000_000_000 - total * 1000 - freshnessPenalty;
}

function computeDistanceScore(
  post: SearchablePost,
  viewerCoords: { lat: number; lng: number } | null,
): number {
  if (!viewerCoords || post.lat == null || post.lng == null) return 0;
  const miles = distanceMiles(viewerCoords, { lat: post.lat, lng: post.lng });
  if (!Number.isFinite(miles)) return 0;
  if (miles <= 5) return 18;
  if (miles <= 15) return 12;
  if (miles <= 30) return 7;
  if (miles <= 60) return 3;
  return -6;
}

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy) * 69;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}
