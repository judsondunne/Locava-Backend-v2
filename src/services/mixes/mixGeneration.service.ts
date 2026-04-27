import type { MixDefinition } from "./mixRegistry.service.js";
import { PostDiscoveryRepository } from "../../repositories/postDiscovery.repository.js";
import { MixRankingService, type RankedMixPost } from "./mixRanking.service.js";
import { MixesRepository } from "../../repositories/mixes.repository.js";

export type GeneratedMixPage = {
  ranked: RankedMixPost[];
  candidateCount: number;
};

export class MixGenerationService {
  private readonly postsRepo = new PostDiscoveryRepository();
  private readonly ranking = new MixRankingService();
  private readonly mixesRepo = new MixesRepository();

  async generateRankedPage(input: {
    mix: MixDefinition;
    viewerCoords: { lat: number; lng: number } | null;
    viewerId?: string;
    limit: number;
    poolLimit: number;
    includeDebug?: boolean;
  }): Promise<GeneratedMixPage> {
    let candidates = [];
    if (input.mix.seed.kind === "friends" && input.viewerId) {
      const following = await this.mixesRepo.loadViewerFollowingUserIds(input.viewerId, 90);
      const recent = await this.mixesRepo.loadRecentPostsByUserIds({ userIds: following, limit: input.poolLimit });
      candidates = recent.map((row) => ({ ...(row as any), _debugAuthorSource: "following" })) as any[];
    } else if (input.mix.seed.kind === "daily" && input.viewerId) {
      const profile = await this.mixesRepo.loadViewerActivityProfile(input.viewerId);
      const preferred = profile.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean).slice(0, 3);
      const query = preferred.length > 0 ? `${preferred.join(" ")} near me` : "near me";
      candidates = await this.postsRepo.searchPostsForSeed({
        seedQuery: query,
        lat: input.viewerCoords?.lat ?? null,
        lng: input.viewerCoords?.lng ?? null,
        limit: input.poolLimit,
      });

      // Hard-filter to preferred activities if we have them, but allow a “thin profile” fallback
      // to nearby posts (no fake data).
      const mixWithFilters: MixDefinition =
        preferred.length > 0 ? { ...input.mix, activityFilters: preferred } : input.mix;
      const rankedStrict = this.ranking.rank({
        mix: mixWithFilters,
        candidates: candidates as any,
        viewerCoords: input.viewerCoords,
        includeDebug: Boolean(input.includeDebug),
      });
      const rankedRelaxed =
        preferred.length > 0 && rankedStrict.length === 0
          ? this.ranking.rank({
              mix: input.mix,
              candidates: candidates as any,
              viewerCoords: input.viewerCoords,
              includeDebug: Boolean(input.includeDebug),
            })
          : rankedStrict;
      return {
        ranked: rankedRelaxed.slice(0, Math.max(1, input.poolLimit)),
        candidateCount: candidates.length,
      };
    } else {
      const seedQuery = String(input.mix.seed.query ?? "").trim();
      candidates = await this.postsRepo.searchPostsForSeed({
        seedQuery: seedQuery || "near me",
        lat: input.viewerCoords?.lat ?? null,
        lng: input.viewerCoords?.lng ?? null,
        limit: input.poolLimit,
      });
    }

    const ranked = this.ranking.rank({
      mix: input.mix,
      candidates: candidates as any,
      viewerCoords: input.viewerCoords,
      includeDebug: Boolean(input.includeDebug),
    });

    // The caller paginates over the ranked pool; do not truncate to a single page here.
    return { ranked: ranked.slice(0, Math.max(1, input.poolLimit)), candidateCount: candidates.length };
  }
}

