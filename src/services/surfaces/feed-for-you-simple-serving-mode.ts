import type { ForYouRadiusFilter } from "./feed-for-you-simple-cursor.js";
import { FOR_YOU_SIMPLE_DECK_FORMAT } from "./feed-for-you-simple-phase-runtime.js";

export type ForYouSimpleServingMode = "home_reel_first" | "radius_all_posts" | "following_all_posts";

export function isActiveRadiusFilter(filter: ForYouRadiusFilter): boolean {
  return (
    filter.mode !== "global" &&
    typeof filter.centerLat === "number" &&
    Number.isFinite(filter.centerLat) &&
    typeof filter.centerLng === "number" &&
    Number.isFinite(filter.centerLng) &&
    typeof filter.radiusMiles === "number" &&
    Number.isFinite(filter.radiusMiles) &&
    filter.radiusMiles > 0
  );
}

export function resolveForYouSimpleServingMode(input: {
  radiusFilter: ForYouRadiusFilter;
  followingMode?: boolean;
}): ForYouSimpleServingMode {
  if (input.followingMode === true) return "following_all_posts";
  if (isActiveRadiusFilter(input.radiusFilter)) return "radius_all_posts";
  return "home_reel_first";
}

export function deckKeyForServingMode(
  durableViewerId: string,
  servingMode: ForYouSimpleServingMode,
  filter: ForYouRadiusFilter
): string {
  const viewerKey = durableViewerId || "anon";
  if (servingMode === "radius_all_posts" && isActiveRadiusFilter(filter)) {
    const roundLat = (filter.centerLat as number).toFixed(2);
    const roundLng = (filter.centerLng as number).toFixed(2);
    const miles = Math.round(filter.radiusMiles as number);
    return `for_you_simple:radius_all_posts:v${FOR_YOU_SIMPLE_DECK_FORMAT}:${viewerKey}:${filter.mode}:${miles}mi:${roundLat}_${roundLng}`;
  }
  if (servingMode === "following_all_posts") {
    return `for_you_simple:following_all_posts:v${FOR_YOU_SIMPLE_DECK_FORMAT}:${viewerKey}`;
  }
  return `for_you_simple:home_reel_first:v${FOR_YOU_SIMPLE_DECK_FORMAT}:${viewerKey}`;
}
