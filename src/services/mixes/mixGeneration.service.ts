import type { MixDefinition } from "./mixRegistry.service.js";
import { getPostId } from "../../lib/posts/postFieldSelectors.js";
import { PostDiscoveryRepository, type MixPostCandidate } from "../../repositories/postDiscovery.repository.js";
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

    let ranked = this.ranking.rank({
      mix: input.mix,
      candidates: candidates as any,
      viewerCoords: input.viewerCoords,
      includeDebug: Boolean(input.includeDebug),
    });

    const minRanked = Math.min(8, Math.max(4, input.limit));
    if (ranked.length < minRanked && (input.mix.activityFilters?.length ?? 0) > 0) {
      const relaxed = this.ranking.rank({
        mix: { ...input.mix, activityFilters: [] },
        candidates: candidates as any,
        viewerCoords: input.viewerCoords,
        includeDebug: Boolean(input.includeDebug),
      });
      const seen = new Set(ranked.map((r) => getPostId(r.post as Record<string, unknown>)));
      for (const row of relaxed) {
        const pid = getPostId(row.post as Record<string, unknown>);
        if (!pid || seen.has(pid)) continue;
        ranked.push(row);
        seen.add(pid);
        if (ranked.length >= input.poolLimit) break;
      }
    }

    if (ranked.length < minRanked && input.mix.seed.kind !== "friends") {
      const broader = await this.postsRepo.searchPostsForSeed({
        seedQuery: "near me",
        lat: input.viewerCoords?.lat ?? null,
        lng: input.viewerCoords?.lng ?? null,
        limit: Math.min(240, input.poolLimit * 2)
      });
      const byId = new Map<string, MixPostCandidate>();
      for (const row of candidates as MixPostCandidate[]) {
        const id = getPostId(row as Record<string, unknown>);
        if (id) byId.set(id, row as MixPostCandidate);
      }
      for (const row of broader as MixPostCandidate[]) {
        const id = getPostId(row as Record<string, unknown>);
        if (id && !byId.has(id)) byId.set(id, row as MixPostCandidate);
      }
      const merged = [...byId.values()];
      ranked = this.ranking.rank({
        mix: { ...input.mix, activityFilters: input.mix.activityFilters?.length ? input.mix.activityFilters : [] },
        candidates: merged as any,
        viewerCoords: input.viewerCoords,
        includeDebug: Boolean(input.includeDebug),
      });
      if (ranked.length < minRanked && (input.mix.activityFilters?.length ?? 0) > 0) {
        const relaxed2 = this.ranking.rank({
          mix: { ...input.mix, activityFilters: [] },
          candidates: merged as any,
          viewerCoords: input.viewerCoords,
          includeDebug: Boolean(input.includeDebug),
        });
        const seen2 = new Set(ranked.map((r) => getPostId(r.post as Record<string, unknown>)));
        for (const row of relaxed2) {
          const pid = getPostId(row.post as Record<string, unknown>);
          if (!pid || seen2.has(pid)) continue;
          ranked.push(row);
          seen2.add(pid);
          if (ranked.length >= input.poolLimit) break;
        }
      }
    }

    // The caller paginates over the ranked pool; do not truncate to a single page here.
    return { ranked: ranked.slice(0, Math.max(1, input.poolLimit)), candidateCount: candidates.length };
  }
}

