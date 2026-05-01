import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
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
  debug?: Record<string, unknown>;
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
  geohash: string | null;
  address: string | null;
  assets: unknown[] | null;
  likeCount: number;
  commentCount: number;
};

function normalizeRegionId(id: string | null): string | null {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  // Support both legacy "US-Vermont-Burlington" and "us:vermont:burlington" styles.
  if (raw.includes(":")) return raw.toLowerCase();
  if (raw.includes("-")) return raw.replace(/[^a-z0-9]+/gi, ":").replace(/^:+|:+$/g, "").toLowerCase();
  return raw.toLowerCase();
}

const MAX_PER_QUERY = 72;
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
  "assets",
  "stateRegionId",
  "cityRegionId",
  "lat",
  "lng",
  "long",
  "geohash",
  "address",
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
    includeDebug?: boolean;
  }): Promise<FirestoreSearchResultsPage> {
    if (!this.db) {
      throw new Error("firestore_source_unavailable");
    }
    const { query, cursorOffset, limit, lat, lng, includeDebug = false } = input;
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

    const activityKeys = intent.activity?.queryActivities?.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean) ?? [];
    const hasActivity = activityKeys.length > 0;
    const location = intent.location;
    const hasLocation = Boolean(location?.cityRegionId || location?.stateRegionId);
    const wantsNearMe = Boolean(intent.nearMe);
    const hasViewerCoords = viewerCoords != null;
    const cursorSafe = Math.max(0, Math.floor(cursorOffset));

    // For offset paging to be meaningful, we must fetch a pool bigger than one page.
    // Keep bounded but grow with cursorOffset so later pages can still be truthful.
    const poolTarget = Math.min(900, Math.max(160, cursorSafe + safeLimit + 140));
    const perQueryLimit = Math.min(MAX_PER_QUERY, Math.max(18, Math.ceil(poolTarget / 2)));

    const fetches: Array<{ label: string; promise: Promise<QueryDocumentSnapshot[]> }> = [];

    const pushFetch = (label: string, promise: Promise<QueryDocumentSnapshot[]>) => {
      fetches.push({ label, promise });
    };

    // Stage A: structured candidate queries (activity, location). These are OR'd at the fetch layer,
    // then we enforce strict AND filtering downstream when both intents exist.
    //
    // IMPORTANT: A bare `array-contains` activity query without orderBy returns an arbitrary bounded subset.
    // For activity+location queries, always fetch explicit intersections (activity ∧ region) so matching posts
    // are not missing from the candidate pool (which previously triggered unsafe relaxations).
    const intersectLimit = Math.min(900, Math.max(perQueryLimit, poolTarget));
    if (hasActivity && hasLocation) {
      const acts = activityKeys.slice(0, 2);
      if (location?.cityRegionId) {
        const raw = String(location.cityRegionId ?? "").trim() || null;
        const normalized = normalizeRegionId(raw);
        const cityIds = [...new Set([raw, normalized].filter(Boolean) as string[])];
        for (const activity of acts) {
          for (const cityRegionId of cityIds) {
            pushFetch(
              `intersect:activity+city:${activity}:${cityRegionId}`,
              withTimeout(
                this.db
                  .collection("posts")
                  .where("activities", "array-contains", activity)
                  .where("cityRegionId", "==", cityRegionId)
                  .orderBy("time", "desc")
                  .orderBy(FieldPath.documentId(), "desc")
                  .select(...POST_SELECT_FIELDS)
                  .limit(intersectLimit)
                  .get()
                  .then((snap) => snap.docs),
                SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
                "search-results-firestore-intersect-city"
              )
            );
          }
        }
      } else if (location?.stateRegionId) {
        const raw = String(location.stateRegionId ?? "").trim() || null;
        const normalized = normalizeRegionId(raw);
        const stateIds = [...new Set([raw, normalized].filter(Boolean) as string[])];
        for (const activity of acts) {
          for (const stateRegionId of stateIds) {
            pushFetch(
              `intersect:activity+state:${activity}:${stateRegionId}`,
              withTimeout(
                this.db
                  .collection("posts")
                  .where("activities", "array-contains", activity)
                  .where("stateRegionId", "==", stateRegionId)
                  .orderBy("time", "desc")
                  .orderBy(FieldPath.documentId(), "desc")
                  .select(...POST_SELECT_FIELDS)
                  .limit(intersectLimit)
                  .get()
                  .then((snap) => snap.docs),
                SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
                "search-results-firestore-intersect-state"
              )
            );
          }
        }
      }
    } else if (hasActivity) {
      for (const activity of activityKeys.slice(0, 2)) {
        pushFetch(
          `activity:${activity}`,
          withTimeout(
            this.db
              .collection("posts")
              .where("activities", "array-contains", activity)
              .orderBy("time", "desc")
              .orderBy(FieldPath.documentId(), "desc")
              .select(...POST_SELECT_FIELDS)
              .limit(perQueryLimit)
              .get()
              .then((snap) => snap.docs),
            SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "search-results-firestore-activity-query"
          )
        );
      }
    }

    if (intent.location?.cityRegionId) {
      const raw = String(intent.location.cityRegionId ?? "").trim() || null;
      const normalized = normalizeRegionId(raw);
      const ids = [...new Set([raw, normalized].filter(Boolean) as string[])];
      for (const cityRegionId of ids) {
        pushFetch(
          `city:${cityRegionId}`,
          withTimeout(
            this.db
              .collection("posts")
              .where("cityRegionId", "==", cityRegionId)
              .orderBy("time", "desc")
              .orderBy(FieldPath.documentId(), "desc")
              .select(...POST_SELECT_FIELDS)
              .limit(Math.max(perQueryLimit, Math.min(160, poolTarget)))
              .get()
              .then((snap) => snap.docs),
            SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "search-results-firestore-city-query"
          )
        );
      }
    } else if (intent.location?.stateRegionId) {
      const raw = String(intent.location.stateRegionId ?? "").trim() || null;
      const normalized = normalizeRegionId(raw);
      const ids = [...new Set([raw, normalized].filter(Boolean) as string[])];
      for (const stateRegionId of ids) {
        pushFetch(
          `state:${stateRegionId}`,
          withTimeout(
            this.db
              .collection("posts")
              .where("stateRegionId", "==", stateRegionId)
              .orderBy("time", "desc")
              .orderBy(FieldPath.documentId(), "desc")
              .select(...POST_SELECT_FIELDS)
              .limit(Math.max(perQueryLimit, Math.min(220, poolTarget)))
              .get()
              .then((snap) => snap.docs),
            SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
            "search-results-firestore-state-query"
          )
        );
      }
    }

    // Stage B: near-me needs a recency pool + strict distance filtering.
    // Never treat "near me" as global unless we explicitly relax and surface debug.
    const needRecentPool =
      wantsNearMe ||
      (!hasActivity && !hasLocation) ||
      (hasLocation && !hasActivity) ||
      (hasActivity && !hasLocation) ||
      // Safety net: activity+location queries must still have a candidate pool even if
      // composite intersection indexes are missing/unavailable in a given environment.
      (hasActivity && hasLocation);
    if (needRecentPool) {
      const recentLimit = wantsNearMe ? Math.max(240, poolTarget) : Math.max(120, Math.min(260, poolTarget));
      pushFetch(
        `recent:${recentLimit}`,
        withTimeout(
          this.db
            .collection("posts")
            .orderBy("time", "desc")
            .select(...POST_SELECT_FIELDS)
            .limit(recentLimit)
            .get()
            .then((snap) => snap.docs),
          SearchResultsFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
          "search-results-firestore-recent-query"
        )
      );
    }

    const settled = await Promise.allSettled(fetches.map((row) => row.promise));
    const fetchSummary: Array<{ label: string; ok: boolean; docs: number }> = [];
    let sawAny = false;
    for (let i = 0; i < settled.length; i += 1) {
      const label = fetches[i]?.label ?? `fetch_${i}`;
      const result = settled[i];
      if (result?.status !== "fulfilled") {
        fetchSummary.push({ label, ok: false, docs: 0 });
        continue;
      }
      sawAny = true;
      fetchSummary.push({ label, ok: true, docs: result.value.length });
      addDocs(result.value);
    }

    if (!sawAny) {
      throw new Error("search-results-firestore-query_timeout");
    }

    const candidates = [...collected.values()];

    const strictRadiusStagesMiles = [12, 25, 60, 120] as const;
    const nearMeRadiusMiles =
      wantsNearMe && hasViewerCoords
        ? strictRadiusStagesMiles.find((radiusMiles) => {
            const count = candidates.filter((post) => {
              if (post.lat == null || post.lng == null || !viewerCoords) return false;
              const miles = distanceMiles(viewerCoords, { lat: post.lat, lng: post.lng });
              return Number.isFinite(miles) && miles <= radiusMiles;
            }).length;
            return count >= Math.min(8, safeLimit);
          }) ?? strictRadiusStagesMiles[strictRadiusStagesMiles.length - 1]
        : null;

    const strictFilter = (post: SearchablePost): { ok: boolean; reason?: string } => {
      if (hasActivity) {
        // Do not use textMatchScore here: shared location words (e.g. "vermont" in captions) would let
        // unrelated activities through for "hiking in Vermont" vs "swimming in Vermont".
        const match = activityMatchScore(post, intent.activity) > 0;
        if (!match) return { ok: false, reason: "activity_miss" };
      }
      if (hasLocation) {
        if (!locationMatches(post, intent.location ? { cityRegionId: intent.location.cityRegionId, stateRegionId: intent.location.stateRegionId } : null)) {
          return { ok: false, reason: "location_miss" };
        }
      }
      if (wantsNearMe) {
        if (!hasViewerCoords || !viewerCoords) return { ok: false, reason: "near_me_missing_coords" };
        if (post.lat == null || post.lng == null) return { ok: false, reason: "near_me_missing_post_coords" };
        const miles = distanceMiles(viewerCoords, { lat: post.lat, lng: post.lng });
        if (!Number.isFinite(miles)) return { ok: false, reason: "near_me_invalid_distance" };
        if (nearMeRadiusMiles != null && miles > nearMeRadiusMiles) return { ok: false, reason: "near_me_outside_radius" };
      }
      return { ok: true };
    };

    const strictFiltered = candidates
      .map((post) => ({ post, decision: strictFilter(post) }))
      .filter((row) => row.decision.ok)
      .map((row) => row.post);

    let relaxationStage: string | null = null;
    let chosenPool: SearchablePost[] = strictFiltered;

    // Controlled relaxations: only when strict yields nothing.
    if (chosenPool.length === 0) {
      if (wantsNearMe && !hasViewerCoords) {
        relaxationStage = "near_me_missing_coords";
        // Fall back to non-near-me activity/location interpretation (but never pretend it matched).
        chosenPool = candidates.filter((post) => {
          if (hasActivity) {
            const actOk = activityMatchScore(post, intent.activity) > 0;
            if (!actOk) return false;
          }
          if (hasLocation) {
            return locationMatches(post, intent.location ? { cityRegionId: intent.location.cityRegionId, stateRegionId: intent.location.stateRegionId } : null);
          }
          return true;
        });
      } else if (hasActivity && hasLocation) {
        // Never drop location for activity+location queries: an empty strict pool means there are genuinely
        // no posts matching both constraints in the bounded candidate universe — do not leak global activity matches.
        relaxationStage = "strict_activity_location_empty";
        chosenPool = [];
      } else if (hasLocation && !hasActivity) {
        relaxationStage = "location_only_fallback_recent";
        chosenPool = candidates.filter((post) => locationMatches(post, intent.location ? { cityRegionId: intent.location.cityRegionId, stateRegionId: intent.location.stateRegionId } : null));
      } else {
        relaxationStage = "recent_only";
        chosenPool = candidates;
      }
    }

    const postById = new Map(chosenPool.map((p) => [p.postId, p]));
    let ranked = chosenPool
      .map((post) => ({
        postId: post.postId,
        rank: scoreCandidate(post, intent.activity, intent.location, query, wantsNearMe, viewerCoords),
        userId: post.userId,
        userHandle: post.userHandle,
        userName: post.userName,
        userPic: post.userPic,
        activities: post.activities,
        title: post.title,
        thumbUrl: resolveBestCoverUrl(post),
        displayPhotoLink: resolveBestCoverUrl(post),
        mediaType: post.mediaType,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        updatedAtMs: post.updatedAtMs,
      }))
      .filter((row) => Number.isFinite(row.rank))
      .sort((a, b) => a.rank - b.rank || a.postId.localeCompare(b.postId));

    if (wantsNearMe && viewerCoords) {
      ranked.sort((a, b) => {
        const pa = postById.get(a.postId);
        const pb = postById.get(b.postId);
        const ma =
          pa?.lat != null && pa?.lng != null ? distanceMiles(viewerCoords, { lat: pa.lat, lng: pa.lng }) : Number.POSITIVE_INFINITY;
        const mb =
          pb?.lat != null && pb?.lng != null ? distanceMiles(viewerCoords, { lat: pb.lat, lng: pb.lng }) : Number.POSITIVE_INFINITY;
        return ma - mb || a.postId.localeCompare(b.postId);
      });
    }

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
      ...(includeDebug
        ? {
            debug: {
              rawQuery: query,
              normalizedQuery: intent.normalizedQuery,
              nearMe: wantsNearMe,
              nearMeCoordinatesUsed: viewerCoords,
              nearMeRadiusMiles,
              radiusStagesMiles: strictRadiusStagesMiles,
              activity: intent.activity
                ? { canonical: intent.activity.canonical, queryActivities: intent.activity.queryActivities }
                : null,
              location: intent.location
                ? {
                    relation: intent.location.relation,
                    displayText: intent.location.displayText,
                    cityRegionId: intent.location.cityRegionId,
                    stateRegionId: intent.location.stateRegionId,
                  }
                : null,
              fetches: fetchSummary,
              candidatePoolCap: poolTarget,
              rawCandidateCount: collected.size,
              filteredMatchCount: strictFiltered.length,
              relaxationStage,
              returnedCount: Math.max(0, Math.min(safeLimit, ranked.length - cursorSafe)),
              rankedPoolCount: ranked.length,
              cursorOffset: cursorSafe,
              poolTarget,
              pagingMode: "bounded_pool_offset_v1",
            } satisfies Record<string, unknown>,
          }
        : {}),
    };
  }
}

function resolveBestCoverUrl(post: SearchablePost): string {
  const direct = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const assets = post.assets;
  if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {
    const a0 = assets[0] as { poster?: unknown; thumbnail?: unknown; original?: unknown; url?: unknown; downloadURL?: unknown };
    const candidates = [a0.poster, a0.thumbnail, a0.original, a0.url, a0.downloadURL];
    for (const c of candidates) {
      const u = typeof c === "string" ? c.trim() : "";
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  return "";
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
  const assets = Array.isArray(data.assets) ? (data.assets as unknown[]) : null;
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
    geohash: String(data.geohash ?? "").trim() || null,
    address: String(data.address ?? "").trim() || null,
    assets,
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
  const postCity = normalizeRegionId(post.cityRegionId);
  const postState = normalizeRegionId(post.stateRegionId);
  const wantCity = normalizeRegionId(location.cityRegionId);
  const wantState = normalizeRegionId(location.stateRegionId);
  // If the query is city-scoped, do NOT allow state-level matches — that would leak other cities.
  if (wantCity) {
    return postCity === wantCity ? 28 : -18;
  }
  if (wantState && postState === wantState) return 18;
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
