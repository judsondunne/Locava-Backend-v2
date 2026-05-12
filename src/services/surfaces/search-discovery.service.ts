import { FieldPath, type Query } from "firebase-admin/firestore";
import { attachAppPostV2ToSearchDiscoveryRow } from "../../lib/posts/app-post-v2/enrichAppPostV2Response.js";
import type { PostRecord } from "../../lib/posts/postFieldSelectors.js";
import {
  getPostActivities,
  getPostAuthorSummary,
  getPostCaption,
  getPostCityRegionId,
  getPostCoordinates,
  getPostCoverDisplayUrl,
  getPostDescription,
  getPostEngagementCounts,
  getPostMediaKind,
  getPostSearchableText,
  getPostStateRegionId,
  getPostTitle,
  getPostUpdatedAtMs,
} from "../../lib/posts/postFieldSelectors.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { CollectionsFirestoreAdapter } from "../../repositories/source-of-truth/collections-firestore.adapter.js";
import { SearchUsersFirestoreAdapter } from "../../repositories/source-of-truth/search-users-firestore.adapter.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import {
  type SearchActivityIntent,
  type SearchIndexedPlaceLike,
  type SearchLocationIntent,
  buildStateRegionId,
  normalizeSearchText,
  parseSearchQueryIntent,
  resolveActivitySuggestions,
  resolveStateNameFromAny,
  slugRegionPart,
} from "../../lib/search-query-intent.js";
import { searchPlacesIndexService, type SearchIndexedPlace } from "./search-places-index.service.js";

export type DiscoveryMixSpec = {
  kind: "mix_spec_v1";
  id: string;
  type: "activity_mix";
  specVersion: 1;
  seeds: { primaryActivityId: string; secondaryActivityIds?: string[] };
  title: string;
  subtitle: string;
  coverSpec: { kind: "thumb_collage"; maxTiles: number };
  geoMode: "none" | "viewer";
  personalizationMode: "taste_blended_v1";
  rankingMode: "mix_v1";
  geoBucketKey: string;
  heroQuery?: string;
  cacheKeyVersion: number;
};

export type DiscoveryPost = {
  id: string;
  postId: string;
  userId: string;
  userHandle?: string;
  userName?: string;
  userPic?: string | null;
  title: string;
  caption: string;
  description: string;
  activities: string[];
  thumbUrl: string;
  displayPhotoLink: string;
  mediaType?: "image" | "video";
  likeCount?: number;
  commentCount?: number;
  updatedAtMs?: number;
  lat: number | null;
  lng: number | null;
  stateRegionId: string | null;
  cityRegionId: string | null;
  /** Firestore doc snapshot fields for AppPostV2 (no extra reads). */
  rawFirestore: Record<string, unknown>;
};

type RankedDiscoveryPost = {
  post: DiscoveryPost;
  score: number;
  locationMatched: boolean;
  activityMatched: boolean;
};

type SuggestLocationRow = {
  text: string;
  cityRegionId: string;
  stateRegionId: string;
  stateName: string;
  lat: number | null;
  lng: number | null;
};

const DISCOVERY_POST_SELECT_FIELDS = [
  "schema",
  "author",
  "lifecycle",
  "classification",
  "location",
  "text",
  "media",
  "engagement",
  "ranking",
  "compatibility",
  "userId",
  "userHandle",
  "userName",
  "userPic",
  "title",
  "caption",
  "description",
  "content",
  "activities",
  "searchableText",
  "searchText",
  "thumbUrl",
  "displayPhotoLink",
  "photoLink",
  "assets",
  "mediaType",
  "likesCount",
  "likeCount",
  "commentsCount",
  "commentCount",
  "updatedAtMs",
  "createdAtMs",
  "time",
  "lat",
  "lng",
  "long",
  "stateRegionId",
  "cityRegionId",
  "countryRegionId",
  "geoData",
  "geohash",
] as const;

function hasLikelyActivityTagSpam(activities: string[]): boolean {
  const uniqueCount = new Set(activities).size;
  return activities.length > 20 || uniqueCount > 18;
}

function toActivityKey(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function uniqByText<T extends { text: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const row of rows) {
    const key = normalizeSearchText(row.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(row);
  }
  return next;
}

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  const deg = Math.sqrt(dx * dx + dy * dy);
  return deg * 69;
}

function primaryQueryActivities(activity: SearchActivityIntent | null, limit = 2): string[] {
  if (!activity) return [];
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const raw of activity.queryActivities) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    rows.push(value);
    if (rows.length >= Math.max(1, limit)) break;
  }
  return rows;
}

function activityKeysMatch(candidate: string, key: string): boolean {
  if (!candidate || !key) return false;
  if (candidate === key) return true;
  const lengthDelta = Math.abs(candidate.length - key.length);
  if (lengthDelta > 2) return false;
  return candidate.startsWith(key) || key.startsWith(candidate);
}

export class SearchDiscoveryService {
  // Resolve dynamically so tests that toggle FIRESTORE_TEST_MODE in separate runs
  // don't get stuck with a cached null client.
  private get db() {
    return getFirestoreSourceClient();
  }
  private readonly collectionsAdapter = new CollectionsFirestoreAdapter();
  private readonly usersAdapter = new SearchUsersFirestoreAdapter();
  private static readonly FIRESTORE_TIMEOUT_MS = 800;
  private static topActivitiesCache: { key: string; expiresAtMs: number; value: string[] } | null = null;
  private static recentPostsCache: { key: string; expiresAtMs: number; value: DiscoveryPost[] } | null = null;
  private static suggestedUsersCache: { key: string; expiresAtMs: number; value: Array<Record<string, unknown>> } | null = null;
  private static locationSuggestionsCache = new Map<string, { expiresAtMs: number; value: SuggestLocationRow[] }>();

  static resetCachesForTests(): void {
    SearchDiscoveryService.topActivitiesCache = null;
    SearchDiscoveryService.recentPostsCache = null;
    SearchDiscoveryService.suggestedUsersCache = null;
    SearchDiscoveryService.locationSuggestionsCache.clear();
  }

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("search_discovery_firestore_unavailable");
    return this.db;
  }

  isEnabled(): boolean {
    return this.db !== null;
  }

  resolvePlace(normalizedQuery: string): SearchIndexedPlaceLike | null {
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

  parseIntent(query: string) {
    return parseSearchQueryIntent(query, (normalizedQuery) => this.resolvePlace(normalizedQuery));
  }

  async loadTopActivities(limit = 12): Promise<string[]> {
    const cacheKey = `top:${Math.max(1, limit)}`;
    const topCached = SearchDiscoveryService.topActivitiesCache;
    if (topCached && topCached.key === cacheKey && topCached.expiresAtMs > Date.now()) {
      return topCached.value.slice(0, Math.max(1, limit));
    }
    const db = this.requireDb();
    let snap;
    try {
      snap = await withTimeout(
        db.collection("posts").orderBy("time", "desc").select("activities", "classification", "schema").limit(50).get(),
        SearchDiscoveryService.FIRESTORE_TIMEOUT_MS,
        "search-discovery-top-activities"
      );
    } catch {
      return topCached?.value.slice(0, Math.max(1, limit)) ?? [];
    }
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    const counts = new Map<string, number>();
    for (const doc of snap.docs) {
      const row = doc.data() as Record<string, unknown>;
      const activities = getPostActivities(row as PostRecord);
      for (const raw of activities) {
        const activity = String(raw ?? "").trim().toLowerCase();
        if (!activity) continue;
        counts.set(activity, (counts.get(activity) ?? 0) + 1);
      }
    }
    const next = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, Math.max(1, limit))
      .map(([activity]) => activity);
    SearchDiscoveryService.topActivitiesCache = {
      key: cacheKey,
      expiresAtMs: Date.now() + 10 * 60_000,
      value: next,
    };
    return next;
  }

  async loadRecentPosts(limit = 120): Promise<DiscoveryPost[]> {
    const safeLimit = Math.max(1, Math.min(220, limit));
    const cacheKey = `recent:${safeLimit}`;
    const cached = SearchDiscoveryService.recentPostsCache;
    if (cached && cached.expiresAtMs > Date.now() && cached.value.length >= safeLimit) {
      return cached.value.slice(0, safeLimit);
    }
    const db = this.requireDb();
    let snap;
    try {
      snap = await withTimeout(
        db
          .collection("posts")
          .orderBy("time", "desc")
          .select(...DISCOVERY_POST_SELECT_FIELDS)
          .limit(safeLimit)
          .get(),
        SearchDiscoveryService.FIRESTORE_TIMEOUT_MS,
        "search-discovery-recent-posts"
      );
    } catch {
      return [];
    }
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    const rows = snap.docs.map((doc) => this.mapDiscoveryPost(doc.id, doc.data() as Record<string, unknown>));
    SearchDiscoveryService.recentPostsCache = {
      key: cacheKey,
      expiresAtMs: Date.now() + 20_000,
      value: rows,
    };
    return rows;
  }

  async loadPostsByIds(postIds: string[]): Promise<DiscoveryPost[]> {
    const db = this.requireDb();
    const uniqueIds = [...new Set(postIds.map((id) => String(id).trim()).filter(Boolean))];
    const rows: DiscoveryPost[] = [];
    for (let i = 0; i < uniqueIds.length; i += 10) {
      const chunk = uniqueIds.slice(i, i + 10);
      let snap;
      try {
        snap = await withTimeout(
          db
            .collection("posts")
            .where(FieldPath.documentId(), "in", chunk)
            .select(...DISCOVERY_POST_SELECT_FIELDS)
            .get(),
          SearchDiscoveryService.FIRESTORE_TIMEOUT_MS,
          "search-discovery-posts-by-id"
        );
      } catch {
        continue;
      }
      incrementDbOps("queries", 1);
      incrementDbOps("reads", snap.docs.length);
      const byId = new Map<string, DiscoveryPost>();
      for (const doc of snap.docs) {
        byId.set(doc.id, this.mapDiscoveryPost(doc.id, doc.data() as Record<string, unknown>));
      }
      for (const id of chunk) {
        const row = byId.get(id);
        if (row) rows.push(row);
      }
    }
    return rows;
  }

  async loadSuggestedUsers(limit = 8): Promise<Array<Record<string, unknown>>> {
    const safeLimit = Math.max(1, Math.min(20, limit));
    const cacheKey = `suggested:${safeLimit}`;
    const cached = SearchDiscoveryService.suggestedUsersCache;
    if (cached && cached.key === cacheKey && cached.expiresAtMs > Date.now()) {
      return cached.value.slice(0, safeLimit);
    }
    const db = this.requireDb();
    let snap;
    try {
      snap = await withTimeout(
        db
          .collection("users")
          .orderBy("searchHandle")
          .select("name", "handle", "profilePic", "profilePicture", "photo")
          .limit(safeLimit)
          .get(),
        SearchDiscoveryService.FIRESTORE_TIMEOUT_MS,
        "search-discovery-suggested-users"
      );
    } catch {
      return [];
    }
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    const rows = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        userId: doc.id,
        id: doc.id,
        name: String(data.name ?? "").trim() || `User ${doc.id.slice(0, 8)}`,
        handle: String(data.handle ?? "").replace(/^@+/, "").trim(),
        profilePic: sanitizeProfilePic(data.profilePic ?? data.profilePicture ?? data.photo),
      };
    });
    SearchDiscoveryService.suggestedUsersCache = {
      key: cacheKey,
      expiresAtMs: Date.now() + 20_000,
      value: rows,
    };
    return rows;
  }

  async searchUsersForQuery(query: string, limit = 8): Promise<Array<Record<string, unknown>>> {
    const normalized = normalizeSearchText(query);
    if (normalized.length < 2) return [];
    if (!this.usersAdapter.isEnabled()) return [];
    try {
      const page = await this.usersAdapter.searchUsersPage({
        query: normalized,
        cursorOffset: 0,
        limit: Math.max(1, Math.min(12, limit)),
      });
      incrementDbOps("queries", page.queryCount);
      incrementDbOps("reads", page.readCount);
      return page.users.map((row) => ({
        userId: row.userId,
        id: row.userId,
        handle: row.handle,
        name: row.name,
        profilePic: row.pic,
      }));
    } catch {
      return [];
    }
  }

  async searchCollections(input: {
    viewerId: string;
    query: string;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const normalized = normalizeSearchText(input.query);
    if (normalized.length < 2) return [];
    const safeLimit = Math.max(1, Math.min(12, input.limit ?? 8));
    const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
    const rows = new Map<
      string,
      {
        id: string;
        title: string;
        description: string;
        coverUri: string | null;
        postCount: number;
        score: number;
      }
    >();
    const scoreText = (title: string, description: string): number => {
      const corpus = normalizeSearchText(`${title} ${description}`);
      let score = 0;
      if (corpus.includes(normalized)) score += 16;
      for (const token of tokens) {
        if (corpus.includes(token)) score += 5;
      }
      return score;
    };
    const addRow = (row: {
      id: string;
      title: string;
      description?: string;
      coverUri?: string | null;
      postCount?: number;
    }): void => {
      const id = String(row.id ?? "").trim();
      const title = String(row.title ?? "").trim();
      const description = String(row.description ?? "").trim();
      if (!id || !title) return;
      const score = scoreText(title, description);
      if (score <= 0) return;
      const existing = rows.get(id);
      if (existing && existing.score >= score) return;
      rows.set(id, {
        id,
        title,
        description,
        coverUri: typeof row.coverUri === "string" && row.coverUri.trim() ? row.coverUri.trim() : null,
        postCount: Math.max(0, Number(row.postCount ?? 0) || 0),
        score,
      });
    };

    try {
      const viewerCollections = await this.collectionsAdapter.listViewerCollections({
        viewerId: input.viewerId,
        limit: Math.max(24, safeLimit * 4),
      });
      for (const collection of viewerCollections) {
        addRow({
          id: collection.id,
          title: collection.name,
          description: collection.description,
          coverUri: collection.coverUri ?? null,
          postCount: collection.itemsCount,
        });
      }
    } catch {
      // Keep bounded public search even if viewer-specific collections are unavailable.
    }

    if (this.db) {
      try {
        const snap = await withTimeout(
          this.db
            .collection("collections")
            .orderBy("updatedAt", "desc")
            .select("name", "description", "privacy", "displayPhotoUrl", "coverUri", "itemsCount", "items", "kind", "systemManaged")
            .limit(Math.max(30, safeLimit * 8))
            .get(),
          SearchDiscoveryService.FIRESTORE_TIMEOUT_MS,
          "search-discovery-public-collections"
        );
        incrementDbOps("queries", 1);
        incrementDbOps("reads", snap.docs.length);
        for (const doc of snap.docs) {
          const data = doc.data() as Record<string, unknown>;
          const privacy = String(data.privacy ?? "").toLowerCase();
          if (privacy && privacy !== "public") continue;
          if (data.systemManaged === true) continue;
          if (String(data.kind ?? "") === "system_mix") continue;
          addRow({
            id: doc.id,
            title: String(data.name ?? data.title ?? "Collection"),
            description: String(data.description ?? ""),
            coverUri: String(data.coverUri ?? data.displayPhotoUrl ?? "").trim() || null,
            postCount: Number(data.itemsCount ?? (Array.isArray(data.items) ? data.items.length : 0)) || 0,
          });
        }
      } catch {
        // noop
      }
    }

    return [...rows.values()]
      .sort((a, b) => b.score - a.score || b.postCount - a.postCount || a.title.localeCompare(b.title))
      .slice(0, safeLimit)
      .map((row) => ({
        id: row.id,
        collectionId: row.id,
        title: row.title,
        description: row.description,
        coverUri: row.coverUri,
        postCount: row.postCount,
      }));
  }

  async loadLocationSuggestions(
    query: string,
    limit = 6,
    opts?: { viewerLat?: number | null; viewerLng?: number | null },
  ): Promise<SuggestLocationRow[]> {
    const normalized = normalizeSearchText(query);
    if (normalized.length < 2) return [];
    const geoKey =
      typeof opts?.viewerLat === "number" &&
      Number.isFinite(opts.viewerLat) &&
      typeof opts?.viewerLng === "number" &&
      Number.isFinite(opts.viewerLng)
        ? `${Math.round(opts.viewerLat * 100) / 100}:${Math.round(opts.viewerLng * 100) / 100}`
        : "no_geo";
    const cacheKey = `${normalized}:${geoKey}:${Math.max(1, Math.min(12, limit))}`;
    const cached = SearchDiscoveryService.locationSuggestionsCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.value;
    }

    const rows: SuggestLocationRow[] = [];
    const stateName = resolveStateNameFromAny(normalized);
    let stateSynonymRow: SuggestLocationRow | null = null;
    if (stateName) {
      stateSynonymRow = {
        text: stateName,
        cityRegionId: "",
        stateRegionId: buildStateRegionId("US", stateName),
        stateName,
        lat: null,
        lng: null,
      };
      rows.push(stateSynonymRow);
    }

    const indexed = searchPlacesIndexService.search(normalized, limit + 2, {
      viewerLat: opts?.viewerLat ?? null,
      viewerLng: opts?.viewerLng ?? null,
    });
    for (const place of indexed) {
      rows.push({
        text: `${place.text}, ${place.stateName}`,
        cityRegionId: place.cityRegionId,
        stateRegionId: place.stateRegionId,
        stateName: place.stateName,
        lat: place.lat,
        lng: place.lng,
      });
    }

    if (stateSynonymRow && stateSynonymRow.lat == null && stateSynonymRow.lng == null && stateSynonymRow.stateName) {
      const anchor = indexed.find(
        (p) =>
          p.stateName === stateSynonymRow?.stateName &&
          p.lat != null &&
          p.lng != null &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng),
      );
      const centroid = anchor
        ? { lat: anchor.lat as number, lng: anchor.lng as number }
        : searchPlacesIndexService.approxPopulationWeightedCentroidForUsState(stateSynonymRow.stateName);
      if (centroid) {
        stateSynonymRow.lat = centroid.lat;
        stateSynonymRow.lng = centroid.lng;
      }
    }

    const deduped = uniqByText(rows).slice(0, Math.max(1, Math.min(12, limit)));
    SearchDiscoveryService.locationSuggestionsCache.set(cacheKey, {
      expiresAtMs: Date.now() + 60_000,
      value: deduped,
    });
    return deduped;
  }

  async searchPostsForQuery(
    query: string,
    opts: { limit?: number; lat?: number | null; lng?: number | null } = {},
  ): Promise<DiscoveryPost[]> {
    const intent = this.parseIntent(query);
    const scanLimit =
      intent.location && !intent.activity
        ? Math.max(72, Math.min(160, (opts.limit ?? 16) * 12))
        : intent.activity && !intent.location && !intent.nearMe
        ? Math.max(12, Math.min(24, opts.limit ?? 16))
        : intent.activity || intent.location || intent.nearMe
        ? Math.max(24, Math.min(84, (opts.limit ?? 16) * 3))
        : Math.max(36, Math.min(96, (opts.limit ?? 16) * 3));
    const posts = await this.loadCandidatePostsForIntent(intent, scanLimit, opts.lat, opts.lng);
    const ranked = this.rankPosts(posts, intent.activity, intent.location, intent.residualTokens, opts.lat, opts.lng, intent.nearMe);
    // Mix generation may legitimately request larger pools for pagination.
    // Keep a hard ceiling to protect latency/reads.
    const desiredCount = Math.max(1, Math.min(600, opts.limit ?? 16));
    if (
      intent.location?.cityRegionId &&
      intent.location.place?.lat != null &&
      intent.location.place?.lng != null
    ) {
      const nearby = ranked.filter((row) => {
        const c = getPostCoordinates(row.post.rawFirestore as PostRecord);
        if (c.lat == null || c.lng == null) return false;
        return (
          distanceMiles(
            { lat: intent.location?.place?.lat as number, lng: intent.location?.place?.lng as number },
            { lat: c.lat, lng: c.lng }
          ) <= 90
        );
      });
      if (nearby.length >= Math.min(4, desiredCount)) {
        return nearby.slice(0, desiredCount).map((row) => row.post);
      }
    }
    return ranked.slice(0, desiredCount).map((row) => row.post);
  }

  async buildBootstrapPayload(input: {
    query: string;
    limit: number;
    lat?: number | null;
    lng?: number | null;
  }): Promise<{
    routeName: "search.bootstrap.get";
    posts: Array<Record<string, unknown>>;
    rails: Array<{ id: string; title: string; posts: Array<Record<string, unknown>> }>;
    collections: Array<Record<string, unknown>>;
    suggestedUsers: Array<Record<string, unknown>>;
    popularActivities: string[];
    parsedSummary: { activity: string | null; nearMe: boolean; genericDiscovery: boolean };
  }> {
    const intent = this.parseIntent(input.query);
    if (input.query.trim().length < 2) {
      const [topActivities, recentPosts, suggestedUsers] = await Promise.all([
        this.loadTopActivities(8),
        this.loadRecentPosts(Math.max(36, input.limit)),
        this.loadSuggestedUsers(8),
      ]);
      const rails = await Promise.all(
        topActivities.slice(0, 4).map(async (activity) => {
          const posts = (
            await this.searchPostsForQuery(activity, { limit: 6, lat: input.lat, lng: input.lng })
          ).map((post) => this.postToSearchRow(post));
          return { id: `activity:${slugRegionPart(activity)}`, title: activity, posts };
        })
      );
      return {
        routeName: "search.bootstrap.get",
        posts: recentPosts.slice(0, input.limit).map((post) => this.postToSearchRow(post)),
        rails,
        collections: [],
        suggestedUsers,
        popularActivities: topActivities,
        parsedSummary: { activity: null, nearMe: false, genericDiscovery: true },
      };
    }

    const posts = (
      await this.searchPostsForQuery(input.query, {
        limit: input.limit,
        lat: input.lat,
        lng: input.lng,
      })
    ).map((post) => this.postToSearchRow(post));

    // Provide a larger set of "Collections" for the committed-results screen.
    // The autofill surface stays small/fast (3 max), but the results page can
    // show ~10 generated mixes for exploration.
    const activity = intent.activity?.canonical ? String(intent.activity.canonical).trim().toLowerCase() : null;
    const locationText = intent.location?.displayText ? String(intent.location.displayText).trim() : "";
    const locationMixPrefix = locationText
      ? intent.location?.cityRegionId
        ? `location_activity_city:${intent.location.cityRegionId}`
        : intent.location?.stateRegionId
          ? `location_activity_state:${intent.location.stateRegionId}`
          : `location_activity_place:${locationText}`
      : null;
    const related = (intent.activity?.relatedActivities ?? []).map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean);
    const activityList = activity ? [activity, ...related.filter((r) => r !== activity).slice(0, 9)] : [];
    const collections: Array<Record<string, unknown>> = [];
    for (const a of activityList.slice(0, 10)) {
      const mixId = locationMixPrefix ? `${locationMixPrefix}:${a}` : `activity:${a}`;
      const title = locationText ? `${a} in ${locationText}` : `${a} near you`;
      const subtitle = locationText ? `Top ${a} posts in ${locationText}` : `Top ${a} posts near you`;
      collections.push({
        text: title.charAt(0).toUpperCase() + title.slice(1),
        type: "mix",
        suggestionType: "template",
        badge: "Mix",
        data: {
          mixSpecV1: {
            kind: "mix_spec_v1",
            id: `mix_${a}${locationText ? `_${locationText}` : ""}`.replace(/[^a-z0-9_]+/gi, "_").toLowerCase(),
            type: "activity_mix",
            specVersion: 1,
            seeds: { primaryActivityId: a },
            title: title.charAt(0).toUpperCase() + title.slice(1),
            subtitle,
            coverSpec: { kind: "thumb_collage", maxTiles: 4 },
            geoMode: "viewer",
            personalizationMode: "taste_blended_v1",
            rankingMode: "mix_v1",
            geoBucketKey: "global",
            heroQuery: locationText ? `${a} in ${locationText}` : a,
            cacheKeyVersion: 1,
            v2MixId: mixId,
          },
        },
        confidence: 0.93,
      });
    }
    return {
      routeName: "search.bootstrap.get",
      posts,
      rails: [],
      collections,
      suggestedUsers: [],
      popularActivities: intent.activity ? intent.activity.queryActivities.slice(0, 4) : [],
      parsedSummary: {
        activity: intent.activity?.canonical ?? null,
        nearMe: intent.nearMe,
        genericDiscovery: intent.genericDiscovery,
      },
    };
  }

  buildSuggestPayload(input: {
    query: string;
    locationRows: SuggestLocationRow[];
    userSuggestions?: Array<Record<string, unknown>>;
  }): {
    routeName: "search.suggest.get";
    suggestions: Array<Record<string, unknown>>;
    detectedActivity: string | null;
    relatedActivities: string[];
  } {
    const intent = this.parseIntent(input.query);
    const normalized = normalizeSearchText(input.query);
    const activityRows = resolveActivitySuggestions(input.query, 5);
    const suggestions: Array<Record<string, unknown>> = [];

    const push = (row: Record<string, unknown>): void => {
      const key = `${String(row.type ?? "")}:${normalizeSearchText(String(row.text ?? ""))}`;
      if (!key || suggestions.some((item) => `${String(item.type ?? "")}:${normalizeSearchText(String(item.text ?? ""))}` === key)) {
        return;
      }
      suggestions.push(row);
    };

    for (const user of input.userSuggestions ?? []) push(user);

    for (const activity of activityRows) {
      push({
        text: activity.canonical,
        type: "activity",
        suggestionType: "activity",
        data: { activity: activity.canonical, canonical: activity.canonical },
      });
    }

    for (const location of input.locationRows) {
      push({
        text: location.text,
        type: location.cityRegionId ? "town" : "state",
        suggestionType: "place",
        data: {
          cityRegionId: location.cityRegionId,
          stateRegionId: location.stateRegionId,
          lat: location.lat,
          lng: location.lng,
          locationText: location.text,
          activity: intent.activity?.canonical ?? undefined,
        },
      });
      if (intent.activity) {
        push({
          text: `${intent.activity.canonical} in ${location.text}`,
          type: "sentence",
          suggestionType: "template",
          data: {
            activity: intent.activity.canonical,
            cityRegionId: location.cityRegionId,
            stateRegionId: location.stateRegionId,
            lat: location.lat,
            lng: location.lng,
          },
        });
      }
    }

    if (intent.location?.displayText && (!intent.location.place || input.locationRows.length === 0)) {
      push({
        text: intent.location.displayText,
        type: intent.location.cityRegionId ? "town" : "state",
        suggestionType: "place",
        data: {
          cityRegionId: intent.location.cityRegionId,
          stateRegionId: intent.location.stateRegionId,
          lat: intent.location.place?.lat ?? null,
          lng: intent.location.place?.lng ?? null,
          locationText: intent.location.displayText,
          activity: intent.activity?.canonical ?? undefined,
        },
      });
      if (intent.activity) {
        push({
          text: `${intent.activity.canonical} in ${intent.location.displayText}`,
          type: "sentence",
          suggestionType: "template",
          data: {
            activity: intent.activity.canonical,
            cityRegionId: intent.location.cityRegionId,
            stateRegionId: intent.location.stateRegionId,
            lat: intent.location.place?.lat ?? null,
            lng: intent.location.place?.lng ?? null,
          },
        });
      }
    }

    if (intent.activity && !intent.nearMe) {
      push({
        text: `${intent.activity.canonical} near me`,
        type: "smart_completion",
        suggestionType: "activity",
        data: { activity: intent.activity.canonical, nearMe: true },
      });
    }

    if (!intent.activity && normalized.length >= 2) {
      push({
        text: input.query.trim(),
        type: "natural_echo",
        suggestionType: "template",
        data: { originalQuery: input.query.trim() },
      });
    }

    return {
      routeName: "search.suggest.get",
      suggestions: suggestions.slice(0, 10),
      detectedActivity: intent.activity?.canonical ?? null,
      relatedActivities: intent.activity?.relatedActivities.slice(0, 6) ?? [],
    };
  }

  buildMixSpecsFromActivities(
    activities: string[],
    locationText?: string | null,
  ): DiscoveryMixSpec[] {
    const defs = activities.length > 0 ? activities : [];
    const isNearMe = normalizeSearchText(locationText ?? "") === "near me";
    return defs.map((activity) => ({
      kind: "mix_spec_v1",
      id: `mix_${slugRegionPart(locationText ? `${activity}_${locationText}` : activity)}`,
      type: "activity_mix",
      specVersion: 1,
      seeds: { primaryActivityId: activity },
      title: locationText
        ? isNearMe
          ? `${activity.charAt(0).toUpperCase()}${activity.slice(1)} near me`
          : `${activity.charAt(0).toUpperCase()}${activity.slice(1)} in ${locationText}`
        : `${activity.charAt(0).toUpperCase()}${activity.slice(1)} Mix`,
      subtitle: locationText
        ? isNearMe
          ? `Top ${activity} posts near you`
          : `Top ${activity} posts near ${locationText}`
        : `Top ${activity} posts`,
      coverSpec: { kind: "thumb_collage", maxTiles: 4 },
      geoMode: locationText ? "viewer" : "none",
      personalizationMode: "taste_blended_v1",
      rankingMode: "mix_v1",
      geoBucketKey: locationText ? slugRegionPart(locationText) : "global",
      heroQuery: locationText
        ? isNearMe
          ? `${activity} near me`
          : `${activity} in ${locationText}`
        : activity,
      cacheKeyVersion: 2,
    }));
  }

  async loadUsersByIds(userIds: string[]): Promise<Array<Record<string, unknown>>> {
    const db = this.requireDb();
    const uniqueIds = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < uniqueIds.length; i += 10) {
      const chunk = uniqueIds.slice(i, i + 10);
      let snap;
      try {
        snap = await withTimeout(
          db.collection("users").where(FieldPath.documentId(), "in", chunk).get(),
          SearchDiscoveryService.FIRESTORE_TIMEOUT_MS,
          "search-discovery-users-by-id"
        );
      } catch {
        continue;
      }
      incrementDbOps("queries", 1);
      incrementDbOps("reads", snap.docs.length);
      const byId = new Map<string, Record<string, unknown>>();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        byId.set(doc.id, {
          id: doc.id,
          userId: doc.id,
          name: String(data.name ?? data.displayName ?? "").trim(),
          handle: String(data.handle ?? "").replace(/^@+/, "").trim(),
          profilePic: sanitizeProfilePic(data.profilePic ?? data.profilePicture ?? data.photo),
        });
      }
      for (const id of chunk) {
        const user = byId.get(id);
        if (user) rows.push(user);
      }
    }
    return rows;
  }

  postToSearchRow(post: DiscoveryPost): Record<string, unknown> {
    return attachAppPostV2ToSearchDiscoveryRow(
      {
        postId: post.postId,
        id: post.id,
        userId: post.userId,
        thumbUrl: post.thumbUrl,
        displayPhotoLink: post.displayPhotoLink,
        title: post.title,
        activities: post.activities,
      },
      post.rawFirestore
    );
  }

  private rankPosts(
    posts: DiscoveryPost[],
    activity: SearchActivityIntent | null,
    location: SearchLocationIntent | null,
    residualTokens: string[],
    lat?: number | null,
    lng?: number | null,
    nearMe = false,
  ): RankedDiscoveryPost[] {
    const viewerCoords =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat: Number(lat), lng: Number(lng) }
        : null;
    const activityKeysToMatch = primaryQueryActivities(activity, 2);
    return posts
      .filter((post) => getPostCoverDisplayUrl(post.rawFirestore as PostRecord).startsWith("http"))
      .filter((post) => !hasLikelyActivityTagSpam(getPostActivities(post.rawFirestore as PostRecord)))
      .map((post) => {
        const raw = post.rawFirestore as PostRecord;
        const activityKeys = getPostActivities(raw).map((value) => toActivityKey(value));
        const textCorpus = normalizeSearchText(getPostSearchableText(raw));
        let score = 0;
        let activityMatched = false;
        let locationMatched = false;

        if (activity) {
          for (const [index, queryActivity] of activityKeysToMatch.entries()) {
            const key = toActivityKey(queryActivity);
            if (activityKeys.some((candidate) => activityKeysMatch(candidate, key))) {
              score += index === 0 ? 20 : 9;
              activityMatched = true;
            }
          }
          if (!activityMatched && activityKeys.length > 0) {
            return { post, score: -1, locationMatched: false, activityMatched: false };
          }
        }

        if (location?.cityRegionId || location?.stateRegionId) {
          const postCity = getPostCityRegionId(raw);
          const postState = getPostStateRegionId(raw);
          const coords = getPostCoordinates(raw);
          if (location.cityRegionId && postCity === location.cityRegionId) {
            score += 20;
            locationMatched = true;
          } else if (location.stateRegionId && postState === location.stateRegionId) {
            score += 12;
            locationMatched = true;
          } else if (
            location.place?.lat != null &&
            location.place?.lng != null &&
            coords.lat != null &&
            coords.lng != null
          ) {
            const miles = distanceMiles(
              { lat: location.place.lat, lng: location.place.lng },
              { lat: coords.lat, lng: coords.lng }
            );
            if (miles <= 90) {
              score += Math.max(6, 16 - miles / 12);
              locationMatched = true;
            } else {
              score -= 16;
            }
          } else {
            score -= 16;
          }
        }

        for (const token of residualTokens) {
          if (textCorpus.includes(token)) score += 5;
          if (activityKeys.some((candidate) => candidate.includes(token))) score += 7;
        }

        const viewerDistCoords = getPostCoordinates(raw);
        if (viewerCoords && viewerDistCoords.lat != null && viewerDistCoords.lng != null) {
          const miles = distanceMiles(viewerCoords, { lat: viewerDistCoords.lat, lng: viewerDistCoords.lng });
          if (nearMe && miles > 120) {
            return { post, score: -1, locationMatched: false, activityMatched };
          }
          score += Math.max(0, 12 - miles / 10);
        }

        if ((location?.cityRegionId || location?.stateRegionId) && !locationMatched) {
          return { post, score: -1, locationMatched: false, activityMatched };
        }

        const eng = getPostEngagementCounts(raw);
        score += Math.min(4, eng.likeCount / 12);
        score += Math.min(2, eng.commentCount / 6);
        return { post, score, locationMatched, activityMatched };
      })
      .filter((row) => row.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          getPostUpdatedAtMs(b.post.rawFirestore as PostRecord) - getPostUpdatedAtMs(a.post.rawFirestore as PostRecord),
      );
  }

  private async loadCandidatePostsForIntent(
    intent: ReturnType<SearchDiscoveryService["parseIntent"]>,
    limit: number,
    lat?: number | null,
    lng?: number | null,
  ): Promise<DiscoveryPost[]> {
    const desired = Math.max(12, Math.min(96, limit));
    const isGeneric = !intent.activity && !intent.location && !intent.nearMe;
    const candidates = new Map<string, DiscoveryPost>();
    const addRows = (rows: DiscoveryPost[]): void => {
      for (const row of rows) {
        if (!candidates.has(row.postId)) {
          candidates.set(row.postId, row);
        }
      }
    };

    const targetQueryLimit = Math.max(8, Math.min(24, Math.ceil(desired / 2)));
    const fetches: Array<Promise<DiscoveryPost[]>> = [];

    if (intent.activity) {
      for (const activity of primaryQueryActivities(intent.activity, 1)) {
        fetches.push(
          this.queryPosts((db) =>
            db
              .collection("posts")
              .where("activities", "array-contains", activity)
              .select(...DISCOVERY_POST_SELECT_FIELDS)
              .limit(targetQueryLimit)
          )
        );
      }
    }

    if (intent.location?.cityRegionId) {
      fetches.push(
        this.queryPosts((db) =>
          db
            .collection("posts")
            .where("cityRegionId", "==", intent.location!.cityRegionId)
            .select(...DISCOVERY_POST_SELECT_FIELDS)
            .limit(Math.max(18, targetQueryLimit))
        )
      );
    }
    if (intent.location?.stateRegionId) {
      fetches.push(
        this.queryPosts((db) =>
          db
            .collection("posts")
            .where("stateRegionId", "==", intent.location!.stateRegionId)
            .select(...DISCOVERY_POST_SELECT_FIELDS)
            .limit(Math.max(24, targetQueryLimit))
        )
      );
    }

    if (intent.nearMe) {
      fetches.push(this.loadRecentPosts(Math.max(96, desired * 2)));
    }

    const settled = await Promise.allSettled(fetches);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        addRows(result.value);
      }
    }

    if (isGeneric) {
      addRows(await this.loadRecentPosts(Math.max(36, desired)));
    } else if (intent.nearMe && candidates.size < Math.min(8, desired)) {
      addRows(await this.loadRecentPosts(Math.max(160, desired * 3)));
    } else if (candidates.size === 0) {
      const cachedRecentPosts = SearchDiscoveryService.recentPostsCache;
      if (cachedRecentPosts && cachedRecentPosts.expiresAtMs > Date.now()) {
        addRows(cachedRecentPosts.value.slice(0, Math.max(12, Math.min(24, desired))));
      }
    }

    return [...candidates.values()];
  }

  private async queryPosts(buildQuery: (db: NonNullable<SearchDiscoveryService["db"]>) => Query): Promise<DiscoveryPost[]> {
    const db = this.db;
    if (!db) return [];
    try {
      const snap = await withTimeout(
        buildQuery(db).get(),
        SearchDiscoveryService.FIRESTORE_TIMEOUT_MS,
        "search-discovery-query-posts"
      );
      incrementDbOps("queries", 1);
      incrementDbOps("reads", snap.docs.length);
      return snap.docs.map((doc) => this.mapDiscoveryPost(doc.id, doc.data() as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  private mapDiscoveryPost(postId: string, data: Record<string, unknown>): DiscoveryPost {
    const rec = { ...data, id: postId, postId } as PostRecord;
    const activities = getPostActivities(rec);
    const thumb = getPostCoverDisplayUrl(rec);
    const mk = getPostMediaKind(rec);
    const mediaType = mk === "video" ? "video" : "image";
    const orderMillis = getPostUpdatedAtMs(rec);
    const coords = getPostCoordinates(rec);
    const author = getPostAuthorSummary(rec);
    const eng = getPostEngagementCounts(rec);
    return {
      id: postId,
      postId,
      userId: author.userId ?? "",
      userHandle: author.handle ?? "",
      userName: author.displayName ?? "",
      userPic: sanitizeProfilePic(author.profilePicUrl ?? data.userPic),
      title: getPostTitle(rec),
      caption: getPostCaption(rec),
      description: getPostDescription(rec),
      activities,
      thumbUrl: thumb,
      displayPhotoLink: String(data.displayPhotoLink ?? thumb).trim(),
      mediaType,
      likeCount: eng.likeCount,
      commentCount: eng.commentCount,
      updatedAtMs: orderMillis,
      lat: coords.lat,
      lng: coords.lng,
      stateRegionId: getPostStateRegionId(rec),
      cityRegionId: getPostCityRegionId(rec),
      rawFirestore: rec,
    };
  }
}

function sanitizeProfilePic(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (/via\.placeholder\.com/i.test(value) || /placeholder/i.test(value)) return null;
  return value;
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
