import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { SearchBootstrapQuerySchema } from "../../contracts/surfaces/search-bootstrap.contract.js";
import { SearchSuggestQuerySchema } from "../../contracts/surfaces/search-suggest.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { SearchDiscoveryService } from "../../services/surfaces/search-discovery.service.js";
import { SearchAutofillService } from "../../services/search-autofill/search-autofill.service.js";
import { SearchMixesOrchestrator } from "../../orchestration/searchMixes.orchestrator.js";

const SUGGEST_CACHE_TTL_MS = 20_000;
const SUGGEST_CACHE_MAX_KEYS = 200;
const SEARCH_BOOTSTRAP_CACHE_TTL_MS = 20_000;
const ENABLE_LEGACY_SUGGEST_BRIDGE = process.env.SEARCH_V2_ENABLE_LEGACY_SUGGEST === "1";
const ENABLE_LEGACY_SEARCH_ENGINE = process.env.SEARCH_V2_ENABLE_LEGACY_SEARCH_ENGINE === "1";
const suggestCache = new Map<string, { expiresAtMs: number; payload: Record<string, unknown> }>();
const suggestInFlight = new Map<string, Promise<Record<string, unknown>>>();
const searchBootstrapCache = new Map<string, { expiresAtMs: number; payload: Record<string, unknown> }>();
const searchBootstrapInFlight = new Map<string, Promise<Record<string, unknown>>>();
const mixesCatalogCache = new Map<string, { expiresAtMs: number; payload: Record<string, unknown> }>();
const mixesCatalogInFlight = new Map<string, Promise<Record<string, unknown>>>();
const mixesAreaCache = new Map<string, { expiresAtMs: number; payload: Record<string, unknown> }>();
const mixesAreaInFlight = new Map<string, Promise<Record<string, unknown>>>();

const US_STATES = [
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia",
  "hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts",
  "michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey",
  "new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
  "south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia",
  "wisconsin","wyoming"
];
const FAST_ACTIVITY_HINTS = [
  "hiking","waterfall","swimming","restaurants","beach","sunset","mountain","park","ocean","abandoned","view"
];
type LegacySuggestMods = {
  suggestionsService: { generateSuggestions: (q: string, userContext?: unknown, opts?: unknown) => Promise<Array<Record<string, unknown>>> };
  parserService: { parseQuery: (q: string) => { entities?: Record<string, unknown> } };
  relatedActivities: Record<string, string[]>;
};
type LegacySearchMods = {
  runLiveSearch: (input: {
    query: string;
    viewerUid: string | null;
    lat?: number | null;
    lng?: number | null;
    limit?: number;
    debug?: boolean;
    userContext?: { lat?: number; lng?: number } | null;
  }) => Promise<Record<string, unknown>>;
  explorePostsForQuery: (input: {
    query: string;
    lat?: number | null;
    lng?: number | null;
    limit?: number;
    fastOnly?: boolean;
  }) => Promise<Record<string, unknown>>;
};
let legacySuggestModsPromise: Promise<LegacySuggestMods> | null = null;
let legacySearchModsPromise: Promise<LegacySearchMods> | null = null;

function ensureLegacyFirebaseEnv(): void {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath || !fs.existsSync(credsPath)) return;
  try {
    const raw = fs.readFileSync(credsPath, "utf8");
    const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    if (!process.env.FIREBASE_PROJECT_ID && parsed.project_id) process.env.FIREBASE_PROJECT_ID = parsed.project_id;
    if (!process.env.FIREBASE_CLIENT_EMAIL && parsed.client_email) process.env.FIREBASE_CLIENT_EMAIL = parsed.client_email;
    if (!process.env.FIREBASE_PRIVATE_KEY && parsed.private_key) process.env.FIREBASE_PRIVATE_KEY = parsed.private_key;
  } catch {
    // noop
  }
}

async function loadLegacySuggestMods(): Promise<LegacySuggestMods> {
  if (!legacySuggestModsPromise) {
    legacySuggestModsPromise = (async () => {
      ensureLegacyFirebaseEnv();
      const root = path.resolve(process.cwd(), "..", "Locava Backend");
      const suggestionsMod = await import(pathToFileURL(path.join(root, "src/services/search/suggestions.service.ts")).href);
      const parserMod = await import(pathToFileURL(path.join(root, "src/services/search/parser.service.ts")).href);
      const relatedRaw = fs.readFileSync(path.join(root, "src/config/related.activities.json"), "utf8");
      const relatedActivities = JSON.parse(relatedRaw) as Record<string, string[]>;
      return {
        suggestionsService: suggestionsMod.suggestionsService as LegacySuggestMods["suggestionsService"],
        parserService: parserMod.parserService as LegacySuggestMods["parserService"],
        relatedActivities
      };
    })();
  }
  return legacySuggestModsPromise;
}

async function loadLegacySearchMods(): Promise<LegacySearchMods> {
  if (!legacySearchModsPromise) {
    legacySearchModsPromise = (async () => {
      ensureLegacyFirebaseEnv();
      const root = path.resolve(process.cwd(), "..", "Locava Backend");
      const liveMod = await import(pathToFileURL(path.join(root, "src/services/search/live/liveSearch.service.ts")).href);
      const bootstrapMod = await import(pathToFileURL(path.join(root, "src/services/search/searchExplorePosts.service.ts")).href);
      return {
        runLiveSearch: liveMod.runLiveSearch as LegacySearchMods["runLiveSearch"],
        explorePostsForQuery: bootstrapMod.explorePostsForQuery as LegacySearchMods["explorePostsForQuery"]
      };
    })();
  }
  return legacySearchModsPromise;
}

function legacySuggestionType(row: Record<string, unknown>): string {
  const type = String(row.type ?? "");
  if (type === "user") return "user";
  if (type === "town") return "place";
  const data = (row.data as Record<string, unknown> | undefined) ?? {};
  if (typeof data.activity === "string" && data.activity.length > 0) return "activity";
  return "template";
}

function legacySuggestionBadge(row: Record<string, unknown>): string | undefined {
  const text = String(row.text ?? "").toLowerCase();
  if (/near me|nearby|near you/.test(text)) return "Near you";
  const within = text.match(/within (\d+)\s*miles?/);
  if (within) return `Within ${within[1]} mi`;
  if (/this weekend|weekend/.test(text)) return "This weekend";
  if (/scenic|sunset|sunrise|view|overlook/.test(text)) return "Scenic";
  return undefined;
}
const ACTIVITY_COMPLETIONS: Record<string, string> = {
  h: "hiking",
  hi: "hiking",
  hik: "hiking",
  hiki: "hiking",
  hike: "hiking",
  water: "waterfall",
  waterf: "waterfall",
  swim: "swimming",
  sun: "sunset",
  coff: "coffee",
  caf: "cafe",
  brun: "brunch",
};

function splitQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeTerm(input: string): string {
  const t = input.trim().toLowerCase();
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("es") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("s") && t.length > 3) return t.slice(0, -1);
  return t;
}

function extractLocationFragment(query: string): string {
  const q = query.trim().toLowerCase();
  const idx = q.lastIndexOf(" in ");
  if (idx < 0) return "";
  return q.slice(idx + 4).trim();
}

function detectNearMeQuery(query: string): boolean {
  const q = query.toLowerCase();
  return q.includes("near me") || q.includes("nearby") || q.includes("near you");
}

function trimSuggestCache(): void {
  while (suggestCache.size > SUGGEST_CACHE_MAX_KEYS) {
    const oldestKey = suggestCache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    suggestCache.delete(oldestKey);
  }
}

function trimBootstrapCache(): void {
  while (searchBootstrapCache.size > SUGGEST_CACHE_MAX_KEYS) {
    const oldestKey = searchBootstrapCache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    searchBootstrapCache.delete(oldestKey);
  }
}

function buildStateCompletions(query: string): string[] {
  const q = String(query ?? "").trim().toLowerCase();
  const inMatch = q.match(/\bin\s+([a-z\s]*)$/i);
  if (!inMatch) return [];
  const partial = String(inMatch[1] ?? "").trim().toLowerCase();
  if (!partial) return [];
  return US_STATES.filter((state) => state.startsWith(partial)).slice(0, 4);
}

function buildWordCompletion(query: string, activities: string[]): string | null {
  const q = String(query ?? "").trim().toLowerCase();
  const bestMatch = q.match(/^best\s+([a-z]+)$/i);
  if (!bestMatch) return null;
  const partial = String(bestMatch[1] ?? "").trim().toLowerCase();
  if (partial.length < 2) return null;
  const completion = activities.find((activity) => activity.startsWith(partial));
  if (!completion) return null;
  return `best ${completion}`;
}

function buildWordCompletionFromHints(query: string): string | null {
  const q = String(query ?? "").trim().toLowerCase();
  const bestMatch = q.match(/^best\s+([a-z]+)$/i);
  if (!bestMatch) return null;
  const partial = String(bestMatch[1] ?? "").trim().toLowerCase();
  if (partial.length < 2) return null;
  const completion = FAST_ACTIVITY_HINTS.find((activity) => activity.startsWith(partial));
  return completion ? `best ${completion}` : null;
}

function resolveActivityCompletion(query: string, topActivities: string[]): string | null {
  const q = String(query ?? "").trim().toLowerCase();
  const token = q.split(/\s+/).filter(Boolean).at(-1) ?? q;
  const dictHit = ACTIVITY_COMPLETIONS[token] ?? null;
  if (dictHit) return dictHit;
  const byHint = FAST_ACTIVITY_HINTS.find((activity) => activity.startsWith(token));
  if (byHint) return byHint;
  const byTop = topActivities.find((activity) => activity.startsWith(token));
  return byTop ?? null;
}

function buildBestInStateCompletionsFromHints(query: string): { activity: string; rows: Array<Record<string, unknown>> } | null {
  const q = String(query ?? "").trim().toLowerCase();
  const match = q.match(/^best\s+([a-z]+)\s+in\s+([a-z\s]*)$/i);
  if (!match) return null;
  const activityPartialRaw = String(match[1] ?? "").trim().toLowerCase();
  const activityPartial = normalizeTerm(activityPartialRaw);
  const statePartial = String(match[2] ?? "").trim().toLowerCase();
  if (activityPartial.length < 2) return null;
  const activity = FAST_ACTIVITY_HINTS.find((value) => normalizeTerm(value).startsWith(activityPartial));
  if (!activity) return null;
  const states = statePartial.length > 0
    ? US_STATES.filter((state) => state.startsWith(statePartial)).slice(0, 4)
    : US_STATES.slice(0, 4);
  const rows = states.map((state) => ({
    text: `best ${activity} in ${state}`,
    type: "sentence",
    suggestionType: "template",
    data: { activity, stateRegionId: state }
  }));
  return { activity, rows };
}

function decodeMixCursor(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const value = trimmed.startsWith("cursor:") ? Number(trimmed.slice("cursor:".length)) : Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function tokenizeNormalized(input: unknown): string[] {
  return String(input ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExactPhrase(haystack: string, needle: string): boolean {
  const source = String(haystack ?? "").trim().toLowerCase();
  const target = String(needle ?? "").trim().toLowerCase();
  if (!source || !target) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(target)}([^a-z0-9]|$)`, "i");
  return re.test(source);
}

function hasLikelyActivityTagSpam(activities: unknown[]): boolean {
  if (!Array.isArray(activities) || activities.length === 0) return false;
  const normalized = activities
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  const uniqueCount = new Set(normalized).size;
  // "Everything tag soup" rows contaminate mix relevance and should not rank for activity mixes.
  return normalized.length > 20 || uniqueCount > 18;
}

function postToSearchRow(post: Record<string, unknown>): Record<string, unknown> {
  return {
    postId: String(post.postId ?? post.id ?? ""),
    id: String(post.id ?? post.postId ?? ""),
    userId: String(post.userId ?? ""),
    thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),
    displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),
    title: String(post.title ?? ""),
    activities: Array.isArray(post.activities) ? post.activities : []
  };
}

function collectionToSearchRow(item: Record<string, unknown>): Record<string, unknown> {
  const id = String(item.id ?? item.collectionId ?? "");
  const title = String(item.name ?? item.title ?? "");
  const description = String(item.description ?? item.subtitle ?? "");
  const coverUri = String(item.coverPhotoUrl ?? item.coverUri ?? item.thumbUrl ?? "");
  const postCountRaw = item.itemCount ?? item.postCount;
  const postCount = Number.isFinite(Number(postCountRaw)) ? Number(postCountRaw) : undefined;
  return {
    id,
    collectionId: id,
    title,
    description,
    coverUri,
    ...(postCount !== undefined ? { postCount } : {})
  };
}

export async function registerV2SearchDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  const service = new SearchDiscoveryService();
  const autofillService = new SearchAutofillService();
  const mixesOrchestrator = new SearchMixesOrchestrator();

  app.get<{ Querystring: { q?: string } }>("/v2/search/suggest", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    const query = SearchSuggestQuerySchema.parse(request.query);
    setRouteName("search.suggest.get");
    const q = String(query.q ?? "").trim().toLowerCase();
    if (!q) return success({ routeName: "search.suggest.get", suggestions: [], detectedActivity: null, relatedActivities: [] });
    const cacheKey = `v2_suggest:${q}`;
    const cached = suggestCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return success(cached.payload);
    }
    const existingInFlight = suggestInFlight.get(cacheKey);
    if (existingInFlight) {
      return success(await existingInFlight);
    }
    const loadPromise = (async (): Promise<Record<string, unknown>> => {
      const payload = await autofillService.suggest({
        query: q,
        lat: Number.isFinite(query.lat) ? Number(query.lat) : null,
        lng: Number.isFinite(query.lng) ? Number(query.lng) : null,
        mode: "social",
        viewerId: viewer.viewerId
      });
      suggestCache.set(cacheKey, { expiresAtMs: Date.now() + SUGGEST_CACHE_TTL_MS, payload });
      trimSuggestCache();
      return payload as unknown as Record<string, unknown>;
    })();
    suggestInFlight.set(cacheKey, loadPromise);
    try {
      return success(await loadPromise);
    } finally {
      suggestInFlight.delete(cacheKey);
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/v2/mixes/catalog", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("mixes.catalog.get");
    const limit = Math.max(1, Math.min(24, Number(request.query.limit ?? 24) || 24));
    const cacheKey = `mixes_catalog:${viewer.viewerId}:${limit}`;
    const cached = mixesCatalogCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return success(cached.payload);
    }
    const inFlight = mixesCatalogInFlight.get(cacheKey);
    if (inFlight) {
      return success(await inFlight);
    }
    const run = (async () => {
      const mixSpecs = service.buildMixSpecsFromActivities(await service.loadTopActivities(limit));
      return { routeName: "mixes.catalog.get", mixSpecs, rankingVersion: "mix_v1" };
    })();
    mixesCatalogInFlight.set(cacheKey, run);
    try {
      const payload = await run;
      mixesCatalogCache.set(cacheKey, { expiresAtMs: Date.now() + 60_000, payload });
      return success(payload);
    } finally {
      mixesCatalogInFlight.delete(cacheKey);
    }
  });

  app.post("/v2/mixes/prewarm", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    const mixSpecs = service.buildMixSpecsFromActivities(await service.loadTopActivities(8));
    const posts = await service.loadRecentPosts(24);
    const previews = mixSpecs.map((mix) => ({
      mixId: mix.id,
      spec: mix,
      posts: posts.slice(0, 8),
      success: true
    }));
    return success({
      routeName: "mixes.prewarm.post",
      mixSpecs,
      previews,
      profileVersion: "v2-search-mix-1",
      rankingVersion: "mix_v1"
    });
  });

  app.post<{ Body: { mixSpecs?: Array<Record<string, unknown>>; previewLimit?: number } }>("/v2/mixes/previews", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    const mixSpecs = Array.isArray(request.body?.mixSpecs) ? request.body?.mixSpecs ?? [] : [];
    const previewLimit = Math.max(2, Math.min(10, Number(request.body?.previewLimit ?? 8) || 8));
    const posts = await service.loadRecentPosts(32);
    const previews = mixSpecs.map((mix, index) => ({
      mixId: String(mix.id ?? `mix_${index + 1}`),
      spec: mix,
      posts: posts.slice(0, previewLimit),
      success: true
    }));
    return success({ routeName: "mixes.previews.post", previews, rankingVersion: "mix_v1" });
  });

  app.post<{ Body: { query?: string } }>("/v2/mixes/suggest", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    const query = String(request.body?.query ?? "").trim().toLowerCase();
    if (!query) return success({ routeName: "mixes.suggest.post", candidates: [], previews: [], rankingVersion: "mix_v1" });
    const mixSpecs = service
      .buildMixSpecsFromActivities(await service.loadTopActivities(20))
      .filter((spec) => spec.title.toLowerCase().includes(query) || spec.seeds.primaryActivityId.includes(query));
    const posts = await service.loadRecentPosts(16);
    const candidates = mixSpecs.map((spec) => ({
      type: "mix",
      canonicalKey: spec.id,
      displayTitle: spec.title,
      displaySubtitle: spec.subtitle,
      heroQuery: spec.heroQuery,
      previewThumbUrls: posts.map((p) => String(p.thumbUrl ?? "")).filter((u) => /^https?:\/\//i.test(u)).slice(0, 4),
      queryDefinition: { query: spec.seeds.primaryActivityId },
      mixSpecV1: spec
    }));
    return success({ routeName: "mixes.suggest.post", candidates, previews: [], rankingVersion: "mix_v1" });
  });

  app.post<{ Body: { mixSpec?: Record<string, unknown>; limit?: number; cursor?: string | null; lat?: number; lng?: number } }>(
    "/v2/mixes/feed",
    async (request, reply) => {
      const viewer = buildViewerContext(request);
      if (!canUseV2Surface("search", viewer.roles)) {
        return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
      }
      setRouteName("mixes.feed.post");
      try {
        const limit = Math.max(1, Math.min(36, Number(request.body?.limit ?? 20) || 20));
        const cursorOffset = decodeMixCursor(request.body?.cursor);
        const mixSpec = (request.body?.mixSpec ?? {}) as Record<string, unknown>;
        const seedActivityRaw =
          ((mixSpec.seeds as Record<string, unknown> | undefined)?.primaryActivityId as string | undefined) ??
          (mixSpec.heroQuery as string | undefined) ??
          "";
        const seedActivity = String(seedActivityRaw).trim().toLowerCase();

        const mixId = seedActivity ? `activity:${seedActivity}` : "nearby:near_you";
        const payload = await mixesOrchestrator.feedPage({
          viewerId: viewer.viewerId,
          mixId,
          lat: typeof request.body?.lat === "number" && Number.isFinite(request.body.lat) ? request.body.lat : null,
          lng: typeof request.body?.lng === "number" && Number.isFinite(request.body.lng) ? request.body.lng : null,
          limit,
          cursor: null,
          cursorOffsetOverride: cursorOffset,
          includeDebug: Boolean((request.body as any)?.includeDebug),
        });

        const hasMore = payload.hasMore;
        request.log.info(
          {
            event: "MIX_FEED_V2",
            mixId,
            seedActivity,
            cursorOffset,
            limit,
            postsReturned: Array.isArray(payload.posts) ? payload.posts.length : 0,
            hasMore
          },
          "mix feed v2"
        );
        return success({
          routeName: "mixes.feed.post",
          posts: payload.posts,
          nextCursor: hasMore ? `cursor:${cursorOffset + limit}` : null,
          hasMore,
          rankingVersion: "mix_v1"
        });
      } catch (error) {
        return reply.status(503).send(failure("upstream_unavailable", "Mix feed is temporarily unavailable"));
      }
    }
  );

  app.post<{ Body: { limit?: number; lat?: number; lng?: number } }>("/v2/mixes/area", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    setRouteName("mixes.area.post");
    const limit = Math.max(1, Math.min(40, Number(request.body?.limit ?? 20) || 20));
    const lat = Number(request.body?.lat);
    const lng = Number(request.body?.lng);
    const roundedLat = Number.isFinite(lat) ? Math.round(lat * 10) / 10 : 0;
    const roundedLng = Number.isFinite(lng) ? Math.round(lng * 10) / 10 : 0;
    const cacheKey = `mixes_area:${viewer.viewerId}:${roundedLat}:${roundedLng}:${limit}`;
    const cached = mixesAreaCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return success(cached.payload);
    }
    const inFlight = mixesAreaInFlight.get(cacheKey);
    if (inFlight) {
      return success(await inFlight);
    }
    const run = (async () => {
      try {
        const payload = await mixesOrchestrator.feedPage({
          viewerId: viewer.viewerId,
          mixId: "nearby:near_you",
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
          limit,
          cursor: null,
          cursorOffsetOverride: 0,
          includeDebug: false,
        });
        const posts = payload.posts;
        return {
          routeName: "mixes.area.post",
          townDisplayName: "Near you",
          posts,
          showNearYouCopy: true
        };
      } catch (error) {
        return {
          routeName: "mixes.area.post",
          townDisplayName: "Near you",
          posts: [],
          showNearYouCopy: true
        };
      }
    })();
    mixesAreaInFlight.set(cacheKey, run);
    try {
      const payload = await run;
      mixesAreaCache.set(cacheKey, { expiresAtMs: Date.now() + 45_000, payload });
      return success(payload);
    } finally {
      mixesAreaInFlight.delete(cacheKey);
    }
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>("/v2/search/bootstrap", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    const queryParams = SearchBootstrapQuerySchema.parse(request.query);
    setRouteName("search.bootstrap.get");
    const query = String(queryParams.q ?? "").trim();
    const limit = queryParams.limit;
    const lat = Number(queryParams.lat);
    const lng = Number(queryParams.lng);
    const normalized = query.trim().toLowerCase();
    const cacheKey = `search_bootstrap:${normalized}:${limit}:${Number.isFinite(lat) ? lat.toFixed(2) : "_"}:${Number.isFinite(lng) ? lng.toFixed(2) : "_"}`;
    const cached = searchBootstrapCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return success(cached.payload);
    }
    const existingInFlight = searchBootstrapInFlight.get(cacheKey);
    if (existingInFlight) {
      return success(await existingInFlight);
    }
    const modernBootstrapPromise = (async (): Promise<Record<string, unknown>> => {
      const payload = (await service.buildBootstrapPayload({
        query,
        limit,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      })) as unknown as Record<string, unknown>;
      searchBootstrapCache.set(cacheKey, { expiresAtMs: Date.now() + SEARCH_BOOTSTRAP_CACHE_TTL_MS, payload });
      trimBootstrapCache();
      return payload;
    })();
    searchBootstrapInFlight.set(cacheKey, modernBootstrapPromise);
    try {
      return success(await modernBootstrapPromise);
    } finally {
      searchBootstrapInFlight.delete(cacheKey);
    }
    const loadPromise = (async (): Promise<Record<string, unknown>> => {
    if (ENABLE_LEGACY_SEARCH_ENGINE) {
      try {
        const legacy = await loadLegacySearchMods();
        const result = await legacy.explorePostsForQuery({
          query,
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
          limit,
          fastOnly: false
        });
        if (result.success === true) {
          const legacyPosts = ((result.posts ?? []) as Array<Record<string, unknown>>).map((post) => postToSearchRow(post));
          return success({
            routeName: "search.bootstrap.get",
            posts: legacyPosts,
            rails: [],
            suggestedUsers: [],
            popularActivities: [],
            parsedSummary: (result.parsedSummary as Record<string, unknown> | undefined) ?? {
              activity: null,
              nearMe: false,
              genericDiscovery: false
            }
          });
        }
      } catch {
        // fall through to native v2 behavior
      }
    }
    let canonicalQuery = query;
    if (ENABLE_LEGACY_SUGGEST_BRIDGE) {
      try {
        const legacy = await loadLegacySuggestMods();
        const parsed = legacy.parserService.parseQuery(query);
        const parsedActivity = (parsed.entities?.activity as { canonical?: string } | undefined)?.canonical;
        if (typeof parsedActivity === "string" && parsedActivity.trim().length > 0) {
          canonicalQuery = parsedActivity.trim().toLowerCase();
        }
      } catch {
        // keep original query when parser is unavailable
      }
    }
    if (query.length < 2) {
      const [topActivities, suggestedUsers, recentPosts] = await Promise.all([
        service.loadTopActivities(8),
        service.loadSuggestedUsers(8),
        service.loadRecentPosts(Math.max(32, limit))
      ]);
      const byActivity = new Map<string, Array<Record<string, unknown>>>();
      for (const post of recentPosts) {
        const list = Array.isArray(post.activities) ? post.activities : [];
        for (const raw of list) {
          const key = String(raw ?? "").trim().toLowerCase();
          if (!key) continue;
          const rows = byActivity.get(key) ?? [];
          if (rows.length < 8) rows.push(postToSearchRow(post as unknown as Record<string, unknown>));
          byActivity.set(key, rows);
        }
      }
      const rails = topActivities.slice(0, 4).map((activity) => ({
        id: `activity:${activity}`,
        title: activity,
        posts: byActivity.get(activity) ?? []
      }));
      const payload = {
        routeName: "search.bootstrap.get",
        posts: recentPosts.slice(0, limit).map((p) => postToSearchRow(p as unknown as Record<string, unknown>)),
        rails,
        suggestedUsers,
        popularActivities: topActivities,
        parsedSummary: { activity: null, nearMe: false, genericDiscovery: false }
      };
      searchBootstrapCache.set(cacheKey, { expiresAtMs: Date.now() + SEARCH_BOOTSTRAP_CACHE_TTL_MS, payload });
      trimBootstrapCache();
      return payload;
    }
    const canonicalPosts = (
      await service.searchPostsForQuery(canonicalQuery, { limit: Math.max(limit + 4, 16) })
    )
      .slice(0, limit)
      .map((post) => postToSearchRow(post as unknown as Record<string, unknown>));
    const payload = {
      routeName: "search.bootstrap.get",
      posts: canonicalPosts,
      rails: [],
      suggestedUsers: [],
      popularActivities: [],
      parsedSummary: { activity: canonicalQuery.trim().toLowerCase(), nearMe: detectNearMeQuery(query), genericDiscovery: false }
    };
    searchBootstrapCache.set(cacheKey, { expiresAtMs: Date.now() + SEARCH_BOOTSTRAP_CACHE_TTL_MS, payload });
    trimBootstrapCache();
    return payload;
    })();
    searchBootstrapInFlight.set(cacheKey, loadPromise);
    try {
      return success(await loadPromise);
    } finally {
      searchBootstrapInFlight.delete(cacheKey);
    }
  });

  app.post<{ Body: { query?: string; limit?: number; userContext?: { lat?: number; lng?: number } } }>("/v2/search/bootstrap", async (request, reply) => {
    const q = String(request.body?.query ?? "").trim();
    const limit = Math.max(1, Math.min(80, Number(request.body?.limit ?? 24) || 24));
    const lat = Number(request.body?.userContext?.lat);
    const lng = Number(request.body?.userContext?.lng);
    const result = await app.inject({
      method: "GET",
      url: `/v2/search/bootstrap?q=${encodeURIComponent(q)}&limit=${limit}${
        Number.isFinite(lat) && Number.isFinite(lng)
          ? `&lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
          : ""
      }`,
      headers: {
        "x-viewer-id": buildViewerContext(request).viewerId,
        "x-viewer-roles": "internal"
      }
    });
    return reply.status(result.statusCode).send(result.json());
  });

  app.post<{ Body: { query?: string; limit?: number } }>("/v2/search/live", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Search v2 surface is not enabled for this viewer"));
    }
    const query = String(request.body?.query ?? "").trim();
    const limit = Math.max(1, Math.min(30, Number(request.body?.limit ?? 20) || 20));
    if (ENABLE_LEGACY_SEARCH_ENGINE) {
      try {
        const legacy = await loadLegacySearchMods();
        const result = await legacy.runLiveSearch({
          query,
          viewerUid: viewer.viewerId,
          limit,
          debug: false,
          userContext: null
        });
        if (result.success === true) {
          const liveRows = Array.isArray(result.results) ? (result.results as Array<Record<string, unknown>>) : [];
          const posts = liveRows
            .filter((row) => String(row.kind ?? "") === "post")
            .map((row) => postToSearchRow((row.post as Record<string, unknown> | undefined) ?? row));
          const users = liveRows
            .filter((row) => String(row.kind ?? "") === "user")
            .map((row) => {
              const userRow = (row.user as Record<string, unknown> | undefined) ?? row;
              return {
                id: String(userRow.userId ?? userRow.id ?? ""),
                userId: String(userRow.userId ?? userRow.id ?? ""),
                handle: String(userRow.handle ?? ""),
                name: String(userRow.name ?? userRow.displayName ?? ""),
                profilePic: String(userRow.profilePic ?? userRow.avatarUrl ?? "")
              };
            });
          const collections = liveRows
            .filter((row) => {
              const kind = String(row.kind ?? "");
              return kind === "collection" || kind === "mix";
            })
            .map((row) => ((row.collection as Record<string, unknown> | undefined) ?? row));
          const groups = liveRows
            .filter((row) => String(row.kind ?? "") === "group")
            .map((row) => ((row.group as Record<string, unknown> | undefined) ?? row));
          return success({
            routeName: "search.live.post",
            posts,
            users,
            suggestions: (result.suggestions ?? []) as Array<Record<string, unknown>>,
            detectedActivity: null,
            relatedActivities: [],
            collections,
            groups
          });
        }
      } catch {
        // fall through to native v2 behavior
      }
    }
    if (query.length < 2) {
    const [bootstrapRes] = await Promise.all([
        app.inject({
          method: "GET",
          url: `/v2/search/bootstrap?q=&limit=${Math.min(40, Math.max(24, limit))}`,
          headers: { "x-viewer-id": viewer.viewerId, "x-viewer-roles": "internal" }
        }),
      ]);
      const bootstrapData = ((bootstrapRes.json() as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
      const posts = ((bootstrapData.posts ?? []) as Array<Record<string, unknown>>).map(postToSearchRow);
      return success({
        routeName: "search.live.post",
        posts,
        users: [],
        collections: [],
        groups: []
      });
    }

    const [resultsRes, usersRes, suggestRes] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/v2/search/results?q=${encodeURIComponent(query)}&limit=${Math.min(12, limit)}`,
        headers: { "x-viewer-id": viewer.viewerId, "x-viewer-roles": "internal" }
      }),
      app.inject({
        method: "GET",
        url: `/v2/search/users?q=${encodeURIComponent(query)}&limit=8`,
        headers: { "x-viewer-id": viewer.viewerId, "x-viewer-roles": "internal" }
      }),
      app.inject({
        method: "GET",
        url: `/v2/search/suggest?q=${encodeURIComponent(query)}`,
        headers: { "x-viewer-id": viewer.viewerId, "x-viewer-roles": "internal" }
      }),
    ]);
    let posts = (
      (((resultsRes.json() as Record<string, unknown>).data as Record<string, unknown> | undefined)?.items ?? []) as Array<Record<string, unknown>>
    ).map(postToSearchRow);
    if (posts.length === 0) {
      posts = (await service.searchPostsForQuery(query, { limit })).map((post) => postToSearchRow(post as unknown as Record<string, unknown>));
    }
    const users = (
      (((usersRes.json() as Record<string, unknown>).data as Record<string, unknown> | undefined)?.items ?? []) as Array<Record<string, unknown>>
    ).map((item) => ({
        id: String(item.userId ?? item.id ?? ""),
        userId: String(item.userId ?? item.id ?? ""),
        handle: String(item.handle ?? ""),
        name: String(item.name ?? ""),
        profilePic: String(item.profilePic ?? "")
      }));
    const suggestData = ((suggestRes.json() as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return success({
      routeName: "search.live.post",
      posts,
      users,
      suggestions: (suggestData.suggestions ?? []) as Array<Record<string, unknown>>,
      detectedActivity: suggestData.detectedActivity ?? query.toLowerCase(),
      relatedActivities: (suggestData.relatedActivities ?? []) as Array<string>,
      collections: [],
      groups: []
    });
  });
}
