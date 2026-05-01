import { MixesRepository } from "../../../repositories/mixes.repository.js";
import { MixPostsRepository } from "../../../repositories/mixPosts.repository.js";
import { NearbyMixRepository } from "../../../repositories/nearbyMix.repository.js";
import { SearchRepository } from "../../../repositories/surfaces/search.repository.js";
import { getBestPostCover } from "../mixCover.service.js";
import { decodeMixCursorV2, encodeMixCursorV2, hashIdsDeterministic, type MixCursorV2 } from "./mixCursor.js";

type MixType = "general" | "daily" | "nearby" | "friends";

export type MixCard = {
  mixId: string;
  mixType: MixType;
  title: string;
  subtitle?: string;
  coverPostId: string | null;
  coverMedia: string | null;
  previewPostIds: string[];
  availableCount?: number;
  requiresLocation?: boolean;
  requiresFollowing?: boolean;
  hiddenReason?: string | null;
  debugMix?: Record<string, unknown>;
  // truth-layer: feed constraints used by both card + feed
  definition: {
    kind: "activity" | "daily" | "nearby" | "friends";
    activity?: string;
    dayKey?: string;
    ringsMiles?: number[];
  };
};

function dayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function titleCaseWords(value: string): string {
  return String(value ?? "")
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function displayFromStateRegionId(stateRegionId: string): string {
  const raw = String(stateRegionId ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(":").filter(Boolean);
  const state = parts[parts.length - 1] ?? raw;
  return titleCaseWords(state);
}

function displayFromCityRegionId(cityRegionId: string): string {
  const raw = String(cityRegionId ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(":").filter(Boolean);
  const city = parts[parts.length - 1] ?? raw;
  const state = parts.length >= 2 ? parts[parts.length - 2] : "";
  const cityName = titleCaseWords(city);
  const stateName = state ? titleCaseWords(state) : "";
  return stateName ? `${cityName}, ${stateName}` : cityName;
}

function milesDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
  return meters / 1609.34;
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function geoPrefixesAroundCenter(input: { lat: number; lng: number; precision: number }): Promise<string[]> {
  const { latLngToGeohash } = await import("../../../lib/latlng-geohash.js");
  // Precision=5 ~= 2.4km tiles; sample a small 3x3 grid around center.
  const step = 0.06; // ~4 miles latitude; coarse but bounded
  const deltas = [
    [0, 0],
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
    [step, step],
    [step, -step],
    [-step, step],
    [-step, -step],
  ] as const;
  const prefixes = deltas.map(([dLat, dLng]) => latLngToGeohash(input.lat + dLat, input.lng + dLng, input.precision));
  return uniq(prefixes);
}

function postId(row: Record<string, unknown>): string {
  return String((row as any)?.postId ?? (row as any)?.id ?? "").trim();
}

function postTime(row: Record<string, unknown>): number {
  const t = Number((row as any)?.time ?? (row as any)?.updatedAtMs ?? (row as any)?.createdAtMs ?? 0);
  return Number.isFinite(t) ? t : 0;
}

function seedHash(viewerId: string, dayKey: string): string {
  return hashIdsDeterministic([viewerId, dayKey, "daily_seed_v1"]);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function activityAliases(activity: string): string[] {
  const a = String(activity ?? "").trim().toLowerCase();
  const map: Record<string, string[]> = {
    hiking: ["hiking", "hike", "trail"],
    biking: ["biking", "bike", "cycling"],
    cafes: ["cafes", "cafe", "coffee"],
    beach: ["beach", "ocean"],
    park: ["park", "parks"],
    swimming: ["swimming", "swim"],
    sunset: ["sunset", "sunrise", "view"],
    food: ["food", "restaurant", "restaurants"],
  };
  const aliases = map[a] ?? [a];
  return [...new Set(aliases.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean))];
}

export class SearchMixesServiceV2 {
  private readonly mixesRepo = new MixesRepository();
  private readonly postsRepo = new MixPostsRepository();
  private readonly nearbyRepo = new NearbyMixRepository();
  private readonly searchRepo = new SearchRepository();

  async bootstrap(input: {
    viewerId: string;
    viewerCoords: { lat: number; lng: number } | null;
    limitGeneral: number;
    includeDebug: boolean;
  }): Promise<{ mixes: MixCard[]; debug?: Record<string, unknown> }> {
    const limitGeneral = clamp(input.limitGeneral, 1, 12);
    const viewerFollowingIds = await this.safeLoadFollowingIds(input.viewerId, 2);
    const followingCount = viewerFollowingIds.length;
    const activityProfile = await this.safeLoadActivityProfile(input.viewerId);

    const debug: Record<string, unknown> = input.includeDebug
      ? {
          followingCount,
          activityProfile: activityProfile.slice(0, 6),
        }
      : {};

    // Bootstrap should be FAST. Avoid N activity queries; derive both activity counts and cover previews
    // from a single bounded recent pool.
    const recentPool = await this.postsRepo.loadRecentPool(520);
    const activityCounts = new Map<string, number>();
    const bestByActivity = new Map<string, { coverPostId: string; coverUrl: string }>();
    const previewsByActivity = new Map<string, string[]>();
    for (const row of recentPool) {
      const pid = postId(row);
      if (!pid) continue;
      const acts = Array.isArray((row as any)?.activities)
        ? ((row as any).activities as unknown[])
        : [];
      for (const raw of acts) {
        const activity = String(raw ?? "").trim().toLowerCase();
        if (!activity) continue;
        activityCounts.set(activity, (activityCounts.get(activity) ?? 0) + 1);
        const previews = previewsByActivity.get(activity) ?? [];
        if (previews.length < 4 && !previews.includes(pid)) previews.push(pid);
        previewsByActivity.set(activity, previews);
        const current = bestByActivity.get(activity);
        if (current) continue;
        const cover = getBestPostCover(row);
        if (!cover.coverImageUrl || !cover.coverPostId) continue;
        bestByActivity.set(activity, {
          coverPostId: cover.coverPostId,
          coverUrl: cover.coverImageUrl,
        });
      }
    }

    const inventoryTop = [...activityCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 24)
      .map(([a]) => a);
    const fallback = ["hiking", "coffee", "brunch", "food", "swimming", "scenic views", "park", "sunset", "waterfall"];
    const candidates = uniq([...activityProfile.slice(0, 6), ...inventoryTop, ...fallback])
      .map((a) => String(a ?? "").trim().toLowerCase())
      .filter(Boolean);

    const generalCards: MixCard[] = [];
    for (const activity of candidates) {
      if (generalCards.length >= limitGeneral) break;
      const best = bestByActivity.get(activity) ?? null;
      if (!best?.coverUrl || !best.coverPostId) continue;
      generalCards.push({
        mixId: `activity:${activity}`,
        mixType: "general",
        title: `${activity.charAt(0).toUpperCase()}${activity.slice(1)}`,
        subtitle: `Top ${activity} posts`,
        coverPostId: best.coverPostId,
        coverMedia: best.coverUrl,
        previewPostIds: (previewsByActivity.get(activity) ?? []).slice(0, 4),
        availableCount: undefined,
        hiddenReason: null,
        definition: { kind: "activity", activity },
        ...(input.includeDebug
          ? {
              debugMix: {
                source: "bootstrap_recent_pool_v1",
                poolSize: recentPool.length,
                activityCount: activityCounts.get(activity) ?? 0,
              },
            }
          : {}),
      });
    }

    // If the activity taxonomy is too sparse, fill remaining slots with a truthful "Recent" mix.
    if (generalCards.length < limitGeneral) {
      const first = recentPool[0] ?? null;
      const cover = first ? getBestPostCover(first) : { coverImageUrl: null, coverPostId: null };
      const ids = recentPool.slice(0, 3).map((p) => postId(p)).filter(Boolean);
      if (cover.coverImageUrl && cover.coverPostId) {
        generalCards.push({
          mixId: "general:recent",
          mixType: "general",
          title: "Recent",
          subtitle: "Fresh posts across Locava",
          coverPostId: cover.coverPostId,
          coverMedia: cover.coverImageUrl,
          previewPostIds: ids,
          hiddenReason: null,
          definition: { kind: "activity", activity: "__recent__" },
          ...(input.includeDebug ? { debugMix: { source: "bootstrap_recent_pool_fallback_v1" } } : {}),
        });
      }
    }

    // Daily
    const daily = this.buildDailyCardFromPool({
      viewerId: input.viewerId,
      activityProfile,
      recentPool,
      includeDebug: input.includeDebug,
    });

    // Nearby
    const nearby = this.buildNearbyCardFromPool({
      viewerCoords: input.viewerCoords,
      recentPool,
      includeDebug: input.includeDebug,
    });

    // Friends
    const friends = await this.buildFriendsCard({
      viewerId: input.viewerId,
      followingCount,
      includeDebug: input.includeDebug,
    });

    const mixes = [
      ...generalCards.slice(0, limitGeneral),
      ...(daily ? [daily] : []),
      ...(nearby ? [nearby] : []),
      ...(friends ? [friends] : []),
    ];

    return { mixes, ...(input.includeDebug ? { debug } : {}) };
  }

  async feed(input: {
    viewerId: string;
    mixId: string;
    viewerCoords: { lat: number; lng: number } | null;
    limit: number;
    cursor: string | null;
    includeDebug: boolean;
    now?: Date;
  }): Promise<{
    mixId: string;
    mixType: MixType;
    posts: Record<string, unknown>[];
    nextCursor: string | null;
    hasMore: boolean;
    debug?: Record<string, unknown>;
  }> {
    const limit = input.mixId.startsWith("location_activity") ? clamp(input.limit, 1, 36) : clamp(input.limit, 4, 36);

    if (input.mixId.startsWith("location_activity")) {
      const parts = input.mixId.split(":");
      const kind = parts[1] ?? "";
      const activity = String(parts[parts.length - 1] ?? "").trim();
      const placeRaw = parts.slice(2, -1).join(":").trim();
      const place =
        kind === "state"
          ? displayFromStateRegionId(placeRaw)
          : kind === "city"
            ? displayFromCityRegionId(placeRaw)
            : titleCaseWords(placeRaw);
      const q = `${activity} in ${place}`.trim();
      const cursor = typeof input.cursor === "string" && input.cursor.startsWith("cursor:") ? input.cursor : null;
      const page = await this.searchRepo.getSearchResultsPage({
        viewerId: input.viewerId,
        query: q,
        cursor,
        limit,
        lat: input.viewerCoords?.lat ?? null,
        lng: input.viewerCoords?.lng ?? null,
        includeDebug: input.includeDebug,
      });
      const debug = input.includeDebug
        ? {
            kind: "location_activity",
            mixId: input.mixId,
            query: q,
            returnedCount: page.items.length,
          }
        : undefined;
      return {
        mixId: input.mixId,
        mixType: "general",
        posts: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        ...(debug ? { debug } : {}),
      };
    }

    if (input.mixId.startsWith("activity:")) {
      const activity = input.mixId.split(":").slice(1).join(":").trim().toLowerCase();
      const aliases = activityAliases(activity);
      const cursor = input.cursor ? decodeMixCursorV2(input.cursor) : null;
      const page = await this.postsRepo.pageByActivities({
        activities: aliases,
        limit,
        cursor:
          cursor && cursor.kind === "activity"
            ? { lastTime: cursor.lastTime, lastId: cursor.lastId }
            : null,
      });
      const next =
        page.nextCursor
          ? encodeMixCursorV2({
              v: 2,
              mixId: input.mixId,
              kind: "activity",
              activity,
              lastTime: page.nextCursor.lastTime,
              lastId: page.nextCursor.lastId,
            })
          : null;
      const debug = input.includeDebug
        ? { kind: "activity", activity, aliases, returnedCount: page.items.length }
        : undefined;
      return {
        mixId: input.mixId,
        mixType: "general",
        posts: page.items,
        nextCursor: next,
        hasMore: page.hasMore,
        ...(debug ? { debug } : {}),
      };
    }

    if (input.mixId === "general:recent") {
      const cursor = input.cursor ? decodeMixCursorV2(input.cursor) : null;
      const page = await this.postsRepo.pageRecent({
        limit,
        cursor: cursor && cursor.kind === "recent" ? { lastTime: cursor.lastTime, lastId: cursor.lastId } : null,
      });
      const next =
        page.nextCursor
          ? encodeMixCursorV2({
              v: 2,
              mixId: input.mixId,
              kind: "recent",
              lastTime: page.nextCursor.lastTime,
              lastId: page.nextCursor.lastId,
            })
          : null;
      const debug = input.includeDebug ? { kind: "recent", returnedCount: page.items.length } : undefined;
      return {
        mixId: input.mixId,
        mixType: "general",
        posts: page.items,
        nextCursor: next,
        hasMore: page.hasMore,
        ...(debug ? { debug } : {}),
      };
    }

    if (input.mixId === "friends:from_people_you_follow") {
      const followingIds = await this.safeLoadFollowingIds(input.viewerId, 500);
      if (followingIds.length === 0) {
        return {
          mixId: input.mixId,
          mixType: "friends",
          posts: [],
          nextCursor: null,
          hasMore: false,
          ...(input.includeDebug ? { debug: { hiddenReason: "not_following_anyone", followingCount: 0 } } : {}),
        };
      }
      const chunks = chunk(followingIds, 10);
      const followingHash = hashIdsDeterministic(followingIds.slice(0, 120));
      const cursor = input.cursor ? decodeMixCursorV2(input.cursor) : null;
      const perChunk =
        cursor && cursor.kind === "friends" && cursor.followingHash === followingHash
          ? cursor.chunks
              .sort((a, b) => a.chunkIndex - b.chunkIndex)
              .map((c) => ({ lastTime: c.lastTime, lastId: c.lastId, exhausted: c.exhausted }))
          : chunks.map(() => ({ lastTime: null, lastId: null, exhausted: false }));
      const merged = await this.postsRepo.pageByAuthorIdsMerged({
        authorIdChunks: chunks,
        limit,
        perChunkCursor: perChunk,
      });
      const nextCursor: MixCursorV2 = {
        v: 2,
        mixId: input.mixId,
        kind: "friends",
        followingHash,
        chunks: merged.nextPerChunkCursor.map((c, idx) => ({
          chunkIndex: idx,
          lastTime: c.lastTime,
          lastId: c.lastId,
          exhausted: c.exhausted,
        })),
      };
      const next = merged.hasMore ? encodeMixCursorV2(nextCursor) : null;
      const debug = input.includeDebug
        ? {
            kind: "friends",
            followingCount: followingIds.length,
            chunkCount: chunks.length,
            ...merged.debug,
            returnedCount: merged.items.length,
          }
        : undefined;
      return {
        mixId: input.mixId,
        mixType: "friends",
        posts: merged.items,
        nextCursor: next,
        hasMore: merged.hasMore,
        ...(debug ? { debug } : {}),
      };
    }

    if (input.mixId === "daily:for_you") {
      const dayKey = (input.now ?? new Date()).toISOString().slice(0, 10);
      const seed = seedHash(input.viewerId, dayKey);
      const profile = await this.safeLoadActivityProfile(input.viewerId);
      const activities = uniq(profile.filter(Boolean).slice(0, 3));
      const fallback = activities.length ? activities : ["hiking", "coffee", "food"];
      const chosen = fallback.slice(0, 3);
      const cursor = input.cursor ? decodeMixCursorV2(input.cursor) : null;
      const cursors =
        cursor && cursor.kind === "daily" && cursor.dayKey === dayKey && cursor.seed === seed
          ? cursor.cursors
          : chosen.map((a) => ({ activity: a, lastTime: null, lastId: null, exhausted: false }));
      const chunks = chosen.map((a) => [a]);
      // Reuse merged-by-author logic pattern by translating activities into independent "feeds"
      // using multiple activity queries and merging by time.
      const perActivity = await Promise.all(
        cursors.map(async (c) => {
          if (c.exhausted) return { activity: c.activity, rows: [], cursor: c };
          const page = await this.postsRepo.pageByActivity({
            activity: c.activity,
            limit: Math.max(8, limit * 3),
            cursor: c.lastTime != null && c.lastId ? { lastTime: c.lastTime, lastId: c.lastId } : null,
          });
          return {
            activity: c.activity,
            rows: page.items,
            cursor: {
              ...c,
              lastTime: page.nextCursor?.lastTime ?? c.lastTime,
              lastId: page.nextCursor?.lastId ?? c.lastId,
              exhausted: page.hasMore ? false : true,
            },
          };
        })
      );
      const heads = perActivity.map((p) => ({ idx: 0, rows: p.rows, activity: p.activity }));
      const merged: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      while (merged.length < limit && heads.some((h) => h.idx < h.rows.length)) {
        heads.sort((a, b) => {
          const ra = a.rows[a.idx];
          const rb = b.rows[b.idx];
          if (!ra) return 1;
          if (!rb) return -1;
          const ta = postTime(ra);
          const tb = postTime(rb);
          if (ta !== tb) return tb - ta;
          // deterministic tie-breaker: stable hash using seed
          const ha = hashIdsDeterministic([seed, postId(ra)]);
          const hb = hashIdsDeterministic([seed, postId(rb)]);
          return hb.localeCompare(ha);
        });
        const h = heads[0];
        if (!h) break;
        const row = h.rows[h.idx];
        if (!row) break;
        h.idx += 1;
        const pid = postId(row);
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        merged.push(row);
      }
      const nextCursors = perActivity.map((p) => p.cursor);
      const hasMore = nextCursors.some((c) => !c.exhausted);
      const next = hasMore
        ? encodeMixCursorV2({
            v: 2,
            mixId: input.mixId,
            kind: "daily",
            dayKey,
            seed,
            activities: chosen,
            cursors: nextCursors,
          })
        : null;
      const debug = input.includeDebug
        ? {
            kind: "daily",
            dayKey,
            activities: chosen,
            returnedCount: merged.length,
            hasMore,
          }
        : undefined;
      return {
        mixId: input.mixId,
        mixType: "daily",
        posts: merged,
        nextCursor: next,
        hasMore,
        ...(debug ? { debug } : {}),
      };
    }

    if (input.mixId === "nearby:near_you") {
      if (!input.viewerCoords) {
        return {
          mixId: input.mixId,
          mixType: "nearby",
          posts: [],
          nextCursor: null,
          hasMore: false,
          ...(input.includeDebug ? { debug: { hiddenReason: "missing_location" } } : {}),
        };
      }
      const center = input.viewerCoords;
      const ringsMiles = [1.5, 4, 10, 25, 60];
      const cursor = input.cursor ? decodeMixCursorV2(input.cursor) : null;
      const ringIndex = cursor && cursor.kind === "nearby" ? cursor.ringIndex : 0;
      const seen = new Set<string>(cursor && cursor.kind === "nearby" ? cursor.seen : []);
      const precision = 5;
      // Nearby strategy: ring-ordered geohash prefix scan over a bounded neighborhood (3x3).
      // Cursor advances prefixIndex and per-prefix startAfter.
      const prefixes = await geoPrefixesAroundCenter({ lat: center.lat, lng: center.lng, precision });
      const prefixIndex = cursor && cursor.kind === "nearby" ? cursor.prefixIndex : 0;
      const lastGeohash = cursor && cursor.kind === "nearby" ? cursor.lastGeohash : null;
      const lastTime = cursor && cursor.kind === "nearby" ? cursor.lastTime : null;
      const lastId = cursor && cursor.kind === "nearby" ? cursor.lastId : null;

      const out: Record<string, unknown>[] = [];
      let activePrefixIndex = prefixIndex;
      let activeLastGeohash = lastGeohash;
      let activeLastTime = lastTime;
      let activeLastId = lastId;
      const searched: Array<{ prefix: string; fetched: number }> = [];
      while (out.length < limit && activePrefixIndex < prefixes.length) {
        const prefix = prefixes[activePrefixIndex]!;
        const batch = await this.nearbyRepo.pageByGeohashPrefix({
          prefix,
          limit: Math.max(30, limit * 4),
          cursor:
            activeLastGeohash && activeLastTime != null && activeLastId
              ? { lastGeohash: activeLastGeohash, lastTime: activeLastTime, lastId: activeLastId }
              : null,
        });
        searched.push({ prefix, fetched: batch.items.length });
        const filtered = batch.items
          .map((p) => ({ post: p, d: milesDistance(center, { lat: Number((p as any).lat), lng: Number((p as any).lng ?? (p as any).long) }) }))
          .filter((x) => Number.isFinite(x.d))
          .filter((x) => x.d <= ringsMiles[Math.min(ringIndex, ringsMiles.length - 1)]!)
          .sort((a, b) => a.d - b.d || postTime(b.post) - postTime(a.post) || postId(b.post).localeCompare(postId(a.post)));
        for (const row of filtered) {
          const pid = postId(row.post);
          if (!pid || seen.has(pid)) continue;
          seen.add(pid);
          (row.post as any)._debugDistanceMiles = Number(row.d.toFixed(2));
          out.push(row.post);
          if (out.length >= limit) break;
        }
        if (batch.hasMore && batch.nextCursor) {
          activeLastGeohash = batch.nextCursor.lastGeohash;
          activeLastTime = batch.nextCursor.lastTime;
          activeLastId = batch.nextCursor.lastId;
        } else {
          activePrefixIndex += 1;
          activeLastGeohash = null;
          activeLastTime = null;
          activeLastId = null;
        }
        if (activePrefixIndex >= prefixes.length && out.length < limit && ringIndex + 1 < ringsMiles.length) {
          // expand ring
          break;
        }
      }

      // Deterministic/emulator safety: if prefix scan yields no usable items, fall back to a bounded
      // recent scan filtered by distance. This preserves "no global posts as nearby" while avoiding
      // hard dependency on geohash parity/coverage.
      if (out.length === 0 && searched.length > 0) {
        const recent = await this.postsRepo.pageRecent({ limit: 220, cursor: null });
        const filtered = (recent.items ?? [])
          .map((p) => {
            const lat = Number((p as any)?.lat ?? NaN);
            const lng = Number((p as any)?.lng ?? (p as any)?.long ?? NaN);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const d = milesDistance(center, { lat, lng });
            return { post: p as unknown as Record<string, unknown>, d };
          })
          .filter(Boolean) as Array<{ post: Record<string, unknown>; d: number }>;
        filtered.sort((a, b) => a.d - b.d || postTime(b.post) - postTime(a.post) || postId(b.post).localeCompare(postId(a.post)));
        for (const row of filtered) {
          if (row.d > ringsMiles[Math.min(ringIndex, ringsMiles.length - 1)]!) continue;
          const pid = postId(row.post);
          if (!pid || seen.has(pid)) continue;
          seen.add(pid);
          (row.post as any)._debugDistanceMiles = Number(row.d.toFixed(2));
          out.push(row.post);
          if (out.length >= limit) break;
        }
      }
      const canExpandRing = activePrefixIndex >= prefixes.length && ringIndex + 1 < ringsMiles.length;
      const nextPayload: MixCursorV2 = {
        v: 2,
        mixId: input.mixId,
        kind: "nearby",
        center,
        ringsMiles,
        ringIndex: canExpandRing ? ringIndex + 1 : ringIndex,
        geohashPrefixes: prefixes,
        prefixIndex: canExpandRing ? 0 : activePrefixIndex,
        lastGeohash: canExpandRing ? null : activeLastGeohash,
        lastTime: canExpandRing ? null : activeLastTime,
        lastId: canExpandRing ? null : activeLastId,
        seen: Array.from(seen).slice(-220),
      };
      const hasMore = canExpandRing || (nextPayload.prefixIndex < prefixes.length);
      const next = hasMore ? encodeMixCursorV2(nextPayload) : null;
      const debug = input.includeDebug
        ? {
            kind: "nearby",
            center,
            ringIndex,
            ringMiles: ringsMiles[Math.min(ringIndex, ringsMiles.length - 1)],
            prefixes,
            searched,
            returnedCount: out.length,
            hasMore,
            seenCount: seen.size,
          }
        : undefined;
      return {
        mixId: input.mixId,
        mixType: "nearby",
        posts: out,
        nextCursor: next,
        hasMore,
        ...(debug ? { debug } : {}),
      };
    }

    // Unknown mixId: treat as empty
    return { mixId: input.mixId, mixType: "general", posts: [], nextCursor: null, hasMore: false };
  }

  // Nearby Firestore reads live in NearbyMixRepository.

  private async safeLoadFollowingIds(viewerId: string, limit: number): Promise<string[]> {
    try {
      return await this.mixesRepo.loadViewerFollowingUserIds(viewerId, limit);
    } catch {
      return [];
    }
  }

  private async safeLoadActivityProfile(viewerId: string): Promise<string[]> {
    try {
      return await this.mixesRepo.loadViewerActivityProfile(viewerId);
    } catch {
      return [];
    }
  }

  private async buildFriendsCard(input: { viewerId: string; followingCount: number; includeDebug: boolean }): Promise<MixCard | null> {
    const requiresFollowing = true;
    if (input.followingCount <= 0) {
      return {
        mixId: "friends:from_people_you_follow",
        mixType: "friends",
        title: "Friends Mix",
        subtitle: "Recent posts from people you follow",
        coverPostId: null,
        coverMedia: null,
        previewPostIds: [],
        requiresFollowing,
        hiddenReason: "not_following_anyone",
        definition: { kind: "friends" },
        ...(input.includeDebug ? { debugMix: { followingCount: input.followingCount } } : {}),
      };
    }
    // Production-grade: cover art must come from a real matching post.
    // Bound reads: use first N following IDs and fetch a single merged page.
    const followingIds = await this.safeLoadFollowingIds(input.viewerId, 120);
    const chunks = chunk(followingIds.slice(0, 50), 10);
    const cursors = chunks.map(() => ({ lastTime: null, lastId: null, exhausted: false }));
    const merged = chunks.length
      ? await this.postsRepo.pageByAuthorIdsMerged({ authorIdChunks: chunks, limit: 3, perChunkCursor: cursors })
      : { items: [], hasMore: false, nextPerChunkCursor: [], debug: { chunksQueried: 0, candidateCount: 0 } };
    const first = merged.items[0] ?? null;
    const cover = getBestPostCover(first);
    const previewPostIds = merged.items.map((p) => postId(p)).filter(Boolean).slice(0, 3);
    const hiddenReason = cover.coverImageUrl ? null : "no_following_posts";
    return {
      mixId: "friends:from_people_you_follow",
      mixType: "friends",
      title: "Friends Mix",
      subtitle: "Recent posts from people you follow",
      coverPostId: cover.coverPostId,
      coverMedia: cover.coverImageUrl,
      previewPostIds,
      requiresFollowing,
      hiddenReason,
      definition: { kind: "friends" },
      ...(input.includeDebug
        ? {
            debugMix: {
              followingCount: input.followingCount,
              coverHydration: cover.coverImageUrl ? "following_posts_merge" : "none",
              ...merged.debug,
            },
          }
        : {}),
    };
  }

  private buildNearbyCardFromPool(input: {
    viewerCoords: { lat: number; lng: number } | null;
    recentPool: Record<string, unknown>[];
    includeDebug: boolean;
  }): MixCard | null {
    const requiresLocation = true;
    if (!input.viewerCoords) {
      return {
        mixId: "nearby:near_you",
        mixType: "nearby",
        title: "Nearby",
        subtitle: "Great spots nearby",
        coverPostId: null,
        coverMedia: null,
        previewPostIds: [],
        requiresLocation,
        hiddenReason: "missing_location",
        definition: { kind: "nearby", ringsMiles: [1.5, 4, 10, 25, 60] },
        ...(input.includeDebug ? { debugMix: { hiddenReason: "missing_location" } } : {}),
      };
    }
    const ringsMiles = [1.5, 4, 10, 25, 60];
    const nearbyRows = input.recentPool
      .map((row) => {
        const lat = toFiniteNumber((row as any)?.lat);
        const lng = toFiniteNumber((row as any)?.lng ?? (row as any)?.long);
        if (lat == null || lng == null) return null;
        const d = milesDistance(input.viewerCoords!, { lat, lng });
        return { row, d };
      })
      .filter(Boolean)
      .sort((a, b) => (a!.d - b!.d) || postTime(b!.row) - postTime(a!.row))
      .map((x) => x!.row);
    const bounded = nearbyRows.filter((row) => {
      const lat = toFiniteNumber((row as any)?.lat);
      const lng = toFiniteNumber((row as any)?.lng ?? (row as any)?.long);
      if (lat == null || lng == null) return false;
      return milesDistance(input.viewerCoords!, { lat, lng }) <= ringsMiles[ringsMiles.length - 1]!;
    });
    const first = bounded[0] ?? null;
    const cover = getBestPostCover(first);
    const previewPostIds = bounded.map((p) => postId(p)).filter(Boolean).slice(0, 4);
    return {
      mixId: "nearby:near_you",
      mixType: "nearby",
      title: "Nearby",
      subtitle: "Great spots nearby",
      coverPostId: cover.coverPostId,
      coverMedia: cover.coverImageUrl,
      previewPostIds,
      requiresLocation,
      hiddenReason: cover.coverImageUrl ? null : "no_nearby_posts",
      definition: { kind: "nearby", ringsMiles },
      ...(input.includeDebug
        ? { debugMix: { coverHydration: cover.coverImageUrl ? "nearby_recent_pool" : "none", candidateCount: bounded.length } }
        : {}),
    };
  }

  private buildDailyCardFromPool(input: {
    viewerId: string;
    activityProfile: string[];
    recentPool: Record<string, unknown>[];
    includeDebug: boolean;
  }): MixCard | null {
    const profile = uniq(input.activityProfile.map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean));
    const fallback = ["hiking", "coffee", "food"];
    const chosen = (profile.length ? profile : fallback).slice(0, 3);
    const scored = input.recentPool
      .map((row) => {
        const acts = Array.isArray((row as any)?.activities) ? ((row as any).activities as unknown[]) : [];
        const normalized = acts.map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean);
        const score = normalized.reduce((acc, a) => acc + (chosen.includes(a) ? 1 : 0), 0);
        return { row, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || postTime(b.row) - postTime(a.row));
    const first = scored[0]?.row ?? input.recentPool[0] ?? null;
    const cover = getBestPostCover(first);
    const previewPostIds = scored.map((x) => postId(x.row)).filter(Boolean).slice(0, 4);
    return {
      mixId: "daily:for_you",
      mixType: "daily",
      title: "Daily Mix",
      subtitle: "Picks refreshed daily",
      coverPostId: cover.coverPostId,
      coverMedia: cover.coverImageUrl,
      previewPostIds,
      hiddenReason: cover.coverImageUrl ? null : "empty_daily_inventory",
      definition: { kind: "daily", dayKey: dayKeyUtc() },
      ...(input.includeDebug
        ? { debugMix: { coverHydration: cover.coverImageUrl ? "daily_recent_pool" : "none", chosenActivities: chosen } }
        : {}),
    };
  }
}
