import type { CollectedReelInput } from "../../../contracts/surfaces/undiscovered-reels.contract.js";

/**
 * Reel quality scoring + filtering.
 *
 * Hashtag pages return everything tagged to a place — including ads, real-estate
 * promos, and tangential content that merely name-drops the spot. This module
 * scores reels by real Instagram engagement (views dominate, weighted by
 * like/comment rate), drops obvious promotional posts, and keeps the best N per
 * spot so the map surfaces authentic, popular footage first.
 */

/** Promotional / business markers — conservative so genuine creators aren't dropped. */
const PROMO_PATTERNS: RegExp[] = [
  /real\s?estate|realty|realtor\b/i,
  /coldwell|century ?21|keller williams|re\/?max|sotheby/i,
  /\bfor sale\b|\blisting\b|\bmls\b|open house/i,
  /vacation rental|\bairbnb\b|book (now|your stay|direct)|reserve your/i,
  /link in bio to (book|buy|shop|order)/i,
  /promo code|% ?off|\bdiscount\b|shop now|swipe up to (buy|shop)/i,
  /\bwe buy\b|\bwe sell\b|call (us|today|now)|dm to (book|order)/i,
];

/** True when the reel looks like an ad or business promo rather than discovery content. */
export function isLikelyPromo(reel: CollectedReelInput): boolean {
  const hay = `${reel.ownerUsername ?? ""} ${reel.ownerFullName ?? ""} ${reel.caption ?? ""}`;
  return PROMO_PATTERNS.some((re) => re.test(hay));
}

/**
 * Quality score, roughly 0–130. Views are log-scaled (so a 100k-view reel beats
 * a 1k-view reel but doesn't swamp everything), plus an engagement-rate bonus
 * that rewards reels people actually like/comment on relative to their reach.
 */
export function scoreReelQuality(reel: CollectedReelInput): number {
  const views = Math.max(0, reel.playCount ?? 0);
  const likes = Math.max(0, reel.likeCount ?? 0);
  const comments = Math.max(0, reel.commentCount ?? 0);
  const viewScore = views > 0 ? Math.log10(views + 1) * 20 : 0;
  const engagementRate = views > 0 ? (likes + comments * 2) / views : 0;
  const rateScore = Math.min(30, engagementRate * 300);
  return Math.round(viewScore + rateScore);
}

export type ReelQualityOptions = {
  /** Drop reels with a known view count below this. Reels with unknown views are kept. */
  minViews?: number;
  /** Keep at most this many reels (highest quality first). */
  topN?: number;
  /** Drop reels that look like ads/promos (default true). */
  dropPromos?: boolean;
};

/** Filter out promos and low-reach reels, then keep the top-N by quality score. */
export function filterAndRankReels(reels: CollectedReelInput[], opts: ReelQualityOptions = {}): CollectedReelInput[] {
  const { minViews = 0, topN = Infinity, dropPromos = true } = opts;
  return reels
    .filter((r) => r.playCount == null || r.playCount >= minViews) // only drop when views are known and low
    .filter((r) => !(dropPromos && isLikelyPromo(r)))
    .map((r) => ({ r, score: scoreReelQuality(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN === Infinity ? undefined : topN)
    .map((x) => x.r);
}
