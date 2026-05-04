import type { FastifyInstance } from "fastify";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { geoPrefixesAroundCenter } from "../../lib/geo-prefixes-around-center.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { endFullWarmerPass, evaluateFullWarmerGate } from "../../runtime/warmer-traffic-gate.js";

const REELS_PREFIX = "/api/v1/product/reels";
const FEED_ID = "reels:near-me";
const MILES_TO_KM = 1.60934;
const CACHE_REFRESH_MS = 60_000;
const NEAR_ME_CURSOR_PREFIX = "nrm:v2:";
const LOCATION_E5_COMPAT_TOLERANCE = 25;

type NearMePost = Record<string, unknown> & { id: string };
type CachedPool = {
  posts: NearMePost[];
  loadedAtMs: number;
  loading: boolean;
  inFlight: Promise<void> | null;
};

const pool: CachedPool = {
  posts: [],
  loadedAtMs: 0,
  loading: false,
  inFlight: null
};

let nearMeRefreshSerial: Promise<void> = Promise.resolve();

function toIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw != null && raw !== "") {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
  }
  return fallback;
}

function parseFinite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNearMeCursor(cursor: unknown): number {
  if (typeof cursor !== "string") return 0;
  const match = /^cursor:(\d+)$/.exec(cursor.trim());
  if (!match) return 0;
  const offset = Number(match[1]);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

type NearMeExhaustPhase = "geohash" | "recent";

type NearMeExhaustWire = {
  phase: NearMeExhaustPhase;
  prefixes?: string[];
  prefixIdx?: number;
  ghCursor?: { lastGeohash: string | null; lastTime: number | null; lastId: string | null } | null;
  geoFinished?: boolean;
  recentCursor?: { lastTime: number | null; lastId: string | null } | null;
  recentFinished?: boolean;
};

type NearMeCursorV2 = {
  v: 2;
  /** pool = warm-pool slice; exhaust = geohash + recent Firestore scans */
  mode?: "pool" | "exhaust";
  offset: number;
  radiusMiles: number;
  latE5: number;
  lngE5: number;
  lastPostId: string | null;
  poolLoadedAtMs: number;
  /** Dedupe ring buffer (recent tail) emitted across pages */
  seen?: string[];
  exhaust?: NearMeExhaustWire | null;
};

type ParsedNearMeCursor =
  | { kind: "legacy"; offset: number }
  | { kind: "v2"; value: NearMeCursorV2 }
  | { kind: "invalid" };

function roundCoordE5(value: number): number {
  return Math.round(value * 100000);
}

export function parseNearMeCursorAny(cursor: unknown): ParsedNearMeCursor {
  if (typeof cursor !== "string" || !cursor.trim()) return { kind: "legacy", offset: 0 };
  const raw = cursor.trim();
  if (raw.startsWith(NEAR_ME_CURSOR_PREFIX)) {
    try {
      const payload = Buffer.from(raw.slice(NEAR_ME_CURSOR_PREFIX.length), "base64url").toString("utf8");
      const parsed = JSON.parse(payload) as Partial<NearMeCursorV2> & { exhaust?: NearMeExhaustWire | null };
      const offset = Number(parsed.offset);
      const radiusMiles = Number(parsed.radiusMiles);
      const latE5 = Number(parsed.latE5);
      const lngE5 = Number(parsed.lngE5);
      const poolLoadedAtMs = Number(parsed.poolLoadedAtMs);
      if (
        parsed.v !== 2 ||
        !Number.isFinite(offset) ||
        offset < 0 ||
        !Number.isFinite(radiusMiles) ||
        !Number.isFinite(latE5) ||
        !Number.isFinite(lngE5) ||
        !Number.isFinite(poolLoadedAtMs)
      ) {
        return { kind: "invalid" };
      }
      const mode: "pool" | "exhaust" = parsed.mode === "exhaust" ? "exhaust" : "pool";
      const seenRaw = Array.isArray(parsed.seen) ? parsed.seen.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
      const seen = seenRaw.slice(-420);
      return {
        kind: "v2",
        value: {
          v: 2,
          mode,
          offset: Math.floor(offset),
          radiusMiles,
          latE5: Math.floor(latE5),
          lngE5: Math.floor(lngE5),
          lastPostId: typeof parsed.lastPostId === "string" && parsed.lastPostId.trim() ? parsed.lastPostId.trim() : null,
          poolLoadedAtMs: Math.floor(poolLoadedAtMs),
          seen: seen.length > 0 ? seen : undefined,
          exhaust: parsed.exhaust && typeof parsed.exhaust === "object" ? (parsed.exhaust as NearMeExhaustWire) : null
        }
      };
    } catch {
      return { kind: "invalid" };
    }
  }
  return { kind: "legacy", offset: parseNearMeCursor(raw) };
}

export function encodeNearMeCursorV2(input: Omit<NearMeCursorV2, "v">): string {
  const payload: Record<string, unknown> = {
    v: 2,
    mode: input.mode ?? "pool",
    offset: input.offset,
    radiusMiles: input.radiusMiles,
    latE5: input.latE5,
    lngE5: input.lngE5,
    lastPostId: input.lastPostId,
    poolLoadedAtMs: input.poolLoadedAtMs
  };
  if (input.seen && input.seen.length > 0) payload.seen = input.seen.slice(-420);
  if (input.exhaust) payload.exhaust = input.exhaust;
  return `${NEAR_ME_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function clampLimit(value: unknown): number {
  const parsed = parseFinite(value);
  if (parsed == null) return 5;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

function clampRadiusMiles(value: unknown): number {
  const parsed = parseFinite(value);
  if (parsed == null) return 25;
  return Math.max(1, Math.min(500, parsed));
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getNearMeFirestoreFallbackMaxDocs(): number {
  const raw = process.env.NEAR_ME_FIRESTORE_FALLBACK_MAX_DOCS;
  if (raw != null && raw !== "") {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 500 && n <= 100000) return n;
  }
  return 12000;
}

function isDiscoverablePublicPrivacy(privacy: unknown): boolean {
  if (privacy == null || privacy === "") return true;
  const p = String(privacy).trim().toLowerCase();
  if (p === "friends spot" || p === "secret spot" || p === "private") return false;
  return p === "public spot" || p === "public";
}

function filterReelEligible(post: NearMePost): boolean {
  if (!isDiscoverablePublicPrivacy(post.privacy)) return false;
  if (post.assetsReady === false) return false;
  if (post.deleted === true || post.isDeleted === true || post.archived === true || post.hidden === true) return false;
  const assets = post.assets;
  if (!Array.isArray(assets) || assets.length === 0) return false;
  const first = assets[0] as Record<string, unknown> | undefined;
  const firstType = String(first?.type ?? "").toLowerCase();
  if (firstType === "video" && post.videoProcessingStatus != null && post.videoProcessingStatus !== "completed") {
    return false;
  }
  return true;
}

function getPostLatLng(post: NearMePost): { lat: number; lng: number } | null {
  const loc = (post.location ?? {}) as Record<string, unknown>;
  const geoData = (post.geoData ?? {}) as Record<string, unknown>;
  const rawLat = post.lat ?? post.latitude ?? loc.lat ?? loc.latitude ?? geoData.lat ?? geoData.latitude;
  const rawLng =
    post.long ??
    post.longitude ??
    post.lng ??
    loc.long ??
    loc.lng ??
    loc.longitude ??
    geoData.lng ??
    geoData.long ??
    geoData.longitude;
  const lat = typeof rawLat === "number" ? rawLat : Number(rawLat);
  const lng = typeof rawLng === "number" ? rawLng : Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function computeDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function postTimeMs(post: NearMePost): number {
  const raw = post.time ?? post.createdAt ?? post.updatedAt ?? post.lastUpdated;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000;
  if (raw && typeof raw === "object") {
    const t = raw as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof t.toMillis === "function") return t.toMillis();
    if (typeof t.seconds === "number") return t.seconds * 1000;
    if (typeof t._seconds === "number") return t._seconds * 1000;
  }
  return 0;
}

/** Match feed card / For You simple: letterbox gradients + fit-width hints for native carousel. */
function presentationHintsFromNearMePost(post: NearMePost): {
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
} {
  const record = post as Record<string, unknown>;
  const legacy = record.legacy as
    | {
        letterboxGradientTop?: unknown;
        letterboxGradientBottom?: unknown;
        letterboxGradients?: unknown;
        letterbox_gradient_top?: unknown;
        letterbox_gradient_bottom?: unknown;
      }
    | undefined;
  const topRaw =
    typeof record.letterboxGradientTop === "string"
      ? record.letterboxGradientTop
      : typeof record.letterbox_gradient_top === "string"
        ? record.letterbox_gradient_top
        : typeof legacy?.letterboxGradientTop === "string"
          ? legacy.letterboxGradientTop
          : typeof legacy?.letterbox_gradient_top === "string"
            ? legacy.letterbox_gradient_top
            : null;
  const bottomRaw =
    typeof record.letterboxGradientBottom === "string"
      ? record.letterboxGradientBottom
      : typeof record.letterbox_gradient_bottom === "string"
        ? record.letterbox_gradient_bottom
        : typeof legacy?.letterboxGradientBottom === "string"
          ? legacy.letterboxGradientBottom
          : typeof legacy?.letterbox_gradient_bottom === "string"
            ? legacy.letterbox_gradient_bottom
            : null;
  const top = topRaw?.trim() ? topRaw.trim() : null;
  const bottom = bottomRaw?.trim() ? bottomRaw.trim() : null;

  const out: {
    carouselFitWidth?: boolean;
    layoutLetterbox?: boolean;
    letterboxGradientTop?: string | null;
    letterboxGradientBottom?: string | null;
    letterboxGradients?: Array<{ top: string; bottom: string }>;
  } = {};
  if (typeof post.carouselFitWidth === "boolean") out.carouselFitWidth = post.carouselFitWidth;
  if (typeof post.layoutLetterbox === "boolean") out.layoutLetterbox = post.layoutLetterbox;
  if (top !== null) out.letterboxGradientTop = top;
  if (bottom !== null) out.letterboxGradientBottom = bottom;

  const gradientsRaw = Array.isArray(record.letterboxGradients)
    ? record.letterboxGradients
    : Array.isArray(legacy?.letterboxGradients)
      ? legacy.letterboxGradients
      : null;
  if (Array.isArray(gradientsRaw)) {
    const gradients: Array<{ top: string; bottom: string }> = [];
    for (const entry of gradientsRaw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { top?: unknown; bottom?: unknown };
      if (typeof e.top !== "string" || typeof e.bottom !== "string") continue;
      const t = e.top.trim();
      const b = e.bottom.trim();
      if (!t || !b) continue;
      gradients.push({ top: t, bottom: b });
    }
    if (gradients.length > 0) out.letterboxGradients = gradients;
  }

  return out;
}

function mapLegacyReelsItem(post: NearMePost) {
  const assets = Array.isArray(post.assets) ? (post.assets as Array<Record<string, unknown>>) : [];
  const firstAsset = assets[0];
  const variants = (firstAsset?.variants ?? {}) as Record<string, unknown>;
  const md = (variants.md ?? {}) as Record<string, unknown>;
  const sm = (variants.sm ?? variants.small ?? {}) as Record<string, unknown>;
  const thumb = (variants.thumb ?? {}) as Record<string, unknown>;
  const posterUrl =
    normalizeUrl((variants.poster as unknown) ?? firstAsset?.poster) ??
    normalizeUrl((md.webp as unknown) ?? (md.jpg as unknown)) ??
    normalizeUrl((sm.webp as unknown) ?? (sm.jpg as unknown)) ??
    normalizeUrl((thumb.webp as unknown) ?? (thumb.jpg as unknown)) ??
    normalizeUrl(post.displayPhotoLink) ??
    "";
  const previewUrl =
    normalizeUrl((variants.preview360Avc as unknown) ?? (variants.preview360 as unknown)) ??
    normalizeUrl(firstAsset?.original) ??
    normalizeUrl((sm.webp as unknown) ?? (sm.jpg as unknown));
  const mp4Url =
    normalizeUrl((variants.main720Avc as unknown) ?? (variants.main720 as unknown) ?? (variants.main1080Avc as unknown)) ??
    normalizeUrl(firstAsset?.original) ??
    normalizeUrl(previewUrl);
  const rawPrivacy = String(post.privacy ?? "Public Spot");
  const mediaType = String(firstAsset?.type ?? post.mediaType ?? "image").toLowerCase() === "video" ? "video" : "image";
  const coords = getPostLatLng(post);
  const geoData = (post.geoData ?? {}) as Record<string, unknown>;
  const likesCount = typeof post.likesCount === "number" ? post.likesCount : Array.isArray(post.likes) ? post.likes.length : 0;
  const commentCount =
    typeof post.commentCount === "number"
      ? post.commentCount
      : typeof post.commentsCount === "number"
        ? post.commentsCount
        : Array.isArray(post.comments)
          ? post.comments.length
          : 0;

  return {
    postId: post.id,
    privacy: rawPrivacy,
    settingType: String(post.settingType ?? "Public Spot"),
    user: {
      userId: String(post.userId ?? ""),
      handle: String(post.userHandle ?? ""),
      name: typeof post.userName === "string" ? post.userName : null,
      pic: typeof post.userPic === "string" ? post.userPic : null
    },
    text: {
      title: typeof post.title === "string" ? post.title : null,
      content: typeof post.content === "string" ? post.content : null
    },
    activities: Array.isArray(post.activities) ? post.activities.map((v) => String(v ?? "")).filter(Boolean) : [],
    address: typeof post.address === "string" ? post.address : null,
    geo: {
      lat: coords?.lat ?? 0,
      long: coords?.lng ?? 0,
      city: typeof geoData.city === "string" ? geoData.city : null,
      state: typeof geoData.state === "string" ? geoData.state : null,
      country: typeof geoData.country === "string" ? geoData.country : null,
      geohash: typeof geoData.geohash === "string" ? geoData.geohash : null
    },
    counts: {
      likesCount: Math.max(0, Math.floor(likesCount)),
      commentCount: Math.max(0, Math.floor(commentCount))
    },
    media: {
      type: mediaType,
      aspectRatio: typeof firstAsset?.aspectRatio === "number" ? firstAsset.aspectRatio : 9 / 16,
      orientation: typeof firstAsset?.orientation === "string" ? firstAsset.orientation : null,
      width: typeof firstAsset?.width === "number" ? firstAsset.width : null,
      height: typeof firstAsset?.height === "number" ? firstAsset.height : null,
      blurhash: typeof firstAsset?.blurhash === "string" ? firstAsset.blurhash : null,
      posterUrl,
      previewUrl,
      streamUrl: mediaType === "video" ? normalizeUrl(variants.hls) ?? previewUrl : null,
      mp4Url: mediaType === "video" ? mp4Url : null,
      durationSec: null,
      hasAudio: mediaType === "video" ? true : null,
      cacheKey: null
    },
    updatedAtMs: postTimeMs(post) || null,
    ...presentationHintsFromNearMePost(post)
  };
}

function nearMeQuickBootstrapDocs(): number {
  const raw = process.env.NEAR_ME_POOL_QUICK_DOCS;
  if (raw != null && raw !== "") {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 200 && n <= 8000) return n;
  }
  return 1200;
}

function nearMeColdWaitMs(): number {
  const raw = process.env.NEAR_ME_COLD_WAIT_MS;
  if (raw != null && raw !== "") {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 100 && n <= 2200) return n;
  }
  return 1200;
}

function nearMeExhaustiveBudgetMs(): number {
  const raw = process.env.NEAR_ME_EXHAUSTIVE_BUDGET_MS;
  if (raw != null && raw !== "") {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 300 && n <= 20_000) return n;
  }
  return 1500;
}

/** First-page fill so near-me never waits on a 10k-doc scan on cold request paths. */
async function rebuildPostPoolQuick(app: FastifyInstance): Promise<void> {
  if (pool.posts.length > 0) return;
  if (pool.loading && pool.inFlight) {
    await Promise.race([pool.inFlight, new Promise<void>((resolve) => setTimeout(resolve, nearMeColdWaitMs()))]);
    return;
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    app.log.info(
      {
        event: "near_me_pool_refresh_skipped_reason",
        reason: "no_firestore",
        near_me_pool_refresh_latency_ms: 0,
        near_me_pool_doc_count: 0
      },
      "near-me quick pool skipped"
    );
    return;
  }
  const started = Date.now();
  const cap = nearMeQuickBootstrapDocs();
  app.log.info(
    {
      event: "near_me_pool_refresh_started",
      mode: "quick",
      targetDocs: cap,
      near_me_pool_doc_count_before: pool.posts.length
    },
    "near-me cache pool refresh started"
  );
  try {
    const snap = await db.collection("posts").orderBy("time", "desc").limit(cap).get();
    const out: NearMePost[] = [];
    for (const doc of snap.docs) out.push({ id: doc.id, ...(doc.data() as Record<string, unknown>) });
    pool.posts = out;
    pool.loadedAtMs = Date.now();
    const latency = Date.now() - started;
    app.log.info(
      {
        event: "near_me_pool_refresh_completed",
        mode: "quick",
        near_me_pool_refresh_latency_ms: latency,
        near_me_pool_doc_count: out.length
      },
      "near-me quick pool refreshed"
    );
  } catch (error) {
    app.log.warn(
      {
        event: "near_me_pool_refresh_failed",
        mode: "quick",
        reason: error instanceof Error ? error.message : String(error),
        near_me_pool_refresh_latency_ms: Date.now() - started
      },
      "near-me quick pool refresh failed"
    );
  }
}

async function rebuildPostPool(app: FastifyInstance): Promise<void> {
  if (pool.loading && pool.inFlight) return pool.inFlight;
  const db = getFirestoreSourceClient();
  if (!db) return;

  const force = process.env.NEAR_ME_WARMER_FORCE === "1";
  if (!force) {
    const gate = evaluateFullWarmerGate({ force: false, mode: "near_me_full" });
    if (!gate.ok) {
      app.log.info(
        {
          event: "near_me_pool_refresh_skipped",
          mode: "full",
          reason: gate.reason,
          skipped_due_to_active_traffic: gate.reason === "active_traffic",
          skipped_due_to_recent_refresh: gate.reason === "recent_full_refresh",
          skipped_due_to_singleflight: gate.reason === "singleflight_busy",
        },
        "near-me full pool refresh skipped"
      );
      return;
    }
  }

  pool.loading = true;
  const fullStarted = Date.now();
  const targetDocs = getNearMeFirestoreFallbackMaxDocs();
  app.log.info(
    {
      event: "near_me_pool_refresh_started",
      mode: "full",
      targetDocs
    },
    "near-me full pool refresh started"
  );
  pool.inFlight = (async () => {
    const maxDocs = targetDocs;
    const pageSize = Math.min(1000, toIntEnv("NEAR_ME_FULL_PAGE_SIZE", 800, 200, 1000));
    const out: NearMePost[] = [];
    let lastDoc: QueryDocumentSnapshot | null = null;

    while (out.length < maxDocs) {
      const batchLimit = Math.min(pageSize, maxDocs - out.length);
      let q: Query = db.collection("posts").orderBy("time", "desc").limit(batchLimit);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) out.push({ id: doc.id, ...(doc.data() as Record<string, unknown>) });
      lastDoc = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.size < batchLimit) break;
    }

    pool.posts = out;
    pool.loadedAtMs = Date.now();
    endFullWarmerPass();
    app.log.info(
      {
        event: "near_me_pool_refresh_completed",
        mode: "full",
        near_me_pool_refresh_latency_ms: Date.now() - fullStarted,
        near_me_pool_doc_count: out.length
      },
      "near-me cache pool refreshed"
    );
  })()
    .catch((error) => {
      app.log.warn({ event: "near_me_pool_refresh_failed", reason: error instanceof Error ? error.message : String(error) }, "near-me cache pool refresh failed");
    })
    .finally(() => {
      pool.loading = false;
      pool.inFlight = null;
    });

  return pool.inFlight;
}

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return computeDistanceKm(lat1, lng1, lat2, lng2) / MILES_TO_KM;
}

function getFilteredCandidates(lat: number, lng: number, radiusMiles: number): NearMePost[] {
  const radiusKm = radiusMiles * MILES_TO_KM;
  return pool.posts
    .filter((post) => {
      if (!filterReelEligible(post)) return false;
      const coords = getPostLatLng(post);
      if (!coords) return false;
      return computeDistanceKm(lat, lng, coords.lat, coords.lng) <= radiusKm;
    })
    .sort((a, b) => {
      const ca = getPostLatLng(a);
      const cb = getPostLatLng(b);
      if (!ca || !cb) return 0;
      const da = distanceMiles(lat, lng, ca.lat, ca.lng);
      const db = distanceMiles(lat, lng, cb.lat, cb.lng);
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    });
}

export function resolveNearMePaginationStart(input: {
  parsedCursor: ParsedNearMeCursor;
  radiusMiles: number;
  latE5: number;
  lngE5: number;
  currentPoolLoadedAtMs: number;
  candidateIds: string[];
  limit: number;
}): {
  offset: number;
  cursorResetReason: string | null;
  recoveredByLastPost: boolean;
} {
  const { parsedCursor, radiusMiles, latE5, lngE5, currentPoolLoadedAtMs, candidateIds, limit } = input;
  if (parsedCursor.kind === "v2" && parsedCursor.value.mode === "exhaust") {
    return { offset: 0, cursorResetReason: null, recoveredByLastPost: false };
  }
  let offset =
    parsedCursor.kind === "legacy"
      ? parsedCursor.offset
      : parsedCursor.kind === "v2"
        ? parsedCursor.value.offset
        : 0;
  let cursorResetReason: string | null = null;
  let recoveredByLastPost = false;

  if (parsedCursor.kind === "v2") {
    const c = parsedCursor.value;
    const radiusCompatible = Math.abs(c.radiusMiles - radiusMiles) < 0.0001;
    const locationCompatible =
      Math.abs(c.latE5 - latE5) <= LOCATION_E5_COMPAT_TOLERANCE &&
      Math.abs(c.lngE5 - lngE5) <= LOCATION_E5_COMPAT_TOLERANCE;
    if (!radiusCompatible || !locationCompatible) {
      offset = 0;
      cursorResetReason = !radiusCompatible ? "radius_changed" : "location_changed";
    } else if (c.poolLoadedAtMs !== currentPoolLoadedAtMs && c.lastPostId) {
      const idx = candidateIds.findIndex((postId) => postId === c.lastPostId);
      if (idx >= 0) {
        offset = idx + 1;
        recoveredByLastPost = true;
      }
    }
  }

  if (offset >= candidateIds.length && candidateIds.length > 0 && parsedCursor.kind !== "legacy") {
    offset = Math.max(0, candidateIds.length - limit);
    cursorResetReason = cursorResetReason ?? "offset_out_of_range_recovered";
  }

  return { offset, cursorResetReason, recoveredByLastPost };
}

type NormalizedExhaust = {
  phase: NearMeExhaustPhase;
  prefixes: string[];
  prefixIdx: number;
  gh: { lastGeohash: string; lastTime: number; lastId: string } | null;
  geoFinished: boolean;
  recent: { lastTime: number; lastId: string } | null;
  recentFinished: boolean;
};

async function normalizeExhaustState(
  incoming: NearMeExhaustWire | null | undefined,
  lat: number,
  lng: number
): Promise<NormalizedExhaust> {
  const prefixes =
    incoming && Array.isArray(incoming.prefixes) && incoming.prefixes.length > 0
      ? incoming.prefixes
      : await geoPrefixesAroundCenter({ lat, lng, precision: 5 });
  const geoFinished = incoming?.geoFinished === true;
  const recentFinished = incoming?.recentFinished === true;
  const phase: NearMeExhaustPhase = geoFinished || incoming?.phase === "recent" ? "recent" : "geohash";
  const ghIn = incoming?.ghCursor;
  const gh =
    ghIn && ghIn.lastGeohash && ghIn.lastTime != null && ghIn.lastId
      ? { lastGeohash: String(ghIn.lastGeohash), lastTime: Number(ghIn.lastTime), lastId: String(ghIn.lastId) }
      : null;
  const recentIn = incoming?.recentCursor;
  const recent =
    recentIn && recentIn.lastTime != null && recentIn.lastId
      ? { lastTime: Number(recentIn.lastTime), lastId: String(recentIn.lastId) }
      : null;
  return {
    phase,
    prefixes,
    prefixIdx: Math.max(0, Math.min(prefixes.length, Math.floor(Number(incoming?.prefixIdx) || 0))),
    gh: geoFinished ? null : gh,
    geoFinished,
    recent,
    recentFinished
  };
}

function exhaustHasMore(e: NormalizedExhaust): boolean {
  return !(e.geoFinished && e.recentFinished);
}

function exhaustToWire(n: NormalizedExhaust): NearMeExhaustWire {
  return {
    phase: n.geoFinished ? "recent" : "geohash",
    prefixes: n.prefixes,
    prefixIdx: n.prefixIdx,
    ghCursor: n.gh ? { lastGeohash: n.gh.lastGeohash, lastTime: n.gh.lastTime, lastId: n.gh.lastId } : null,
    geoFinished: n.geoFinished,
    recentCursor: n.recent ? { lastTime: n.recent.lastTime, lastId: n.recent.lastId } : null,
    recentFinished: n.recentFinished
  };
}

async function collectExhaustiveNearMePosts(input: {
  lat: number;
  lng: number;
  radiusMiles: number;
  limit: number;
  seen: Set<string>;
  incoming: NearMeExhaustWire | null | undefined;
}): Promise<{
  items: NearMePost[];
  exhaust: NormalizedExhaust;
  firestorePagesScanned: number;
  firestoreFallbackUsed: boolean;
  candidateSources: string[];
  duplicatesSuppressed: number;
  candidatesWithinRadius: number;
  invalidCursorRecovered: boolean;
}> {
  const [{ NearbyMixRepository }, { MixPostsRepository }] = await Promise.all([
    import("../../repositories/nearbyMix.repository.js"),
    import("../../repositories/mixPosts.repository.js"),
  ]);
  const nearbyMixRepo = new NearbyMixRepository();
  const mixPostsRepo = new MixPostsRepository();

  const radiusKm = input.radiusMiles * MILES_TO_KM;
  const out: NearMePost[] = [];
  let state = await normalizeExhaustState(input.incoming, input.lat, input.lng);
  let firestorePagesScanned = 0;
  let firestoreFallbackUsed = false;
  const candidateSources: string[] = [];
  let duplicatesSuppressed = 0;
  let candidatesWithinRadius = 0;
  let invalidCursorRecovered = false;
  let safety = 24;
  const startedAt = Date.now();
  const budgetMs = nearMeExhaustiveBudgetMs();

  const pushEligible = (post: NearMePost) => {
    if (!filterReelEligible(post)) return false;
    const coords = getPostLatLng(post);
    if (!coords) return false;
    const km = computeDistanceKm(input.lat, input.lng, coords.lat, coords.lng);
    if (km > radiusKm) return false;
    candidatesWithinRadius += 1;
    if (input.seen.has(post.id)) {
      duplicatesSuppressed += 1;
      return false;
    }
    input.seen.add(post.id);
    out.push(post);
    return true;
  };

  while (out.length < input.limit && safety-- > 0) {
    if (Date.now() - startedAt > budgetMs) {
      break;
    }
    if (!state.geoFinished && state.phase !== "recent") {
      const prefix = state.prefixes[state.prefixIdx];
      if (!prefix) {
        state.geoFinished = true;
        state.phase = "recent";
        state.gh = null;
        continue;
      }
      firestoreFallbackUsed = true;
      let batch: {
        items: Array<Record<string, unknown>>;
        nextCursor: { lastGeohash: string; lastTime: number; lastId: string } | null;
        hasMore: boolean;
      };
      try {
        batch = await nearbyMixRepo.pageByGeohashPrefix({
          prefix,
          limit: Math.max(36, input.limit * 6),
          cursor: state.gh
        });
      } catch {
        batch = { items: [], nextCursor: null, hasMore: false };
      }
      if (batch.items.length === 0 && state.gh) {
        invalidCursorRecovered = true;
        state.gh = null;
        try {
          batch = await nearbyMixRepo.pageByGeohashPrefix({
            prefix,
            limit: Math.max(36, input.limit * 6),
            cursor: null
          });
        } catch {
          batch = { items: [], nextCursor: null, hasMore: false };
        }
      }
      firestorePagesScanned += 1;
      candidateSources.push(`geohash:${prefix}`);

      const ranked: NearMePost[] = [];
      for (const row of batch.items) {
        const id = String((row as { id?: string }).id ?? (row as { postId?: string }).postId ?? "").trim();
        if (!id) continue;
        ranked.push({ id, ...(row as Record<string, unknown>) } as NearMePost);
      }
      ranked.sort((a, b) => {
        const ca = getPostLatLng(a);
        const cb = getPostLatLng(b);
        if (!ca || !cb) return 0;
        const da = distanceMiles(input.lat, input.lng, ca.lat, ca.lng);
        const db = distanceMiles(input.lat, input.lng, cb.lat, cb.lng);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });
      for (const post of ranked) {
        pushEligible(post);
        if (out.length >= input.limit) break;
      }
      if (out.length >= input.limit) break;

      if (batch.hasMore && batch.nextCursor) {
        state.gh = batch.nextCursor;
      } else {
        state.prefixIdx += 1;
        state.gh = null;
        if (state.prefixIdx >= state.prefixes.length) {
          state.geoFinished = true;
          state.phase = "recent";
        }
      }
      continue;
    }

    firestoreFallbackUsed = true;
    candidateSources.push("recent:time_desc");
    let recentPage: {
      items: Array<Record<string, unknown> & { id: string }>;
      nextCursor: { lastTime: number; lastId: string } | null;
      hasMore: boolean;
    };
    try {
      recentPage = await mixPostsRepo.pageRecent({
        limit: Math.max(12, input.limit * 3),
        cursor: state.recent
      });
    } catch {
      recentPage = { items: [], nextCursor: null, hasMore: false };
    }
    if (recentPage.items.length === 0 && state.recent) {
      invalidCursorRecovered = true;
      state.recent = null;
      try {
        recentPage = await mixPostsRepo.pageRecent({
          limit: Math.max(12, input.limit * 3),
          cursor: null
        });
      } catch {
        recentPage = { items: [], nextCursor: null, hasMore: false };
      }
    }
    firestorePagesScanned += 1;

    const ranked: NearMePost[] = recentPage.items.map((row) => ({ id: row.id, ...(row as Record<string, unknown>) } as NearMePost));
    ranked.sort((a, b) => {
      const ca = getPostLatLng(a);
      const cb = getPostLatLng(b);
      if (!ca || !cb) return 0;
      const da = distanceMiles(input.lat, input.lng, ca.lat, ca.lng);
      const db = distanceMiles(input.lat, input.lng, cb.lat, cb.lng);
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    });
    for (const post of ranked) {
      pushEligible(post);
      if (out.length >= input.limit) break;
    }
    state.recent = recentPage.nextCursor;
    if (!recentPage.hasMore) {
      state.recentFinished = true;
      break;
    }
    if (out.length >= input.limit) break;
  }

  return {
    items: out,
    exhaust: state,
    firestorePagesScanned,
    firestoreFallbackUsed,
    candidateSources,
    duplicatesSuppressed,
    candidatesWithinRadius,
    invalidCursorRecovered
  };
}

export async function registerLegacyReelsNearMeRoutes(app: FastifyInstance): Promise<void> {
  let refreshTimer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    const fullDelayMs = toIntEnv("NEAR_ME_FULL_REFRESH_DELAY_MS", 2_000, 2_000, 120_000);
    nearMeRefreshSerial = nearMeRefreshSerial
      .then(() => rebuildPostPoolQuick(app))
      .then(() => {
        setTimeout(() => {
          nearMeRefreshSerial = nearMeRefreshSerial.then(() => rebuildPostPool(app)).catch(() => undefined);
        }, fullDelayMs);
      })
      .catch(() => undefined);
    refreshTimer = setInterval(() => {
      nearMeRefreshSerial = nearMeRefreshSerial.then(() => rebuildPostPool(app)).catch(() => undefined);
    }, CACHE_REFRESH_MS);
  });

  app.addHook("onClose", async () => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  });

  app.get(`${REELS_PREFIX}/near-me`, async (request, reply) => {
    setRouteName("compat.reels.near_me");
    const query = request.query as Record<string, unknown>;
    const lat = parseFinite(query.lat);
    const lng = parseFinite(query.lng);
    const radiusMiles = clampRadiusMiles(query.radiusMiles);
    const limit = clampLimit(query.limit);
    const parsedCursor = parseNearMeCursorAny(query.cursor);
    const debugFlag = query.debug === "1" || query.debug === true || query.debug === "true";
    if (parsedCursor.kind === "invalid") {
      return reply.status(400).send({ error: "Invalid near-me cursor" });
    }

    if (lat == null || lng == null) return reply.status(400).send({ error: "Invalid lat or lng" });
    if (radiusMiles < 1 || radiusMiles > 500) return reply.status(400).send({ error: "radiusMiles must be 1-500" });
    if (!getFirestoreSourceClient()) return reply.status(503).send({ error: "Near me feed unavailable" });

    // Cold path: bounded quick scan only — never await the multi-thousand-doc full rebuild on the request thread.
    if (pool.posts.length === 0) {
      await Promise.race([
        rebuildPostPoolQuick(app),
        new Promise<void>((resolve) => setTimeout(resolve, nearMeColdWaitMs()))
      ]);
      if (pool.posts.length === 0) {
        const diagnostics = {
          prefix: "RADIUS_FEED_PAGE",
          requestedRadiusMiles: radiusMiles,
          effectiveRadiusMiles: radiusMiles,
          pageSizeRequested: limit,
          postsReturned: 0,
          candidatesScanned: 0,
          candidatesWithinRadius: 0,
          duplicatesSuppressed: 0,
          cursorReceived: typeof query.cursor === "string" ? query.cursor : null,
          cursorMode: parsedCursor.kind,
          nearMeMode: "pool",
          cursorResetReason: "pool_warming",
          cursorRecoveredByLastPost: false,
          nextCursorEmitted: null,
          nextCursorPresent: false,
          hasMore: false,
          exhaustedReason: "pool_warming",
          poolLoadedAtMs: pool.loadedAtMs,
          poolCount: pool.posts.length,
          scanMode: "pool",
          poolOffset: 0,
          poolExhausted: true,
          firestoreFallbackUsed: false,
          firestorePagesScanned: 0,
          candidateSources: [] as string[],
          withinRadiusTotalKnownOrScanned: 0,
          invalidCursorRecovered: false,
          lastPostId: null as string | null
        };
        reply.header("Cache-Control", "public, max-age=10, stale-while-revalidate=60");
        request.log.info({ event: "radius_feed_page", ...diagnostics }, "[RADIUS_FEED_PAGE]");
        return reply.send({
          feedId: FEED_ID,
          items: [],
          nextCursor: null,
          hasMore: false,
          debug: diagnostics,
          ...(debugFlag ? { radiusFeedDebug: diagnostics } : {})
        });
      }
    } else if (Date.now() - pool.loadedAtMs > CACHE_REFRESH_MS && !pool.loading) {
      nearMeRefreshSerial = nearMeRefreshSerial.then(() => rebuildPostPool(app)).catch(() => undefined);
    }

    const candidates = getFilteredCandidates(lat, lng, radiusMiles);
    const latE5 = roundCoordE5(lat);
    const lngE5 = roundCoordE5(lng);

    const emittedSeen = new Set<string>();
    if (parsedCursor.kind === "v2" && Array.isArray(parsedCursor.value.seen)) {
      for (const id of parsedCursor.value.seen) {
        if (typeof id === "string" && id.trim()) emittedSeen.add(id.trim());
      }
    }

    let pageRows: NearMePost[] = [];
    let cursorResetReason: string | null = null;
    let recoveredByLastPost = false;
    let poolOffset = 0;
    let nextPoolOffset = 0;
    let scanMode: "pool" | "pool_plus_exhaust" | "exhaust" = "pool";
    let exhaustive: Awaited<ReturnType<typeof collectExhaustiveNearMePosts>> | null = null;

    const isExhaustCursor = parsedCursor.kind === "v2" && parsedCursor.value.mode === "exhaust";

    if (isExhaustCursor) {
      scanMode = "exhaust";
      exhaustive = await collectExhaustiveNearMePosts({
        lat,
        lng,
        radiusMiles,
        limit,
        seen: emittedSeen,
        incoming: parsedCursor.value.exhaust ?? null
      });
      pageRows = exhaustive.items;
      for (const p of pageRows) emittedSeen.add(p.id);
    } else {
      const paginationStart = resolveNearMePaginationStart({
        parsedCursor,
        radiusMiles,
        latE5,
        lngE5,
        currentPoolLoadedAtMs: pool.loadedAtMs,
        candidateIds: candidates.map((post) => post.id),
        limit
      });
      poolOffset = paginationStart.offset;
      cursorResetReason = paginationStart.cursorResetReason;
      recoveredByLastPost = paginationStart.recoveredByLastPost;

      const poolSlice = candidates.slice(poolOffset, poolOffset + limit);
      pageRows = [...poolSlice];
      for (const p of poolSlice) emittedSeen.add(p.id);
      nextPoolOffset = poolOffset + poolSlice.length;

      const need = limit - pageRows.length;
      const poolDepleted = nextPoolOffset >= candidates.length;
      if (need > 0 && poolDepleted) {
        scanMode = candidates.length === 0 && poolOffset === 0 ? "exhaust" : "pool_plus_exhaust";
        exhaustive = await collectExhaustiveNearMePosts({
          lat,
          lng,
          radiusMiles,
          limit: need,
          seen: emittedSeen,
          incoming: null
        });
        pageRows.push(...exhaustive.items);
      }
    }

    const items = pageRows.map(mapLegacyReelsItem);
    const poolHasMore = !isExhaustCursor && nextPoolOffset < candidates.length;
    const exhaustHasMoreFlag = exhaustive ? exhaustHasMore(exhaustive.exhaust) : false;
    let hasMore = poolHasMore || exhaustHasMoreFlag;
    let exhaustedReason: string | null = hasMore ? null : "radius_scan_exhausted";

    const seenOutbound = [...emittedSeen].slice(-380);

    let nextCursor: string | null = null;
    const lastPostIdWire = pageRows.length > 0 ? (pageRows[pageRows.length - 1]?.id ?? null) : null;

    if (poolHasMore) {
      nextCursor = encodeNearMeCursorV2({
        mode: "pool",
        offset: nextPoolOffset,
        radiusMiles,
        latE5,
        lngE5,
        lastPostId: lastPostIdWire,
        poolLoadedAtMs: pool.loadedAtMs,
        seen: seenOutbound
      });
    } else if (exhaustHasMoreFlag && exhaustive) {
      nextCursor = encodeNearMeCursorV2({
        mode: "exhaust",
        offset: candidates.length,
        radiusMiles,
        latE5,
        lngE5,
        lastPostId: lastPostIdWire,
        poolLoadedAtMs: pool.loadedAtMs,
        seen: seenOutbound,
        exhaust: exhaustToWire(exhaustive.exhaust)
      });
    }

    if (hasMore && !nextCursor) {
      hasMore = false;
      exhaustedReason = exhaustedReason ?? "radius_invalid_has_more_no_cursor";
    }

    const diagnostics = {
      prefix: "RADIUS_FEED_PAGE",
      requestedRadiusMiles: radiusMiles,
      effectiveRadiusMiles: radiusMiles,
      pageSizeRequested: limit,
      postsReturned: items.length,
      candidatesScanned: candidates.length,
      candidatesWithinRadius: exhaustive?.candidatesWithinRadius ?? null,
      candidatesRejectedOutsideRadius: null,
      duplicatesSuppressed: exhaustive?.duplicatesSuppressed ?? 0,
      cursorReceived: typeof query.cursor === "string" ? query.cursor : null,
      cursorMode: parsedCursor.kind,
      nearMeMode: isExhaustCursor ? "exhaust" : "pool",
      cursorResetReason,
      cursorRecoveredByLastPost: recoveredByLastPost,
      nextCursorEmitted: nextCursor,
      nextCursorPresent: Boolean(nextCursor),
      hasMore,
      exhaustedReason,
      poolLoadedAtMs: pool.loadedAtMs,
      poolCount: pool.posts.length,
      scanMode,
      poolOffset,
      poolExhausted: nextPoolOffset >= candidates.length,
      firestoreFallbackUsed: exhaustive?.firestoreFallbackUsed ?? false,
      firestorePagesScanned: exhaustive?.firestorePagesScanned ?? 0,
      candidateSources: exhaustive?.candidateSources ?? [],
      withinRadiusTotalKnownOrScanned: candidates.length + (exhaustive?.candidatesWithinRadius ?? 0),
      invalidCursorRecovered: exhaustive?.invalidCursorRecovered ?? false,
      lastPostId: lastPostIdWire
    };

    reply.header("Cache-Control", "public, max-age=10, stale-while-revalidate=60");
    request.log.info({ event: "radius_feed_page", ...diagnostics }, "[RADIUS_FEED_PAGE]");
    return reply.send({
      feedId: FEED_ID,
      items,
      nextCursor,
      hasMore,
      debug: diagnostics,
      ...(debugFlag ? { radiusFeedDebug: diagnostics } : {})
    });
  });

  app.get(`${REELS_PREFIX}/near-me/count`, async (request, reply) => {
    setRouteName("compat.reels.near_me_count");
    const query = request.query as Record<string, unknown>;
    const lat = parseFinite(query.lat);
    const lng = parseFinite(query.lng);
    const radiusMiles = clampRadiusMiles(query.radiusMiles);

    if (lat == null || lng == null) return reply.status(400).send({ error: "Invalid lat or lng" });
    if (radiusMiles < 1 || radiusMiles > 500) return reply.status(400).send({ error: "radiusMiles must be 1-500" });
    if (!getFirestoreSourceClient()) return reply.status(503).send({ error: "Near me count unavailable" });

    if (pool.posts.length === 0) {
      await Promise.race([
        rebuildPostPoolQuick(app),
        new Promise<void>((resolve) => setTimeout(resolve, nearMeColdWaitMs()))
      ]);
    } else if (Date.now() - pool.loadedAtMs > CACHE_REFRESH_MS && !pool.loading) {
      nearMeRefreshSerial = nearMeRefreshSerial.then(() => rebuildPostPool(app)).catch(() => undefined);
    }

    const candidates = getFilteredCandidates(lat, lng, radiusMiles);
    // Count endpoint should not contribute Firestore reads once warm.
    incrementDbOps("queries", 0);
    incrementDbOps("reads", 0);
    reply.header("Cache-Control", "public, max-age=10, stale-while-revalidate=60");
    return reply.send({ count: candidates.length });
  });
}
