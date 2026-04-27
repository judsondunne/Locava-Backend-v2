import type { MixDefinition } from "./mixRegistry.service.js";
import type { MixPostCandidate } from "../../repositories/postDiscovery.repository.js";

function tokenizeActivity(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export type RankedMixPost = {
  post: MixPostCandidate;
  distanceMiles: number | null;
  matchedActivities: string[];
  debug?: {
    activityScore: number;
    proximityScore: number;
    qualityScore: number;
    recencyScore: number;
    finalScore: number;
  };
};

function approxDistanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy) * 69;
}

export class MixRankingService {
  rank(input: {
    mix: MixDefinition;
    candidates: MixPostCandidate[];
    viewerCoords: { lat: number; lng: number } | null;
    includeDebug?: boolean;
  }): RankedMixPost[] {
    const required = (input.mix.activityFilters ?? []).map(tokenizeActivity).filter(Boolean);
    const ranked: Array<{ row: RankedMixPost; score: number }> = [];
    const distancePrimary =
      input.mix.type === "activity" ||
      input.mix.type === "nearby" ||
      input.mix.type === "location_activity";

    for (const post of input.candidates) {
      const postActivities = (post.activities ?? []).map(tokenizeActivity).filter(Boolean);
      const matchedActivities = required.length
        ? required.filter((req) => postActivities.includes(req))
        : [];
      if (required.length > 0 && matchedActivities.length === 0) continue;

      if (input.mix.locationConstraint?.cityRegionId) {
        if (post.cityRegionId !== input.mix.locationConstraint.cityRegionId) continue;
      }
      if (input.mix.locationConstraint?.stateRegionId) {
        if (post.stateRegionId !== input.mix.locationConstraint.stateRegionId) continue;
      }

      let score = 0;
      const activityScore = matchedActivities.length > 0 ? 1 : 0;
      const qualityScore = Math.min(1, ((post.likeCount ?? 0) / 24 + (post.commentCount ?? 0) / 12));

      let distanceMiles: number | null = null;
      let proximityScore = 0;
      if (input.viewerCoords && post.lat != null && post.lng != null) {
        distanceMiles = approxDistanceMiles(input.viewerCoords, { lat: post.lat, lng: post.lng });
        // Primary signal for generic mixes: closeness dominates.
        // 0 miles => 1.0, 6 miles => ~0.5, 24 miles => ~0.2, 60 miles => ~0.09
        proximityScore = 1 / (1 + Math.max(0, distanceMiles) / 6);
      }

      if (
        input.mix.locationConstraint?.center &&
        input.mix.locationConstraint.maxDistanceMiles != null &&
        post.lat != null &&
        post.lng != null
      ) {
        const miles = approxDistanceMiles(input.mix.locationConstraint.center, { lat: post.lat, lng: post.lng });
        if (miles > input.mix.locationConstraint.maxDistanceMiles) continue;
      }

      // Final score is still used as a tie-break, but distance ordering is enforced separately
      // for generic nearby/activity mixes.
      const recencyMs = Number(post.updatedAtMs ?? post.createdAtMs ?? post.time ?? 0) || 0;
      const recencyScore = recencyMs > 0 ? Math.min(1, (Date.now() - recencyMs) / (14 * 24 * 60 * 60_000)) : 1;
      score =
        activityScore * 5 +
        proximityScore * 100 +
        qualityScore * 8 +
        (1 - recencyScore) * 6;

      ranked.push({
        row: {
          post,
          distanceMiles,
          matchedActivities,
          ...(input.includeDebug
            ? {
                debug: {
                  activityScore,
                  proximityScore,
                  qualityScore,
                  recencyScore,
                  finalScore: score,
                },
              }
            : {}),
        },
        score,
      });
    }

    ranked.sort((a, b) => {
      if (distancePrimary) {
        const da = a.row.distanceMiles ?? Number.POSITIVE_INFINITY;
        const db = b.row.distanceMiles ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return b.score - a.score || (b.row.post.updatedAtMs ?? 0) - (a.row.post.updatedAtMs ?? 0);
    });
    return ranked.map((r) => r.row);
  }
}

