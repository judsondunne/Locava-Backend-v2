import { randomBytes } from "node:crypto";
import type { SimpleFeedSortMode } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import {
  resolveForYouSimpleServingMode,
  type ForYouSimpleServingMode
} from "./feed-for-you-simple-serving-mode.js";
export type ForYouRadiusFilter = {
  mode: "global" | "nearMe" | "custom";
  centerLat: number | null;
  centerLng: number | null;
  radiusMiles: number | null;
};

export const FOR_YOU_SIMPLE_CURSOR_PREFIX_V3 = "fys:v3:";
export const FOR_YOU_SIMPLE_CURSOR_PREFIX_V2 = "fys:v2:";
export const FOR_YOU_SIMPLE_CURSOR_PREFIX_V1 = "fys:v1:";
export const FOR_YOU_SIMPLE_CURSOR_SEEN_CAP = 200;
export const FOR_YOU_SIMPLE_MAX_SEEN_IDS = FOR_YOU_SIMPLE_CURSOR_SEEN_CAP;
export const FOR_YOU_SIMPLE_RECENT_AUTHOR_CAP = 20;

export type ForYouSimpleServePhase = "reel_tier_5" | "reel_tier_4" | "reel_other" | "fallback_normal";

export const FOR_YOU_SIMPLE_SERVE_PHASES: readonly ForYouSimpleServePhase[] = [
  "reel_tier_5",
  "reel_tier_4",
  "reel_other",
  "fallback_normal"
] as const;

export const FOR_YOU_SIMPLE_REEL_SERVE_PHASES: readonly ForYouSimpleServePhase[] = [
  "reel_tier_5",
  "reel_tier_4",
  "reel_other"
] as const;

export function allReelPhasesExhausted(
  phases: Record<ForYouSimpleServePhase, ForYouSimplePhaseCursorState>
): boolean {
  return FOR_YOU_SIMPLE_REEL_SERVE_PHASES.every((phase) => phases[phase].exhausted === true);
}

export function getEarliestAllowedPhase(
  cursor: Pick<ForYouSimpleCursorV3, "phases">
): ForYouSimpleServePhase {
  if (!cursor.phases.reel_tier_5.exhausted) return "reel_tier_5";
  if (!cursor.phases.reel_tier_4.exhausted) return "reel_tier_4";
  if (!cursor.phases.reel_other.exhausted) return "reel_other";
  return "fallback_normal";
}

export function fallbackAllowed(cursor: Pick<ForYouSimpleCursorV3, "phases">): boolean {
  return allReelPhasesExhausted(cursor.phases);
}

export function repairForYouSimpleCursor(
  cursor: ForYouSimpleCursorV3,
  onRepaired?: (input: { previousActivePhase: ForYouSimpleServePhase; repairedActivePhase: ForYouSimpleServePhase }) => void
): ForYouSimpleCursorV3 {
  const repairedActivePhase = getEarliestAllowedPhase(cursor);
  if (cursor.activePhase === repairedActivePhase) {
    return cursor;
  }
  onRepaired?.({ previousActivePhase: cursor.activePhase, repairedActivePhase });
  return {
    ...cursor,
    activePhase: repairedActivePhase
  };
}

export type ForYouSimplePhaseCursorState = {
  anchor: number | string;
  wrapped: boolean;
  lastValue: number | string | null;
  lastPostId: string | null;
  exhausted: boolean;
};

export type ForYouSimpleRadiusGeoCursorState = {
  lastGeohash: string;
  lastTimeMs: number;
  lastPostId: string;
};

export type ForYouSimpleRadiusScanState = {
  phase: "geo" | "recent";
  prefixIdx: number;
  geoCursor: ForYouSimpleRadiusGeoCursorState | null;
  lastTimeMs: number | null;
  lastPostId: string | null;
  geoFinished: boolean;
  recentFinished: boolean;
  exhausted: boolean;
};

export function createDefaultRadiusScanState(): ForYouSimpleRadiusScanState {
  return {
    phase: "recent",
    prefixIdx: 0,
    geoCursor: null,
    lastTimeMs: null,
    lastPostId: null,
    geoFinished: false,
    recentFinished: false,
    exhausted: false
  };
}

export function repairRadiusScanState(
  scan?:
    | ForYouSimpleRadiusScanState
    | {
        lastTimeMs?: number | null;
        lastPostId?: string | null;
        exhausted?: boolean;
      }
): ForYouSimpleRadiusScanState {
  if (!scan) return createDefaultRadiusScanState();
  if ("phase" in scan && (scan.phase === "geo" || scan.phase === "recent")) {
    return {
      ...scan,
      exhausted: scan.geoFinished && scan.recentFinished
    };
  }
  const legacy = scan as { lastTimeMs?: number | null; lastPostId?: string | null; exhausted?: boolean };
  return {
    phase: legacy.exhausted === true ? "geo" : "recent",
    prefixIdx: 0,
    geoCursor: null,
    lastTimeMs: legacy.lastTimeMs ?? null,
    lastPostId: legacy.lastPostId ?? null,
    geoFinished: legacy.exhausted === true,
    recentFinished: false,
    exhausted: false
  };
}

export type ForYouSimpleCursorV3 = {
  v: 3;
  mode: SimpleFeedSortMode;
  activePhase: ForYouSimpleServePhase;
  phases: Record<ForYouSimpleServePhase, ForYouSimplePhaseCursorState>;
  seen: string[];
  filter?: ForYouRadiusFilter;
  servingMode?: ForYouSimpleServingMode;
  radiusScan?: ForYouSimpleRadiusScanState;
  continuationSeq: number;
  recentAuthorIds?: string[];
  lastAuthorId?: string | null;
  recycleMode?: boolean;
};

export function normalizeCursorSeenIds(seen: readonly string[]): string[] {
  return [...new Set(seen.map((value) => String(value).trim()).filter(Boolean))].slice(-FOR_YOU_SIMPLE_MAX_SEEN_IDS);
}

export function appendCursorChainState(
  cursor: ForYouSimpleCursorV3,
  input: {
    returnedIds: string[];
    authorIds: string[];
    recycleMode: boolean;
  }
): ForYouSimpleCursorV3 {
  const seen = normalizeCursorSeenIds([...cursor.seen, ...input.returnedIds]);
  const recentAuthorIds = [...new Set([...(cursor.recentAuthorIds ?? []), ...input.authorIds].filter(Boolean))].slice(
    -FOR_YOU_SIMPLE_RECENT_AUTHOR_CAP
  );
  const continuationSeq =
    input.returnedIds.length > 0 ? Math.max(1, cursor.continuationSeq + 1) : Math.max(cursor.continuationSeq, seen.length > 0 ? 1 : 0);
  return {
    ...cursor,
    seen,
    recentAuthorIds,
    lastAuthorId: input.authorIds[input.authorIds.length - 1] ?? cursor.lastAuthorId ?? null,
    recycleMode: input.recycleMode,
    continuationSeq
  };
}

export function createPhaseCursorState(mode: SimpleFeedSortMode): ForYouSimplePhaseCursorState {
  return {
    anchor: mode === "randomKey" ? Math.random() : randomBytes(10).toString("hex"),
    wrapped: false,
    lastValue: null,
    lastPostId: null,
    exhausted: false
  };
}

export function createFreshCursorV3(mode: SimpleFeedSortMode, filter?: ForYouRadiusFilter): ForYouSimpleCursorV3 {
  const radiusFilter = filter ?? { mode: "global", centerLat: null, centerLng: null, radiusMiles: null };
  const servingMode = resolveForYouSimpleServingMode({ radiusFilter, followingMode: false });
  return {
    v: 3,
    mode,
    activePhase: "reel_tier_5",
    phases: {
      reel_tier_5: createPhaseCursorState(mode),
      reel_tier_4: createPhaseCursorState(mode),
      reel_other: createPhaseCursorState(mode),
      fallback_normal: createPhaseCursorState(mode)
    },
    seen: [],
    ...(filter && filter.mode !== "global" ? { filter } : {}),
    servingMode,
    ...(servingMode === "radius_all_posts" ? { radiusScan: createDefaultRadiusScanState() } : {}),
    continuationSeq: 0,
    recentAuthorIds: [],
    lastAuthorId: null,
    recycleMode: false
  };
}

export function repairCursorServingMode(
  cursor: ForYouSimpleCursorV3,
  input: {
    servingMode: ForYouSimpleServingMode;
    radiusFilter: ForYouRadiusFilter;
  },
  onRepaired?: (input: { previousServingMode: ForYouSimpleServingMode | undefined; repairedServingMode: ForYouSimpleServingMode }) => void
): ForYouSimpleCursorV3 {
  const repairedServingMode = input.servingMode;
  if (cursor.servingMode === repairedServingMode) {
    if (repairedServingMode === "radius_all_posts" && !cursor.radiusScan) {
      return {
        ...cursor,
        radiusScan: createDefaultRadiusScanState()
      };
    }
    return cursor;
  }
  onRepaired?.({ previousServingMode: cursor.servingMode, repairedServingMode });
  const seen = normalizeCursorSeenIds(cursor.seen ?? []);
  if (repairedServingMode === "radius_all_posts") {
    return {
      ...createFreshCursorV3(cursor.mode, input.radiusFilter),
      seen,
      continuationSeq: cursor.continuationSeq,
      recentAuthorIds: cursor.recentAuthorIds ?? [],
      lastAuthorId: cursor.lastAuthorId ?? null,
      recycleMode: false,
      servingMode: repairedServingMode,
      filter: input.radiusFilter,
      radiusScan: createDefaultRadiusScanState()
    };
  }
  return {
    ...createFreshCursorV3(cursor.mode, input.radiusFilter),
    seen,
    continuationSeq: cursor.continuationSeq,
    recentAuthorIds: cursor.recentAuthorIds ?? [],
    lastAuthorId: cursor.lastAuthorId ?? null,
    recycleMode: cursor.recycleMode === true,
    servingMode: repairedServingMode
  };
}

export function nextServePhase(phase: ForYouSimpleServePhase): ForYouSimpleServePhase | null {
  const idx = FOR_YOU_SIMPLE_SERVE_PHASES.indexOf(phase);
  if (idx < 0 || idx >= FOR_YOU_SIMPLE_SERVE_PHASES.length - 1) return null;
  return FOR_YOU_SIMPLE_SERVE_PHASES[idx + 1] ?? null;
}

export function encodeForYouSimpleCursor(cursor: ForYouSimpleCursorV3): string {
  const normalized = repairForYouSimpleCursor({
    ...cursor,
    seen: normalizeCursorSeenIds(cursor.seen ?? []),
    recentAuthorIds: [...new Set((cursor.recentAuthorIds ?? []).filter(Boolean))].slice(-FOR_YOU_SIMPLE_RECENT_AUTHOR_CAP),
    continuationSeq:
      cursor.seen.length > 0 && cursor.continuationSeq <= 0 ? 1 : Math.max(0, Math.floor(cursor.continuationSeq))
  });
  return `${FOR_YOU_SIMPLE_CURSOR_PREFIX_V3}${Buffer.from(JSON.stringify(normalized), "utf8").toString("base64url")}`;
}

export function decodeForYouSimpleCursor(
  cursor: string | null,
  onRepaired?: (input: { previousActivePhase: ForYouSimpleServePhase; repairedActivePhase: ForYouSimpleServePhase }) => void
): ForYouSimpleCursorV3 | null {
  if (!cursor) return null;
  if (cursor.startsWith(FOR_YOU_SIMPLE_CURSOR_PREFIX_V3)) {
    return decodeV3Payload(cursor.slice(FOR_YOU_SIMPLE_CURSOR_PREFIX_V3.length), onRepaired);
  }
  if (cursor.startsWith(FOR_YOU_SIMPLE_CURSOR_PREFIX_V2)) {
    return upgradeV2Cursor(cursor.slice(FOR_YOU_SIMPLE_CURSOR_PREFIX_V2.length));
  }
  if (cursor.startsWith(FOR_YOU_SIMPLE_CURSOR_PREFIX_V1)) {
    return upgradeV2Cursor(cursor.slice(FOR_YOU_SIMPLE_CURSOR_PREFIX_V1.length));
  }
  throw new Error("invalid_simple_feed_cursor");
}

function decodeV3Payload(
  payload: string,
  onRepaired?: (input: { previousActivePhase: ForYouSimpleServePhase; repairedActivePhase: ForYouSimpleServePhase }) => void
): ForYouSimpleCursorV3 {
  const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  if (raw.v !== 3) throw new Error("version");
  const mode = raw.mode;
  if (mode !== "randomKey" && mode !== "docId") throw new Error("mode");
  const activePhase = raw.activePhase;
  if (
    activePhase !== "reel_tier_5" &&
    activePhase !== "reel_tier_4" &&
    activePhase !== "reel_other" &&
    activePhase !== "fallback_normal"
  ) {
    throw new Error("phase");
  }
  const phasesRaw = raw.phases as Record<string, unknown> | undefined;
  if (!phasesRaw) throw new Error("phases");
  const phases = {} as Record<ForYouSimpleServePhase, ForYouSimplePhaseCursorState>;
  for (const phase of FOR_YOU_SIMPLE_SERVE_PHASES) {
    phases[phase] = normalizePhaseState(mode, (phasesRaw[phase] as Record<string, unknown> | undefined) ?? {});
  }
  const seen = normalizeCursorSeenIds(
    Array.isArray(raw.seen) ? raw.seen.map((value) => String(value)).filter(Boolean) : []
  );
  const filter = normalizeFilter(raw.filter);
  const servingMode = normalizeServingMode(raw.servingMode, filter);
  const radiusScan = normalizeRadiusScan(raw.radiusScan);
  const continuationSeqRaw =
    typeof raw.continuationSeq === "number" && Number.isFinite(raw.continuationSeq)
      ? Math.max(0, Math.floor(raw.continuationSeq))
      : 0;
  const continuationSeq = seen.length > 0 && continuationSeqRaw <= 0 ? 1 : continuationSeqRaw;
  const recentAuthorIds = Array.isArray(raw.recentAuthorIds)
    ? [...new Set(raw.recentAuthorIds.map((value) => String(value)).filter(Boolean))].slice(-FOR_YOU_SIMPLE_RECENT_AUTHOR_CAP)
    : [];
  const lastAuthorId =
    typeof raw.lastAuthorId === "string" && raw.lastAuthorId.trim() ? raw.lastAuthorId.trim() : null;
  const recycleMode = raw.recycleMode === true;
  return repairForYouSimpleCursor(
    {
      v: 3,
      mode,
      activePhase,
      phases,
      seen,
      ...(filter ? { filter } : {}),
      servingMode,
      ...(radiusScan ? { radiusScan } : {}),
      continuationSeq,
      recentAuthorIds,
      lastAuthorId,
      recycleMode
    },
    onRepaired
  );
}

function upgradeV2Cursor(payload: string): ForYouSimpleCursorV3 {
  const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  const mode = raw.mode;
  if (mode !== "randomKey" && mode !== "docId") throw new Error("mode");
  const seen = normalizeCursorSeenIds(
    Array.isArray(raw.seen) ? raw.seen.map((value) => String(value)).filter(Boolean) : []
  );
  const filter = normalizeFilter(raw.filter);
  const reelRaw = (raw.reel as Record<string, unknown> | undefined) ?? {};
  const fallbackRaw = (raw.fallback as Record<string, unknown> | undefined) ?? {};
  const reelState = normalizePhaseState(mode, reelRaw);
  const fallbackState = normalizePhaseState(mode, fallbackRaw);
  return {
    v: 3,
    mode,
    activePhase: "reel_tier_5",
    phases: {
      reel_tier_5: reelState,
      reel_tier_4: createPhaseCursorState(mode),
      reel_other: reelState,
      fallback_normal: fallbackState
    },
    seen,
    ...(filter ? { filter } : {}),
    continuationSeq: seen.length > 0 ? 1 : 0,
    recentAuthorIds: [],
    lastAuthorId: null,
    recycleMode: false
  };
}

function normalizeServingMode(raw: unknown, filter?: ForYouRadiusFilter): ForYouSimpleServingMode {
  if (raw === "home_reel_first" || raw === "radius_all_posts" || raw === "following_all_posts") {
    return raw;
  }
  return resolveForYouSimpleServingMode({
    radiusFilter: filter ?? { mode: "global", centerLat: null, centerLng: null, radiusMiles: null },
    followingMode: false
  });
}

function normalizeRadiusScan(raw: unknown): ForYouSimpleRadiusScanState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const scan = raw as Record<string, unknown>;
  const lastTimeMs =
    typeof scan.lastTimeMs === "number" && Number.isFinite(scan.lastTimeMs) ? scan.lastTimeMs : null;
  const lastPostId = typeof scan.lastPostId === "string" && scan.lastPostId.trim() ? scan.lastPostId.trim() : null;
  const legacyExhausted = scan.exhausted === true;
  const phase = scan.phase === "geo" || scan.phase === "recent" ? scan.phase : null;
  if (!phase) {
    return repairRadiusScanState({
      lastTimeMs,
      lastPostId,
      exhausted: legacyExhausted
    });
  }
  const geoRaw = scan.geoCursor as Record<string, unknown> | null | undefined;
  const geoCursor =
    geoRaw &&
    typeof geoRaw.lastGeohash === "string" &&
    geoRaw.lastGeohash.trim() &&
    typeof geoRaw.lastTimeMs === "number" &&
    Number.isFinite(geoRaw.lastTimeMs) &&
    typeof geoRaw.lastPostId === "string" &&
    geoRaw.lastPostId.trim()
      ? {
          lastGeohash: geoRaw.lastGeohash.trim(),
          lastTimeMs: geoRaw.lastTimeMs,
          lastPostId: geoRaw.lastPostId.trim()
        }
      : null;
  const prefixIdx =
    typeof scan.prefixIdx === "number" && Number.isFinite(scan.prefixIdx) ? Math.max(0, Math.floor(scan.prefixIdx)) : 0;
  const geoFinished = scan.geoFinished === true;
  const recentFinished = scan.recentFinished === true;
  return repairRadiusScanState({
    phase,
    prefixIdx,
    geoCursor,
    lastTimeMs,
    lastPostId,
    geoFinished,
    recentFinished,
    exhausted: legacyExhausted
  });
}

function normalizeFilter(raw: unknown): ForYouRadiusFilter | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const filterRaw = raw as Record<string, unknown>;
  const m = filterRaw.mode;
  if (m !== "global" && m !== "nearMe" && m !== "custom") return undefined;
  if (m === "global") return { mode: "global", centerLat: null, centerLng: null, radiusMiles: null };
  const lat = typeof filterRaw.centerLat === "number" && Number.isFinite(filterRaw.centerLat) ? filterRaw.centerLat : null;
  const lng = typeof filterRaw.centerLng === "number" && Number.isFinite(filterRaw.centerLng) ? filterRaw.centerLng : null;
  const miles =
    typeof filterRaw.radiusMiles === "number" && Number.isFinite(filterRaw.radiusMiles) ? filterRaw.radiusMiles : null;
  return { mode: m, centerLat: lat, centerLng: lng, radiusMiles: miles };
}

function normalizePhaseState(mode: SimpleFeedSortMode, raw: Record<string, unknown>): ForYouSimplePhaseCursorState {
  if (mode === "randomKey") {
    const anchor = typeof raw.anchor === "number" ? raw.anchor : Number(raw.anchor);
    if (!Number.isFinite(anchor)) throw new Error("anchor");
    const lastValue =
      typeof raw.lastValue === "number" && Number.isFinite(raw.lastValue)
        ? raw.lastValue
        : raw.lastValue == null
          ? null
          : Number(raw.lastValue);
    const lastPostId = typeof raw.lastPostId === "string" && raw.lastPostId.trim() ? raw.lastPostId.trim() : null;
    return {
      anchor,
      wrapped: raw.wrapped === true,
      lastValue: lastValue != null && Number.isFinite(lastValue) ? lastValue : null,
      lastPostId,
      exhausted: raw.exhausted === true
    };
  }
  const anchor = typeof raw.anchor === "string" ? raw.anchor.trim() : "";
  if (!anchor) throw new Error("anchor");
  const lastValue = typeof raw.lastValue === "string" && raw.lastValue.trim() ? raw.lastValue.trim() : null;
  const lastPostId = typeof raw.lastPostId === "string" && raw.lastPostId.trim() ? raw.lastPostId.trim() : null;
  return {
    anchor,
    wrapped: raw.wrapped === true,
    lastValue,
    lastPostId,
    exhausted: raw.exhausted === true
  };
}
