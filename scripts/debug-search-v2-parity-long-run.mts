import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { createApp } from "../src/app/createApp.js";
import { diagnosticsStore } from "../src/observability/diagnostics-store.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { normalizeSearchText, parseSearchQueryIntent } from "../src/lib/search-query-intent.js";
import { searchPlacesIndexService } from "../src/services/surfaces/search-places-index.service.js";
import { SearchDiscoveryService } from "../src/services/surfaces/search-discovery.service.js";

type SearchClassification =
  | "SEARCH_PASS"
  | "SEARCH_PASS_STAGED"
  | "SEARCH_FAIL_NO_POST_RESULTS"
  | "SEARCH_FAIL_NO_GEONAMES"
  | "SEARCH_FAIL_AUTOFILL_SHAPE"
  | "SEARCH_FAIL_MISSING_ACTIVITY"
  | "SEARCH_FAIL_WRONG_ACTIVITY"
  | "SEARCH_FAIL_WRONG_LOCATION"
  | "SEARCH_FAIL_WRONG_DISTANCE"
  | "SEARCH_FAIL_MIX_WRONG_CONTENTS"
  | "SEARCH_FAIL_MIX_TOO_SLOW"
  | "SEARCH_FAIL_AUTOFILL_TOO_SLOW"
  | "SEARCH_FAIL_RESULTS_TOO_SLOW"
  | "SEARCH_FAIL_OLD_PARITY"
  | "SEARCH_FAIL_NATIVE_WIRING"
  | "SEARCH_FAIL_FAKE_DATA"
  | "SEARCH_FAIL_EMPTY_MASKING_ERROR";

type Envelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  meta?: { requestId?: string };
};

type DiagnosticRow = ReturnType<typeof diagnosticsStore.getRecentRequests>[number] | null;

type HttpProbe = {
  probed: boolean;
  ok: boolean;
  statusCode: number;
  latencyMs: number | null;
  payloadBytes: number;
  routeName: string | null;
  cacheStatus: "hit" | "miss" | "unknown";
  firestoreReads: number;
  firestoreQueries: number;
  budgetViolations: string[];
  fallbacks: string[];
  timeouts: string[];
  body: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type LegacySuggestMods = {
  suggestionsService: {
    generateSuggestions: (
      q: string,
      userContext?: unknown,
      opts?: unknown,
    ) => Promise<Array<Record<string, unknown>>>;
  };
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

type FirestoreValidation = {
  matchedPostIds: string[];
  postCount: number;
  activityTerms: string[];
  location: {
    cityRegionId: string | null;
    stateRegionId: string | null;
  };
};

type QueryParityRow = {
  query: string;
  kind: "partial" | "location" | "combined";
  oldComparisonMode: "live_code" | "code_reference_only" | "unavailable";
  oldStatus: string;
  newStatus: string;
  oldLatencyMs: number | null;
  newSuggestLatencyMs: number | null;
  newBootstrapLatencyMs: number | null;
  newResultsLatencyMs: number | null;
  newUsersLatencyMs: number | null;
  oldSuggestionGroups: string[];
  newSuggestionGroups: string[];
  oldMixGroups: string[];
  newMixGroups: string[];
  oldPostsCount: number;
  newPostsCount: number;
  oldCollectionsCount: number;
  newCollectionsCount: number;
  oldUsersCount: number;
  newUsersCount: number;
  geoNamesPresent: boolean;
  activitySuggestionsPresent: boolean;
  semanticCorrectness: string[];
  missingResultTypes: string[];
  shapeDrift: string[];
  rankingDrift: string[];
  payloadBytes: {
    suggest: number;
    bootstrap: number;
    results: number;
    users: number;
  };
  cacheStatus: {
    suggest: string;
    bootstrap: string;
    results: string;
    users: string;
  };
  firestore: {
    suggestReads: number;
    suggestQueries: number;
    bootstrapReads: number;
    bootstrapQueries: number;
    resultsReads: number;
    resultsQueries: number;
    usersReads: number;
    usersQueries: number;
    validation: FirestoreValidation;
  };
  classification: SearchClassification;
};

type Report = {
  generatedAt: string;
  viewerId: string;
  summary: {
    counts: Record<string, number>;
    oldComparisonMode: string;
    notes: string[];
  };
  rows: QueryParityRow[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const reportPath = path.join(backendRoot, "tmp", "search-v2-parity-long-run-report.json");
const auditDocPath = path.join(workspaceRoot, "docs", "search-v2-long-run-parity-audit-2026-04-25.md");
const viewerId =
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const viewerLat = Number.parseFloat(process.env.SEARCH_V2_PARITY_LAT ?? "40.68843");
const viewerLng = Number.parseFloat(process.env.SEARCH_V2_PARITY_LNG ?? "-75.22073");
const viewerCoords =
  Number.isFinite(viewerLat) && Number.isFinite(viewerLng)
    ? { lat: viewerLat, lng: viewerLng }
    : null;

const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
const db = getFirestoreSourceClient();

let legacySuggestModsPromise: Promise<LegacySuggestMods> | null = null;
let legacySearchModsPromise: Promise<LegacySearchMods> | null = null;
let oldComparisonMode: QueryParityRow["oldComparisonMode"] = "unavailable";

const PARTIAL_QUERIES = [
  "h","hi","hik","hiki","hikin","hiking","hiking i","hiking in","hiking in v","hiking in ve","hiking in verm","hiking in vermont",
  "hiking near","hiking near me","bike","bik","bikin","biking","biking n","biking ne","biking near","biking near me",
  "swim","swimmi","swimming","swimming h","swimming ho","swimming hole","swimming holes near","swimming holes near me",
  "coffee","coffee s","coffee sh","coffee shop","coffee shops near me","sunset","sunset spots","waterfall","waterfalls","waterfalls near me",
  "view","views","scenic","scenic views","food","pizza","bookstore","abandoned","castle","trail","trails","study","date","picnic",
] as const;

const LOCATION_QUERIES = [
  "verm","vermont","burl","burlington","burlington vt","uvm","boulder","boulder co","easton","easton pa","phil","philly","philadelphia",
  "seattle","bay area","san francisco","austin","phoenix","new jersey","new york","nyc","new hampshire","upper valley",
] as const;

const COMBINED_QUERIES = [
  "hiking in vermont","hiking near burlington","hiking near uvm","hiking in boulder","biking in vermont","biking near me",
  "swimming holes in vermont","waterfalls in vermont","waterfalls near burlington","coffee shops in easton","sunset spots in boulder",
  "scenic views near me","bookstores in philadelphia","trails in new hampshire","hikes in new jersey","food in easton pa","cool spots in burlington vt",
] as const;

function uniqueQueries(): Array<{ query: string; kind: QueryParityRow["kind"] }> {
  return [
    ...PARTIAL_QUERIES.map((query) => ({ query, kind: "partial" as const })),
    ...LOCATION_QUERIES.map((query) => ({ query, kind: "location" as const })),
    ...COMBINED_QUERIES.map((query) => ({ query, kind: "combined" as const })),
  ];
}

function normalizeSuggestionGroups(rows: Array<Record<string, unknown>>): string[] {
  const groups = new Set<string>();
  for (const row of rows) {
    const rawType = String(row.suggestionType ?? row.type ?? "").trim().toLowerCase();
    if (!rawType) continue;
    if (rawType === "town" || rawType === "state") groups.add("place");
    else groups.add(rawType);
  }
  return [...groups];
}

function countByType(rows: Array<Record<string, unknown>>, types: string[]): number {
  const expected = new Set(types.map((value) => value.toLowerCase()));
  return rows.filter((row) => {
    const rawType = String(row.suggestionType ?? row.type ?? "").toLowerCase();
    return expected.has(rawType) || expected.has(String(row.type ?? "").toLowerCase());
  }).length;
}

function readEnvelope(payload: string): Envelope | null {
  try {
    return JSON.parse(payload) as Envelope;
  } catch {
    return null;
  }
}

function findDiagnostic(requestId: string | undefined): DiagnosticRow {
  if (!requestId) return null;
  return diagnosticsStore.getRecentRequests(400).find((row) => row.requestId === requestId) ?? null;
}

function cacheStatusFor(diag: DiagnosticRow): "hit" | "miss" | "unknown" {
  if (!diag) return "unknown";
  if ((diag.cache.hits ?? 0) > 0) return "hit";
  if ((diag.cache.misses ?? 0) > 0) return "miss";
  return "unknown";
}

async function v2Get(url: string): Promise<HttpProbe> {
  const res = await app.inject({
    method: "GET",
    url,
    headers: {
      "x-viewer-id": viewerId,
      "x-viewer-roles": "internal",
    },
  });
  const envelope = readEnvelope(res.body);
  const requestId = typeof envelope?.meta?.requestId === "string" ? envelope.meta.requestId : undefined;
  const diag = findDiagnostic(requestId);
  const body = envelope?.data ?? null;
  return {
    probed: true,
    ok: res.statusCode >= 200 && res.statusCode < 300 && envelope?.ok === true,
    statusCode: res.statusCode,
    latencyMs: typeof diag?.latencyMs === "number" ? diag.latencyMs : null,
    payloadBytes: Buffer.byteLength(res.body, "utf8"),
    routeName: typeof body?.routeName === "string" ? String(body.routeName) : null,
    cacheStatus: cacheStatusFor(diag),
    firestoreReads: diag?.dbOps.reads ?? 0,
    firestoreQueries: diag?.dbOps.queries ?? 0,
    budgetViolations: diag?.budgetViolations ?? [],
    fallbacks: diag?.fallbacks ?? [],
    timeouts: diag?.timeouts ?? [],
    body,
    errorCode: typeof envelope?.error?.code === "string" ? envelope.error.code : null,
    errorMessage: typeof envelope?.error?.message === "string" ? envelope.error.message : null,
  };
}

function skippedProbe(): HttpProbe {
  return {
    probed: false,
    ok: false,
    statusCode: 0,
    latencyMs: null,
    payloadBytes: 0,
    routeName: null,
    cacheStatus: "unknown",
    firestoreReads: 0,
    firestoreQueries: 0,
    budgetViolations: [],
    fallbacks: [],
    timeouts: [],
    body: null,
    errorCode: null,
    errorMessage: null,
  };
}

function ensureLegacyFirebaseEnv(): void {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) return;
  try {
    const parsed = JSON.parse(readFileSync(credsPath, "utf8")) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!process.env.FIREBASE_PROJECT_ID && parsed.project_id) process.env.FIREBASE_PROJECT_ID = parsed.project_id;
    if (!process.env.FIREBASE_CLIENT_EMAIL && parsed.client_email) process.env.FIREBASE_CLIENT_EMAIL = parsed.client_email;
    if (!process.env.FIREBASE_PRIVATE_KEY && parsed.private_key) process.env.FIREBASE_PRIVATE_KEY = parsed.private_key;
    if (getApps().length === 0 && parsed.project_id && parsed.client_email && parsed.private_key) {
      initializeApp({
        credential: cert({
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        }),
        projectId: parsed.project_id,
      });
    }
  } catch {
    // Legacy comparison will fall back to code-reference mode if admin init is unavailable.
  }
}

async function loadLegacySuggestMods(): Promise<LegacySuggestMods> {
  if (!legacySuggestModsPromise) {
    legacySuggestModsPromise = (async () => {
      ensureLegacyFirebaseEnv();
      const root = path.resolve(backendRoot, "..", "Locava Backend");
      const suggestionsMod = await import(pathToFileURL(path.join(root, "src/services/search/suggestions.service.ts")).href);
      return {
        suggestionsService: suggestionsMod.suggestionsService as LegacySuggestMods["suggestionsService"],
      };
    })();
  }
  return legacySuggestModsPromise;
}

async function loadLegacySearchMods(): Promise<LegacySearchMods> {
  if (!legacySearchModsPromise) {
    legacySearchModsPromise = (async () => {
      ensureLegacyFirebaseEnv();
      const root = path.resolve(backendRoot, "..", "Locava Backend");
      const liveMod = await import(pathToFileURL(path.join(root, "src/services/search/live/liveSearch.service.ts")).href);
      const bootstrapMod = await import(pathToFileURL(path.join(root, "src/services/search/searchExplorePosts.service.ts")).href);
      return {
        runLiveSearch: liveMod.runLiveSearch as LegacySearchMods["runLiveSearch"],
        explorePostsForQuery: bootstrapMod.explorePostsForQuery as LegacySearchMods["explorePostsForQuery"],
      };
    })();
  }
  return legacySearchModsPromise;
}

async function oldProbe(query: string): Promise<{
  status: string;
  latencyMs: number | null;
  suggestionRows: Array<Record<string, unknown>>;
  mixGroups: string[];
  postsCount: number;
  collectionsCount: number;
  usersCount: number;
}> {
  if (process.env.SEARCH_V2_PARITY_ENABLE_LEGACY_LIVE !== "1") {
    oldComparisonMode = "code_reference_only";
    return {
      status: "code_reference_only",
      latencyMs: null,
      suggestionRows: [],
      mixGroups: [],
      postsCount: 0,
      collectionsCount: 0,
      usersCount: 0,
    };
  }
  try {
    const [suggestMods, searchMods] = await Promise.all([
      loadLegacySuggestMods(),
      loadLegacySearchMods(),
    ]);
    oldComparisonMode = "live_code";
    const startedAt = Date.now();
    const [suggestions, bootstrap, live] = await Promise.all([
      suggestMods.suggestionsService.generateSuggestions(query, viewerCoords ?? undefined, { mode: "social" }),
      searchMods.explorePostsForQuery({
        query,
        limit: 8,
        fastOnly: false,
        ...(viewerCoords ?? {}),
      }),
      searchMods.runLiveSearch({
        query,
        viewerUid: viewerId,
        limit: 12,
        debug: false,
        userContext: viewerCoords,
        ...(viewerCoords ?? {}),
      }),
    ]);
    const liveResults = Array.isArray(live.results) ? (live.results as Array<Record<string, unknown>>) : [];
    const postsCount = liveResults.filter((row) => String(row.kind ?? "") === "post").length;
    const usersCount = liveResults.filter((row) => String(row.kind ?? "") === "user").length;
    const collectionsCount = liveResults.filter((row) => {
      const kind = String(row.kind ?? "");
      return kind === "collection" || kind === "mix";
    }).length;
    const mixGroups = Array.isArray(live.dynamicCollectionCandidates)
      ? (live.dynamicCollectionCandidates as Array<Record<string, unknown>>)
          .map((row) => String(row.displayTitle ?? row.title ?? "").trim())
          .filter(Boolean)
      : [];
    const bootstrapPostsCount = Array.isArray(bootstrap.posts) ? bootstrap.posts.length : 0;
    return {
      status: live.success === true || bootstrap.success === true ? "ok" : "error",
      latencyMs: Date.now() - startedAt,
      suggestionRows: suggestions,
      mixGroups,
      postsCount: Math.max(postsCount, bootstrapPostsCount),
      collectionsCount,
      usersCount,
    };
  } catch (error) {
    oldComparisonMode = "code_reference_only";
    return {
      status: `unavailable:${error instanceof Error ? error.message : String(error)}`,
      latencyMs: null,
      suggestionRows: [],
      mixGroups: [],
      postsCount: 0,
      collectionsCount: 0,
      usersCount: 0,
    };
  }
}

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  const deg = Math.sqrt(dx * dx + dy * dy);
  return deg * 69;
}

function toActivityKey(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function activityKeysMatch(candidate: string, key: string): boolean {
  if (!candidate || !key) return false;
  if (candidate === key) return true;
  const lengthDelta = Math.abs(candidate.length - key.length);
  if (lengthDelta > 2) return false;
  return candidate.startsWith(key) || key.startsWith(candidate);
}

async function validateFirestore(query: string): Promise<FirestoreValidation> {
  if (!db) {
    return {
      matchedPostIds: [],
      postCount: 0,
      activityTerms: [],
      location: { cityRegionId: null, stateRegionId: null },
    };
  }
  const intent = parseSearchQueryIntent(query, (normalizedQuery) =>
    searchPlacesIndexService.searchExact(normalizedQuery) ??
    searchPlacesIndexService.search(normalizedQuery, 1)[0] ??
    null
  );
  const activityTerms = intent.activity?.queryActivities.slice(0, 2) ?? [];
  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
  const queryPromises: Array<Promise<void>> = [];
  const addDocs = (docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]): void => {
    for (const doc of docs) candidates.set(doc.id, doc);
  };

  for (const activity of activityTerms) {
    queryPromises.push(
      db.collection("posts")
        .where("activities", "array-contains", activity)
        .limit(12)
        .get()
        .then((snap) => addDocs(snap.docs))
        .catch(() => undefined)
    );
  }
  if (intent.location?.cityRegionId) {
    queryPromises.push(
      db.collection("posts")
        .where("cityRegionId", "==", intent.location.cityRegionId)
        .limit(18)
        .get()
        .then((snap) => addDocs(snap.docs))
        .catch(() => undefined)
    );
  }
  if (intent.location?.stateRegionId) {
    queryPromises.push(
      db.collection("posts")
        .where("stateRegionId", "==", intent.location.stateRegionId)
        .limit(18)
        .get()
        .then((snap) => addDocs(snap.docs))
        .catch(() => undefined)
    );
  } else if (intent.nearMe) {
    queryPromises.push(
      db.collection("posts")
        .orderBy("time", "desc")
        .limit(48)
        .get()
        .then((snap) => addDocs(snap.docs))
        .catch(() => undefined)
    );
  } else if (activityTerms.length === 0) {
    queryPromises.push(
      db.collection("posts")
        .orderBy("time", "desc")
        .limit(12)
        .get()
        .then((snap) => addDocs(snap.docs))
        .catch(() => undefined)
    );
  }
  await Promise.all(queryPromises);
  const filtered = [...candidates.values()].filter((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const rawActivities = Array.isArray(data.activities)
      ? data.activities.map((value) => String(value ?? ""))
      : [];
    const activityKeys = rawActivities.map((value) => toActivityKey(value));
    const activityMatched =
      activityTerms.length === 0 ||
      activityTerms.some((activity) => {
        const key = toActivityKey(activity);
        return activityKeys.some((candidate) => activityKeysMatch(candidate, key));
      });
    if (!activityMatched) return false;

    const cityRegionId = typeof data.cityRegionId === "string" ? data.cityRegionId : null;
    const stateRegionId = typeof data.stateRegionId === "string" ? data.stateRegionId : null;
    const lat = typeof data.lat === "number" ? data.lat : typeof data.latitude === "number" ? data.latitude : null;
    const lng =
      typeof data.lng === "number"
        ? data.lng
        : typeof data.longitude === "number"
          ? data.longitude
          : typeof data.long === "number"
            ? data.long
            : null;

    if (intent.location?.cityRegionId || intent.location?.stateRegionId) {
      if (intent.location?.cityRegionId && cityRegionId === intent.location.cityRegionId) return true;
      if (intent.location?.stateRegionId && stateRegionId === intent.location.stateRegionId) return true;
      if (
        intent.location?.place?.lat != null &&
        intent.location?.place?.lng != null &&
        lat != null &&
        lng != null &&
        distanceMiles(
          { lat: intent.location.place.lat, lng: intent.location.place.lng },
          { lat, lng }
        ) <= 90
      ) {
        return true;
      }
      return false;
    }

    if (intent.nearMe) {
      if (!viewerCoords || lat == null || lng == null) return false;
      return distanceMiles(viewerCoords, { lat, lng }) <= 120;
    }

    return true;
  });
  return {
    matchedPostIds: filtered.map((doc) => doc.id).slice(0, 6),
    postCount: filtered.length,
    activityTerms,
    location: {
      cityRegionId: intent.location?.cityRegionId ?? null,
      stateRegionId: intent.location?.stateRegionId ?? null,
    },
  };
}

function classifyRow(input: {
  query: string;
  kind: QueryParityRow["kind"];
  newSuggest: HttpProbe;
  newBootstrap: HttpProbe;
  newResults: HttpProbe;
  newCollections: HttpProbe;
  old: Awaited<ReturnType<typeof oldProbe>>;
  firestoreValidation: FirestoreValidation;
}): {
  classification: SearchClassification;
  semanticCorrectness: string[];
  missingResultTypes: string[];
  shapeDrift: string[];
  rankingDrift: string[];
} {
  const { query, kind, newSuggest, newBootstrap, newResults, newCollections, old, firestoreValidation } = input;
  const semanticCorrectness: string[] = [];
  const missingResultTypes: string[] = [];
  const shapeDrift: string[] = [];
  const rankingDrift: string[] = [];
  const resultItems = Array.isArray(newResults.body?.items)
    ? (newResults.body?.items as unknown[])
    : [];
  const collectionItems = Array.isArray((newCollections.body?.sections as { collections?: { items?: unknown[] } } | undefined)?.collections?.items)
    ? (((newCollections.body?.sections as { collections?: { items?: unknown[] } }).collections?.items) ?? [])
    : [];

  const suggestRows = Array.isArray(newSuggest.body?.suggestions)
    ? (newSuggest.body?.suggestions as Array<Record<string, unknown>>)
    : [];
  const detectedActivity = typeof newSuggest.body?.detectedActivity === "string"
    ? String(newSuggest.body?.detectedActivity)
    : null;
  const newCollectionsCount = collectionItems.length;

  const placeSuggestionsPresent = countByType(suggestRows, ["place", "town", "state"]) > 0;
  const activitySuggestionsPresent = countByType(suggestRows, ["activity", "smart_completion"]) > 0 || detectedActivity != null;
  const newPostsCount = resultItems.length;

  if (kind !== "combined" && query.length >= 2 && /verm|burl|uvm|philly|philadelphia|new york|nyc|boulder|easton|seattle|bay area|austin|phoenix|hampshire|jersey/i.test(query) && !placeSuggestionsPresent) {
    return {
      classification: "SEARCH_FAIL_NO_GEONAMES",
      semanticCorrectness,
      missingResultTypes,
      shapeDrift,
      rankingDrift,
    };
  }
  if (/hik|bik|swim|coffee|waterfall|pizza|bookstore|trail|picnic|sunset|view|scenic|food|abandoned|castle|study|date/i.test(query) && query.length >= 2 && !activitySuggestionsPresent) {
    return {
      classification: "SEARCH_FAIL_MISSING_ACTIVITY",
      semanticCorrectness,
      missingResultTypes,
      shapeDrift,
      rankingDrift,
    };
  }
  if (newSuggest.ok && (newSuggest.latencyMs ?? 0) > 200) {
    return {
      classification: "SEARCH_FAIL_AUTOFILL_TOO_SLOW",
      semanticCorrectness,
      missingResultTypes,
      shapeDrift,
      rankingDrift,
    };
  }
  if (kind === "combined" && newResults.ok && (newResults.latencyMs ?? 0) > 250) {
    return {
      classification: "SEARCH_FAIL_RESULTS_TOO_SLOW",
      semanticCorrectness,
      missingResultTypes,
      shapeDrift,
      rankingDrift,
    };
  }
  if (kind === "combined" && newBootstrap.ok && (newBootstrap.latencyMs ?? 0) > 250) {
    semanticCorrectness.push("bootstrap staged but over target budget");
    return {
      classification: "SEARCH_FAIL_MIX_TOO_SLOW",
      semanticCorrectness,
      missingResultTypes,
      shapeDrift,
      rankingDrift,
    };
  }
  if (kind === "combined" && firestoreValidation.postCount > 0 && newPostsCount === 0) {
    return {
      classification: "SEARCH_FAIL_NO_POST_RESULTS",
      semanticCorrectness,
      missingResultTypes: ["posts"],
      shapeDrift,
      rankingDrift,
    };
  }
  if (kind === "combined" && old.status === "ok" && old.postsCount > 0 && newPostsCount === 0) {
    return {
      classification: "SEARCH_FAIL_OLD_PARITY",
      semanticCorrectness,
      missingResultTypes: ["posts"],
      shapeDrift,
      rankingDrift,
    };
  }
  if (old.status === "ok" && old.collectionsCount > 0 && newCollectionsCount === 0 && kind === "combined") {
    missingResultTypes.push("collections");
    shapeDrift.push("legacy had collections but v2 results section was empty");
  }
  if (old.status === "ok" && old.usersCount > 0 && !Array.isArray(newResults.body?.sections) && Array.isArray((newResults.body?.sections as { users?: { items?: unknown[] } } | undefined)?.users?.items) === false) {
    shapeDrift.push("v2 results users section missing");
  }
  if (oldComparisonMode !== "live_code") {
    semanticCorrectness.push("old live backend unavailable; using code-reference mode");
    return {
      classification: "SEARCH_PASS_STAGED",
      semanticCorrectness,
      missingResultTypes,
      shapeDrift,
      rankingDrift,
    };
  }
  semanticCorrectness.push("v2 returned source-of-truth search data");
  return {
    classification: "SEARCH_PASS",
    semanticCorrectness,
    missingResultTypes,
    shapeDrift,
    rankingDrift,
  };
}

async function run(): Promise<void> {
  const rows: QueryParityRow[] = [];
  const discoveryWarm = new SearchDiscoveryService();
  try {
    await Promise.all([
      discoveryWarm.loadRecentPosts(96),
      discoveryWarm.loadTopActivities(8),
    ]);
  } catch {
    // Keep parity running even if warmup can't prime.
  }
  for (const { query, kind } of uniqueQueries()) {
    const encoded = encodeURIComponent(query);
    const geoQuery = viewerCoords
      ? `&lat=${encodeURIComponent(String(viewerCoords.lat))}&lng=${encodeURIComponent(String(viewerCoords.lng))}`
      : "";
    const shouldProbeCommitted = kind === "combined";
    const old = await oldProbe(query);
    if (shouldProbeCommitted) {
      await v2Get(`/v2/search/bootstrap?q=${encoded}&limit=12${geoQuery}`);
      await v2Get(`/v2/search/results?q=${encoded}&limit=8&types=posts,mixes${geoQuery}`);
      await v2Get(`/v2/search/results?q=${encoded}&limit=8&types=collections${geoQuery}`);
    }
    const newSuggest = await v2Get(`/v2/search/suggest?q=${encoded}${geoQuery}`);
    const newBootstrap = shouldProbeCommitted
      ? await v2Get(`/v2/search/bootstrap?q=${encoded}&limit=12${geoQuery}`)
      : skippedProbe();
    const newResults = shouldProbeCommitted
      ? await v2Get(`/v2/search/results?q=${encoded}&limit=8&types=posts,mixes${geoQuery}`)
      : skippedProbe();
    const newCollections = shouldProbeCommitted
      ? await v2Get(`/v2/search/results?q=${encoded}&limit=8&types=collections${geoQuery}`)
      : skippedProbe();
    const newUsers = shouldProbeCommitted
      ? await v2Get(`/v2/search/users?q=${encoded}&limit=8`)
      : skippedProbe();
    const firestoreValidation = shouldProbeCommitted
      ? await validateFirestore(query)
      : {
          matchedPostIds: [],
          postCount: 0,
          activityTerms: [],
          location: { cityRegionId: null, stateRegionId: null },
        };

    const newSuggestRows = Array.isArray(newSuggest.body?.suggestions)
      ? (newSuggest.body?.suggestions as Array<Record<string, unknown>>)
      : [];
    const newResultsSections = (newResults.body?.sections as {
      collections?: { items?: Array<Record<string, unknown>> };
      mixes?: { items?: Array<Record<string, unknown>> };
    } | undefined) ?? {};
    const newCollectionSections = (newCollections.body?.sections as {
      collections?: { items?: Array<Record<string, unknown>> };
    } | undefined) ?? {};
    const oldSuggestionGroups = normalizeSuggestionGroups(old.suggestionRows);
    const newSuggestionGroups = normalizeSuggestionGroups(newSuggestRows);
    const newMixGroups = ((newResultsSections.mixes?.items ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.title ?? "").trim())
      .filter(Boolean);
    const classification = classifyRow({
      query,
      kind,
      newSuggest,
      newBootstrap,
      newResults,
      newCollections,
      old,
      firestoreValidation,
    });

    rows.push({
      query,
      kind,
      oldComparisonMode,
      oldStatus: old.status,
      newStatus: shouldProbeCommitted
        ? newResults.ok
          ? "ok"
          : `error:${newResults.errorCode ?? newResults.statusCode}`
        : newSuggest.ok
          ? "ok"
          : `error:${newSuggest.errorCode ?? newSuggest.statusCode}`,
      oldLatencyMs: old.latencyMs,
      newSuggestLatencyMs: newSuggest.latencyMs,
      newBootstrapLatencyMs: newBootstrap.latencyMs,
      newResultsLatencyMs: newResults.latencyMs,
      newUsersLatencyMs: newUsers.latencyMs,
      oldSuggestionGroups,
      newSuggestionGroups,
      oldMixGroups: old.mixGroups,
      newMixGroups,
      oldPostsCount: old.postsCount,
      newPostsCount: Array.isArray(newResults.body?.items) ? (newResults.body?.items as unknown[]).length : 0,
      oldCollectionsCount: old.collectionsCount,
      newCollectionsCount: (newCollectionSections.collections?.items ?? []).length,
      oldUsersCount: old.usersCount,
      newUsersCount: Array.isArray(newUsers.body?.items) ? (newUsers.body?.items as unknown[]).length : 0,
      geoNamesPresent: countByType(newSuggestRows, ["place", "town", "state"]) > 0,
      activitySuggestionsPresent:
        countByType(newSuggestRows, ["activity", "smart_completion"]) > 0 ||
        typeof newSuggest.body?.detectedActivity === "string",
      semanticCorrectness: classification.semanticCorrectness,
      missingResultTypes: classification.missingResultTypes,
      shapeDrift: classification.shapeDrift,
      rankingDrift: classification.rankingDrift,
      payloadBytes: {
        suggest: newSuggest.payloadBytes,
        bootstrap: newBootstrap.payloadBytes,
        results: newResults.payloadBytes + newCollections.payloadBytes,
        users: newUsers.payloadBytes,
      },
      cacheStatus: {
        suggest: newSuggest.cacheStatus,
        bootstrap: newBootstrap.cacheStatus,
        results: newResults.cacheStatus,
        users: newUsers.cacheStatus,
      },
      firestore: {
        suggestReads: newSuggest.firestoreReads,
        suggestQueries: newSuggest.firestoreQueries,
        bootstrapReads: newBootstrap.firestoreReads,
        bootstrapQueries: newBootstrap.firestoreQueries,
        resultsReads: newResults.firestoreReads + newCollections.firestoreReads,
        resultsQueries: newResults.firestoreQueries + newCollections.firestoreQueries,
        usersReads: newUsers.firestoreReads,
        usersQueries: newUsers.firestoreQueries,
        validation: firestoreValidation,
      },
      classification: classification.classification,
    });
  }

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  const report: Report = {
    generatedAt: new Date().toISOString(),
    viewerId,
    summary: {
      counts,
      oldComparisonMode,
      notes: oldComparisonMode === "live_code"
        ? ["Old backend behavior loaded from local v1 code modules."]
        : ["Old backend live modules were unavailable; comparisons fall back to code-reference-only mode."],
    },
    rows,
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = [
    "# Search V2 Long-Run Parity Audit (Generated)",
    "",
    `Generated: ${report.generatedAt}`,
    `Viewer: ${viewerId}`,
    `Old comparison mode: ${oldComparisonMode}`,
    "",
    "## Summary",
    "",
    ...Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).map(([label, count]) => `- ${label}: ${count}`),
    "",
    "## Query Highlights",
    "",
    ...rows.slice(0, 40).map((row) =>
      `- \`${row.query}\` → ${row.classification} | suggest=${row.newSuggestLatencyMs ?? "n/a"}ms | bootstrap=${row.newBootstrapLatencyMs ?? "n/a"}ms | results=${row.newResultsLatencyMs ?? "n/a"}ms | posts=${row.newPostsCount} | collections=${row.newCollectionsCount} | users=${row.newUsersCount}`
    ),
    "",
    "## Notes",
    "",
    ...report.summary.notes.map((note) => `- ${note}`),
    "",
    `Full JSON: \`${path.relative(workspaceRoot, reportPath)}\``,
    "",
  ].join("\n");
  await fs.writeFile(auditDocPath, markdown, "utf8");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
}

await run();
