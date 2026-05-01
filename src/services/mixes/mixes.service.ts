import { createHash } from "node:crypto";
import { mixCache } from "../../cache/mixCache.js";
import type { MixFilter } from "../../contracts/v2/mixes.contract.js";
import { toSearchMixPreviewDTO, type SearchMixPreviewDTO } from "../../dto/compact-surface-dto.js";
import type { MixesRepository, MixSourcePost } from "../../repositories/mixes/mixes.repository.js";
import { mixesRepository, parsePostTimeMs } from "../../repositories/mixes/mixes.repository.js";

type CursorPayload = { v: 1; t: number; id: string };

type MixPostCard = SearchMixPreviewDTO;

function normalizeText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function normalizeActivityToken(value: string): string {
  const singular = value.trim().toLowerCase().replace(/\s+/g, " ").replace(/ies$/g, "y").replace(/s$/g, "");
  return singular;
}

const MAX_TRUSTED_ACTIVITY_TAGS = 12;
const SUSPICIOUS_ACTIVITY_TAGS = 20;

function collectActivityTokens(raw: unknown, out: string[], max = MAX_TRUSTED_ACTIVITY_TAGS): void {
  if (out.length >= max) return;
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const s = normalizeText(v);
      if (!s) continue;
      out.push(normalizeActivityToken(s));
      if (out.length >= max) break;
    }
    return;
  }
  const s = normalizeText(raw);
  if (s) out.push(normalizeActivityToken(s));
}

function postActivityTokens(row: MixSourcePost): string[] {
  const bucket: string[] = [];
  // Prefer explicit user-picked fields first; legacy `activities` can be polluted with huge taxonomy blobs.
  collectActivityTokens(row.activity, bucket);
  collectActivityTokens(row.selectedActivities, bucket);
  collectActivityTokens(row.activityTypes, bucket);

  const activities = Array.isArray(row.activities) ? row.activities : [];
  const activitiesLooksPolluted = activities.length > SUSPICIOUS_ACTIVITY_TAGS;
  if (!activitiesLooksPolluted || bucket.length === 0) {
    collectActivityTokens(activities, bucket);
  }
  return [...new Set(bucket)];
}

function postLatLng(row: MixSourcePost): { lat: number; lng: number } | null {
  const loc = (row.location ?? {}) as Record<string, unknown>;
  const geo = (row.geoData ?? {}) as Record<string, unknown>;
  const rawLat = row.lat ?? row.latitude ?? loc.lat ?? loc.latitude ?? geo.lat ?? geo.latitude;
  const rawLng = row.long ?? row.lng ?? row.longitude ?? loc.long ?? loc.lng ?? loc.longitude ?? geo.lng ?? geo.long ?? geo.longitude;
  const lat = typeof rawLat === "number" ? rawLat : Number(rawLat);
  const lng = typeof rawLng === "number" ? rawLng : Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function computeDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function stableCursorEncode(cursor: CursorPayload): string {
  return `mc:v1:${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

function stableCursorDecode(cursor: string | null): CursorPayload | null {
  if (!cursor) return null;
  const m = /^mc:v1:(.+)$/.exec(cursor);
  if (!m?.[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as CursorPayload;
    if (parsed.v !== 1 || !Number.isFinite(parsed.t) || typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeFilter(input: MixFilter): MixFilter {
  return {
    activity: normalizeText(input.activity)?.toLowerCase() ?? undefined,
    state: normalizeText(input.state)?.toLowerCase() ?? undefined,
    place: normalizeText(input.place)?.toLowerCase() ?? undefined,
    lat: typeof input.lat === "number" && Number.isFinite(input.lat) ? input.lat : undefined,
    lng: typeof input.lng === "number" && Number.isFinite(input.lng) ? input.lng : undefined,
    radiusKm: typeof input.radiusKm === "number" && Number.isFinite(input.radiusKm) ? input.radiusKm : undefined,
  };
}

function postLocationSummary(row: MixSourcePost): string | null {
  const geo = (row.geoData ?? {}) as Record<string, unknown>;
  const city = normalizeText(geo.city ?? row.city);
  const state = normalizeText(geo.state ?? row.state);
  const place = normalizeText((row as Record<string, unknown>).place ?? (row as Record<string, unknown>).region);
  return city && state ? `${city}, ${state}` : city ?? place ?? state ?? null;
}

function matchesLocation(row: MixSourcePost, filter: MixFilter): boolean {
  const geo = (row.geoData ?? {}) as Record<string, unknown>;
  const stateTokens = [
    normalizeText((row as Record<string, unknown>).state),
    normalizeText((row as Record<string, unknown>).stateRegionId),
    normalizeText(geo.state),
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  const placeTokens = [
    normalizeText((row as Record<string, unknown>).place),
    normalizeText((row as Record<string, unknown>).city),
    normalizeText((row as Record<string, unknown>).cityRegionId),
    normalizeText(geo.city),
    normalizeText(geo.country),
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  if (filter.state && !stateTokens.some((v) => v.includes(filter.state!))) return false;
  if (filter.place && !placeTokens.some((v) => v.includes(filter.place!))) return false;
  if (filter.lat != null && filter.lng != null && filter.radiusKm != null) {
    const coords = postLatLng(row);
    if (!coords) return false;
    const d = computeDistanceKm({ lat: filter.lat, lng: filter.lng }, coords);
    if (!(Number.isFinite(d) && d <= filter.radiusKm)) return false;
  }
  return true;
}

function mapPostCard(row: MixSourcePost, index: number, mixKey: string): MixPostCard {
  const assets = Array.isArray(row.assets) ? (row.assets as Array<Record<string, unknown>>) : [];
  const first = assets[0] ?? {};
  const variants = (first.variants ?? {}) as Record<string, unknown>;
  const mediaReadiness = ((row as any).mediaReadiness ?? {}) as Record<string, unknown>;
  const isVideoAsset =
    String((first as any).type ?? (first as any).mediaType ?? "").toLowerCase() === "video";
  const isVideoRow =
    String((row as any).mediaType ?? "").toLowerCase() === "video" ||
    Boolean((row as any).hasVideo) ||
    isVideoAsset;
  const poster =
    normalizeText((row as any).thumbUrl) ??
    normalizeText((row as any).displayPhotoLink) ??
    normalizeText(first.poster) ??
    normalizeText(first.thumbnail) ??
    "";
  const preview =
    normalizeText(variants.preview360Avc) ??
    normalizeText(variants.main720Avc) ??
    normalizeText((first as any).original) ??
    normalizeText((first as any).url);
  const postId = String(row.postId ?? row.id ?? "");
  const title = normalizeText((row as any).title ?? (row as any).caption ?? (row as any).content);
  const activities = postActivityTokens(row);
  const coords = postLatLng(row);
  const playbackUrl =
    normalizeText((row as any).playbackUrl) ??
    normalizeText(mediaReadiness.playbackUrl) ??
    normalizeText(variants.main720Avc) ??
    normalizeText(variants.main720) ??
    normalizeText((first as any).original) ??
    normalizeText((first as any).url);
  const fallbackVideoUrl =
    normalizeText((row as any).fallbackVideoUrl) ??
    normalizeText(mediaReadiness.fallbackVideoUrl);
  const playbackReady =
    typeof (row as any).playbackReady === "boolean"
      ? (row as any).playbackReady
      : typeof mediaReadiness.playbackReady === "boolean"
        ? Boolean(mediaReadiness.playbackReady)
        : Boolean(playbackUrl);
  const assetsReady =
    typeof (row as any).assetsReady === "boolean"
      ? (row as any).assetsReady
      : typeof mediaReadiness.assetsReady === "boolean"
        ? Boolean(mediaReadiness.assetsReady)
        : assets.length > 0;
  const mediaStatus =
    normalizeText((row as any).mediaStatus) ??
    normalizeText(mediaReadiness.mediaStatus) ??
    (playbackReady ? "ready" : "processing");
  const aspectRatio =
    typeof (row as any).aspectRatio === "number" && Number.isFinite((row as any).aspectRatio)
      ? (row as any).aspectRatio
      : typeof (first as any).aspectRatio === "number" && Number.isFinite((first as any).aspectRatio)
        ? (first as any).aspectRatio
        : 1;
  return toSearchMixPreviewDTO({
    postId,
    rankToken: `mix-${mixKey}-${index + 1}`,
    author: {
      userId: String((row as any).userId ?? ""),
      handle: String((row as any).userHandle ?? "").replace(/^@+/, "") || "unknown",
      name: normalizeText((row as any).userName),
      pic: normalizeText((row as any).userPic),
    },
    title,
    captionPreview: title,
    activities,
    locationSummary: postLocationSummary(row),
    address: postLocationSummary(row),
    media: {
      type: isVideoRow ? "video" : "image",
      posterUrl: poster,
      aspectRatio,
      startupHint: isVideoRow ? "poster_then_preview" : "poster_only",
    },
    geo: { lat: coords?.lat ?? null, long: coords?.lng ?? null },
    assets: [
      {
        id: `${postId}-asset-1`,
        type: isVideoAsset || isVideoRow ? "video" : "image",
        previewUrl: preview,
        posterUrl: poster || null,
        originalUrl: playbackUrl ?? preview ?? (poster || null),
        streamUrl: normalizeText(variants.hls),
        mp4Url: playbackUrl,
        blurhash: null,
        width: typeof (row as any).width === "number" ? (row as any).width : null,
        height: typeof (row as any).height === "number" ? (row as any).height : null,
        aspectRatio: aspectRatio || null,
        orientation: null,
      },
    ],
    createdAtMs: Math.max(0, parsePostTimeMs(row)),
    updatedAtMs: Math.max(0, parsePostTimeMs(row)),
    social: { likeCount: 0, commentCount: 0 },
    viewer: { liked: false, saved: false },
    firstAssetUrl: playbackUrl ?? preview ?? (poster || null),
    mediaStatus: mediaStatus === "failed" ? "failed" : mediaStatus === "ready" ? "ready" : "processing",
    assetsReady,
    posterReady: Boolean(poster),
    playbackReady,
    playbackUrlPresent: Boolean(playbackUrl),
    playbackUrl: playbackUrl ?? null,
    fallbackVideoUrl: fallbackVideoUrl ?? null,
    posterUrl: poster || null,
    hasVideo: isVideoRow,
    aspectRatio,
    width: typeof (row as any).width === "number" ? (row as any).width : null,
    height: typeof (row as any).height === "number" ? (row as any).height : null,
    resizeMode: normalizeText((row as any).resizeMode) ?? (isVideoRow ? "cover" : "contain"),
    letterboxGradients: Array.isArray((row as any).letterboxGradients)
      ? ((row as any).letterboxGradients as Array<{ top: string; bottom: string }>)
      : null,
  });
}

function hashFilter(filter: MixFilter, viewerId: string | null): string {
  const payload = JSON.stringify({ filter, viewerId: viewerId ?? "_" });
  return createHash("sha1").update(payload).digest("hex");
}

export class MixesService {
  constructor(private readonly repo: Pick<MixesRepository, "listFromPool"> = mixesRepository) {}

  async preview(input: { mixKey: string; filter: MixFilter; limit: number; viewerId: string | null }) {
    const started = Date.now();
    const filter = normalizeFilter(input.filter);
    const limit = input.limit === 1 ? 1 : 3;
    const cacheKey = `mixPreview:${hashFilter(filter, input.viewerId)}:limit:${limit}`;
    const cached = mixCache.get<any>(cacheKey);
    if (cached) {
      return {
        ...cached,
        diagnostics: { ...cached.diagnostics, cacheHit: true, latencyMs: Date.now() - started },
      };
    }
    const {
      posts: pool,
      readCount,
      source,
      poolLimit,
      poolState,
      poolBuiltAt,
      poolBuildLatencyMs,
      poolBuildReadCount,
      servedStale,
      servedEmptyWarming,
    } =
      await this.repo.listFromPool();
    const filtered = this.filterRows(pool, filter);
    const cards = filtered.slice(0, limit).map((row, idx) => mapPostCard(row, idx, input.mixKey));
    const payload = {
      ok: true as const,
      mixKey: input.mixKey,
      filters: filter,
      poolState,
      posts: cards,
      diagnostics: {
        routeName: "mixes.preview.get",
        mixKey: input.mixKey,
        filters: filter,
        candidateCount: filtered.length,
        returnedCount: cards.length,
        source,
        poolState,
        servedStale,
        servedEmptyWarming,
        cacheHit: false,
        latencyMs: Date.now() - started,
        readCount,
        poolLimit,
        poolBuiltAt,
        poolBuildLatencyMs,
        poolBuildReadCount,
      },
    };
    mixCache.set(cacheKey, payload, 45_000);
    return payload;
  }

  async page(input: { mixKey: string; filter: MixFilter; limit: number; cursor: string | null; viewerId: string | null }) {
    const started = Date.now();
    const filter = normalizeFilter(input.filter);
    const limit = Math.max(1, Math.min(24, Math.floor(input.limit || 12)));
    const parsedCursor = stableCursorDecode(input.cursor);
    const cacheKey = `mixPage:${hashFilter(filter, input.viewerId)}:limit:${limit}:cursor:${input.cursor ?? "_"}`;
    const cached = mixCache.get<any>(cacheKey);
    if (cached) {
      return {
        ...cached,
        diagnostics: { ...cached.diagnostics, cacheHit: true, latencyMs: Date.now() - started },
      };
    }
    const {
      posts: pool,
      readCount,
      source,
      poolLimit,
      poolState,
      poolBuiltAt,
      poolBuildLatencyMs,
      poolBuildReadCount,
      servedStale,
      servedEmptyWarming,
    } =
      await this.repo.listFromPool();
    const filtered = this.filterRows(pool, filter);
    const afterCursor = parsedCursor
      ? filtered.filter((row) => {
          const t = parsePostTimeMs(row);
          const id = String(row.postId);
          if (t < parsedCursor.t) return true;
          if (t > parsedCursor.t) return false;
          return id.localeCompare(parsedCursor.id) < 0;
        })
      : filtered;
    const pageRows = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? stableCursorEncode({ v: 1, t: parsePostTimeMs(last), id: String(last.postId) }) : null;
    const cards = pageRows.map((row, idx) => mapPostCard(row, idx, input.mixKey));
    const payload = {
      ok: true as const,
      mixKey: input.mixKey,
      filters: filter,
      poolState,
      posts: cards,
      nextCursor,
      hasMore,
      diagnostics: {
        routeName: "mixes.page.get",
        mixKey: input.mixKey,
        filters: filter,
        candidateCount: filtered.length,
        returnedCount: cards.length,
        source,
        poolState,
        servedStale,
        servedEmptyWarming,
        cacheHit: false,
        latencyMs: Date.now() - started,
        readCount,
        poolLimit,
        poolBuiltAt,
        poolBuildLatencyMs,
        poolBuildReadCount,
      },
    };
    mixCache.set(cacheKey, payload, 30_000);
    return payload;
  }

  private filterRows(rows: MixSourcePost[], filter: MixFilter): MixSourcePost[] {
    const normalizedActivity = filter.activity ? normalizeActivityToken(filter.activity) : null;
    return rows
      .filter((row) => {
        if (normalizedActivity) {
          const tokens = postActivityTokens(row);
          if (!tokens.includes(normalizedActivity)) return false;
        }
        if (!matchesLocation(row, filter)) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = parsePostTimeMs(a);
        const tb = parsePostTimeMs(b);
        if (ta !== tb) return tb - ta;
        return String(b.postId).localeCompare(String(a.postId));
      });
  }
}
