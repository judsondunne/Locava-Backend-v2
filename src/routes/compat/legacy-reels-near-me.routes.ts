import type { FastifyInstance } from "fastify";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
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

type NearMeCursorV2 = {
  v: 2;
  offset: number;
  radiusMiles: number;
  latE5: number;
  lngE5: number;
  lastPostId: string | null;
  poolLoadedAtMs: number;
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
      const parsed = JSON.parse(payload) as Partial<NearMeCursorV2>;
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
      return {
        kind: "v2",
        value: {
          v: 2,
          offset: Math.floor(offset),
          radiusMiles,
          latE5: Math.floor(latE5),
          lngE5: Math.floor(lngE5),
          lastPostId: typeof parsed.lastPostId === "string" && parsed.lastPostId.trim() ? parsed.lastPostId.trim() : null,
          poolLoadedAtMs: Math.floor(poolLoadedAtMs)
        }
      };
    } catch {
      return { kind: "invalid" };
    }
  }
  return { kind: "legacy", offset: parseNearMeCursor(raw) };
}

export function encodeNearMeCursorV2(input: Omit<NearMeCursorV2, "v">): string {
  return `${NEAR_ME_CURSOR_PREFIX}${Buffer.from(
    JSON.stringify({
      v: 2,
      ...input
    }),
    "utf8"
  ).toString("base64url")}`;
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
  return 450;
}

/** First-page fill so near-me never waits on a 10k-doc scan on cold request paths. */
async function rebuildPostPoolQuick(app: FastifyInstance): Promise<void> {
  if (pool.posts.length > 0) return;
  if (pool.loading && pool.inFlight) {
    await Promise.race([pool.inFlight, new Promise<void>((resolve) => setTimeout(resolve, 2200))]);
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
      const dt = postTimeMs(b) - postTimeMs(a);
      if (dt !== 0) return dt;
      return b.id.localeCompare(a.id);
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
  let offset = parsedCursor.kind === "legacy" ? parsedCursor.offset : parsedCursor.value.offset;
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

export async function registerLegacyReelsNearMeRoutes(app: FastifyInstance): Promise<void> {
  let refreshTimer: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    const fullDelayMs = toIntEnv("NEAR_ME_FULL_REFRESH_DELAY_MS", 15_000, 2_000, 120_000);
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
        new Promise<void>((resolve) => setTimeout(resolve, 2200))
      ]);
    } else if (Date.now() - pool.loadedAtMs > CACHE_REFRESH_MS && !pool.loading) {
      nearMeRefreshSerial = nearMeRefreshSerial.then(() => rebuildPostPool(app)).catch(() => undefined);
    }

    const candidates = getFilteredCandidates(lat, lng, radiusMiles);
    const latE5 = roundCoordE5(lat);
    const lngE5 = roundCoordE5(lng);

    const paginationStart = resolveNearMePaginationStart({
      parsedCursor,
      radiusMiles,
      latE5,
      lngE5,
      currentPoolLoadedAtMs: pool.loadedAtMs,
      candidateIds: candidates.map((post) => post.id),
      limit
    });
    const offset = paginationStart.offset;
    const cursorResetReason = paginationStart.cursorResetReason;
    const recoveredByLastPost = paginationStart.recoveredByLastPost;

    const pageRows = candidates.slice(offset, offset + limit);
    const items = pageRows.map(mapLegacyReelsItem);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < candidates.length;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeNearMeCursorV2({
            offset: nextOffset,
            radiusMiles,
            latE5,
            lngE5,
            lastPostId: pageRows[pageRows.length - 1]?.id ?? null,
            poolLoadedAtMs: pool.loadedAtMs
          })
        : null;

    const diagnostics = {
      prefix: "RADIUS_FEED_PAGE",
      requestedRadiusMiles: radiusMiles,
      effectiveRadiusMiles: radiusMiles,
      pageSizeRequested: limit,
      postsReturned: items.length,
      candidatesScanned: candidates.length,
      cursorReceived: typeof query.cursor === "string" ? query.cursor : null,
      cursorMode: parsedCursor.kind,
      cursorResetReason,
      cursorRecoveredByLastPost: recoveredByLastPost,
      nextCursorEmitted: nextCursor,
      hasMore,
      exhaustedReason: hasMore ? null : "radius_candidates_exhausted",
      poolLoadedAtMs: pool.loadedAtMs
    };

    reply.header("Cache-Control", "public, max-age=10, stale-while-revalidate=60");
    request.log.info({ event: "radius_feed_page", ...diagnostics }, "[RADIUS_FEED_PAGE]");
    return reply.send({ feedId: FEED_ID, items, nextCursor, hasMore, debug: diagnostics });
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
        new Promise<void>((resolve) => setTimeout(resolve, 2200))
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
