import type { SimpleFeedSortMode } from "../../repositories/surfaces/feed-for-you-simple.repository.js";

export const FOR_YOU_V5_CURSOR_PREFIX = "fys:v5:";
export const FOR_YOU_V5_SESSION_SEEN_CAP = 450;

export type ForYouV5PhaseKey = "reel_tier_5" | "reel_tier_4" | "reel_other" | "regular";

export type ForYouV5CursorPayload = {
  v: 5;
  viewerKey: string;
  viewerKeyHash: string;
  deckVersion: number;
  phaseOffsets: Record<ForYouV5PhaseKey, number>;
  sessionSeenPostIds: string[];
  /** Snapshot of durable reel seen IDs (bounded); avoids per-page `feedState` reads. */
  durableReelCapsule?: string[];
  /** Snapshot of durable regular seen IDs (bounded). */
  durableRegularCapsule?: string[];
  recentAuthorIds: string[];
  lastAuthorId: string | null;
  issuedAtMs: number;
  randomMode: SimpleFeedSortMode;
  regularAnchor: number | string;
};

export function shortViewerKeyHash(viewerKey: string): string {
  let h = 0;
  for (let i = 0; i < viewerKey.length; i += 1) {
    h = (h * 31 + viewerKey.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(36)}`;
}

export function encodeForYouV5Cursor(c: ForYouV5CursorPayload): string {
  const normalized: ForYouV5CursorPayload = {
    ...c,
    sessionSeenPostIds: [...new Set(c.sessionSeenPostIds.map((x) => String(x).trim()).filter(Boolean))].slice(
      -FOR_YOU_V5_SESSION_SEEN_CAP
    ),
    recentAuthorIds: [...new Set(c.recentAuthorIds.filter(Boolean))].slice(-20),
  };
  return `${FOR_YOU_V5_CURSOR_PREFIX}${Buffer.from(JSON.stringify(normalized), "utf8").toString("base64url")}`;
}

export function decodeForYouV5Cursor(raw: string | null | undefined): ForYouV5CursorPayload | null {
  if (!raw || typeof raw !== "string" || !raw.startsWith(FOR_YOU_V5_CURSOR_PREFIX)) return null;
  try {
    const json = Buffer.from(raw.slice(FOR_YOU_V5_CURSOR_PREFIX.length), "base64url").toString("utf8");
    const p = JSON.parse(json) as ForYouV5CursorPayload;
    if (p?.v !== 5 || typeof p.viewerKey !== "string") return null;
    if (!p.phaseOffsets || typeof p.phaseOffsets !== "object") return null;
    return p;
  } catch {
    return null;
  }
}

export function createFreshForYouV5Cursor(input: {
  viewerKey: string;
  deckVersion: number;
  randomMode: SimpleFeedSortMode;
  regularAnchor: number | string;
  durableReelCapsule?: string[];
  durableRegularCapsule?: string[];
}): ForYouV5CursorPayload {
  return {
    v: 5,
    viewerKey: input.viewerKey,
    viewerKeyHash: shortViewerKeyHash(input.viewerKey),
    deckVersion: input.deckVersion,
    phaseOffsets: { reel_tier_5: 0, reel_tier_4: 0, reel_other: 0, regular: 0 },
    sessionSeenPostIds: [],
    durableReelCapsule: input.durableReelCapsule,
    durableRegularCapsule: input.durableRegularCapsule,
    recentAuthorIds: [],
    lastAuthorId: null,
    issuedAtMs: Date.now(),
    randomMode: input.randomMode,
    regularAnchor: input.regularAnchor,
  };
}
