/**
 * Pure ranking math for post search — no Firestore/IO imports, so it is unit-testable in isolation.
 * Consumed by `search-results-firestore.adapter.ts` (both the lexical `scoreCandidate` path and the
 * hybrid `blendedSemanticScore` path).
 */
import { type SearchActivityIntent, extractResidualTokens, normalizeSearchText } from "../../lib/search-query-intent.js";
import type { SearchablePost } from "./search-results-firestore.adapter.js";

/**
 * Great-circle distance in miles (haversine). Replaces the prior Euclidean `sqrt(dlat²+dlng²)*69`
 * approximation, which ignored longitude convergence and overstated east–west distance ~30% at US
 * latitudes — distorting the near-me radius tiers and geo decay.
 */
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
  return meters / 1609.34;
}

/**
 * Smooth distance falloff in [0,1] for hybrid ranking: 1.0 at the viewer, ~0.5 at ~25mi, decaying
 * gently thereafter. Unlike the legacy hard radius cutoffs, nearby wins but distant-but-relevant
 * results still surface (rural queries never go empty).
 */
export function geoDecay(miles: number): number {
  if (!Number.isFinite(miles) || miles < 0) return 0;
  const HALF_LIFE_MILES = 25;
  return 1 / (1 + miles / HALF_LIFE_MILES);
}

export function activityMatchScore(post: SearchablePost, activity: SearchActivityIntent | null): number {
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

export function textMatchScore(post: SearchablePost, query: string): number {
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

/**
 * Blended hybrid score (higher = better) combining semantic similarity, lexical overlap, an activity
 * prior, geo decay, and a light quality/recency term. Weights are exposed so they can be tuned per
 * `rankingVersion`. Geo contributes only when the viewer location is known (never penalizes).
 */
export const SEMANTIC_WEIGHTS = { semantic: 0.55, lexical: 0.2, activity: 0.12, geo: 0.1, quality: 0.03 } as const;

export function blendedSemanticScore(
  post: SearchablePost,
  ctx: {
    query: string;
    activity: SearchActivityIntent | null;
    semanticDistance: number | undefined;
    viewerCoords: { lat: number; lng: number } | null;
  }
): number {
  // Cosine distance ∈ [0,2]; similarity = 1 - distance, clamped to [0,1]. Unknown (non-ANN) → 0.
  const semanticSim =
    ctx.semanticDistance != null && Number.isFinite(ctx.semanticDistance)
      ? Math.max(0, Math.min(1, 1 - ctx.semanticDistance))
      : 0;
  const lexical = Math.max(0, Math.min(1, textMatchScore(post, ctx.query) / 26));
  const activityPrior = ctx.activity && activityMatchScore(post, ctx.activity) > 0 ? 1 : 0;
  const geo =
    ctx.viewerCoords && post.lat != null && post.lng != null
      ? geoDecay(distanceMiles(ctx.viewerCoords, { lat: post.lat, lng: post.lng }))
      : 0;
  const quality = Math.max(0, Math.min(1, post.likeCount / 50));
  return (
    SEMANTIC_WEIGHTS.semantic * semanticSim +
    SEMANTIC_WEIGHTS.lexical * lexical +
    SEMANTIC_WEIGHTS.activity * activityPrior +
    SEMANTIC_WEIGHTS.geo * geo +
    SEMANTIC_WEIGHTS.quality * quality
  );
}
