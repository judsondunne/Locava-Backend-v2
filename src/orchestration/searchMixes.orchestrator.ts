import { mixCache } from "../cache/mixCache.js";
import { MixRegistryService, type MixDefinition } from "../services/mixes/mixRegistry.service.js";
import { MixGenerationService } from "../services/mixes/mixGeneration.service.js";
import { encodeMixCursor, decodeMixCursor } from "../services/mixes/mixPagination.service.js";
import { buildMixDiagnostics } from "../diagnostics/mixDiagnostics.js";
import { buildStateRegionId } from "../lib/search-query-intent.js";

export class SearchMixesOrchestrator {
  private readonly registry = new MixRegistryService();
  private readonly generation = new MixGenerationService();

  async bootstrap(input: {
    viewerId: string;
    lat: number | null;
    lng: number | null;
    limit: number;
    includeDebug: boolean;
  }): Promise<{
    routeName: "search.mixes.bootstrap.get";
    mixes: Array<Record<string, unknown>>;
    scoringVersion: string;
  }> {
    const scoringVersion = "mixes_v1";
    const cacheKey = `v2_search_mixes_bootstrap:${input.viewerId}:${input.lat ?? "_"}:${input.lng ?? "_"}:${input.limit}`;
    const cached = mixCache.get<{ mixes: Array<Record<string, unknown>>; scoringVersion: string }>(cacheKey);
    if (cached) {
      return { routeName: "search.mixes.bootstrap.get", mixes: cached.mixes, scoringVersion: cached.scoringVersion };
    }

    const viewerCoords =
      input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const defs = this.registry.buildBootstrapMixes().slice(0, Math.max(1, Math.min(24, input.limit)));

    const mixes = await Promise.all(defs.map((mix) => this.materializeMixRow(mix, viewerCoords, scoringVersion, input.includeDebug)));
    mixCache.set(cacheKey, { mixes, scoringVersion }, 20_000);
    return { routeName: "search.mixes.bootstrap.get", mixes, scoringVersion };
  }

  async feedPage(input: {
    viewerId: string;
    mixId: string;
    lat: number | null;
    lng: number | null;
    limit: number;
    cursor: string | null;
    cursorOffsetOverride?: number;
    includeDebug: boolean;
  }): Promise<{
    routeName: "search.mixes.feed.post";
    mixId: string;
    posts: Array<Record<string, unknown>>;
    nextCursor: string | null;
    hasMore: boolean;
    scoringVersion: string;
    debug?: Record<string, unknown>;
  }> {
    const scoringVersion = "mixes_v1";
    const viewerCoords =
      input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;

    const def = this.resolveMixDefinition(input.mixId);
    const cursorOffset =
      Number.isFinite(input.cursorOffsetOverride) && (input.cursorOffsetOverride ?? 0) >= 0
        ? Math.floor(input.cursorOffsetOverride ?? 0)
        : input.cursor
          ? decodeMixCursor(input.cursor).offset
          : 0;

    // Pool is slightly larger than a single page so we can paginate without changing ordering.
    // For now this is still “offset paging over a ranked pool” (v1-style) but the pool is generated per request.
    const poolLimit = Math.min(900, Math.max(120, cursorOffset + input.limit + 48));
    const bucketKey = viewerCoords ? `${Math.round(viewerCoords.lat * 10) / 10}_${Math.round(viewerCoords.lng * 10) / 10}` : "geo_unknown";
    const dayKey = new Date().toISOString().slice(0, 10);
    const cacheKey =
      def.type === "daily"
        ? `mix_daily_pool:${input.viewerId}:${bucketKey}:${dayKey}:${poolLimit}`
        : null;

    const rankedPage = cacheKey
      ? await mixCache.dedupe(cacheKey, async () => {
          const page = await this.generation.generateRankedPage({
            mix: def,
            viewerCoords,
            viewerId: input.viewerId,
            limit: Math.min(poolLimit, cursorOffset + input.limit + 1),
            poolLimit,
            includeDebug: input.includeDebug,
          });
          mixCache.set(cacheKey, page, 6 * 60 * 60_000);
          return page;
        })
      : await this.generation.generateRankedPage({
          mix: def,
          viewerCoords,
          viewerId: input.viewerId,
          limit: Math.min(poolLimit, cursorOffset + input.limit + 1),
          poolLimit,
          includeDebug: input.includeDebug,
        });

    const slice = rankedPage.ranked.slice(cursorOffset, cursorOffset + input.limit + 1);
    const hasMore = slice.length > input.limit;
    const rows = slice.slice(0, input.limit).map((row) => row.post as unknown as Record<string, unknown>);
    const nextCursor = hasMore
      ? encodeMixCursor({ v: 1, mixId: input.mixId, offset: cursorOffset + input.limit, scoringVersion })
      : null;

    return {
      routeName: "search.mixes.feed.post",
      mixId: input.mixId,
      posts: rows,
      nextCursor,
      hasMore,
      scoringVersion,
      ...(input.includeDebug
        ? {
            debug: {
              ...buildMixDiagnostics({
                mixId: input.mixId,
                scoringVersion,
                candidateCount: rankedPage.candidateCount,
              }),
              items: slice
                .slice(0, input.limit)
                .map((row) => ({
                  postId: String((row.post as any)?.id ?? (row.post as any)?.postId ?? ""),
                  distanceMiles: row.distanceMiles,
                  matchedActivities: row.matchedActivities,
                  authorSource: (row.post as any)?._debugAuthorSource,
                  activityScore: row.debug?.activityScore,
                  proximityScore: row.debug?.proximityScore,
                  qualityScore: row.debug?.qualityScore,
                  recencyScore: row.debug?.recencyScore,
                  finalScore: row.debug?.finalScore,
                })),
            },
          }
        : {}),
    };
  }

  private resolveMixDefinition(mixId: string): MixDefinition {
    const defs = this.registry.buildBootstrapMixes();
    const hit = defs.find((d) => d.id === mixId);
    if (hit) return hit;
    if (mixId.startsWith("location_activity_state:")) {
      const parts = mixId.split(":");
      const stateRegionId = String(parts[1] ?? "").trim();
      const activity = String(parts[2] ?? "").trim().toLowerCase();
      const title = activity && stateRegionId ? `${activity} in ${stateRegionId}` : activity;
      return {
        id: mixId,
        type: "location_activity",
        title: title.charAt(0).toUpperCase() + title.slice(1),
        subtitle: stateRegionId ? `Top ${activity} posts in ${stateRegionId}` : `Top ${activity} posts`,
        seed: { kind: "activity_query", query: activity ? `${activity} in ${stateRegionId}` : `${activity}` },
        activityFilters: activity ? [activity] : undefined,
        locationLabel: stateRegionId || undefined,
        locationConstraint: stateRegionId ? { stateRegionId } : undefined,
      };
    }
    if (mixId.startsWith("location_activity_city:")) {
      const parts = mixId.split(":");
      const cityRegionId = String(parts[1] ?? "").trim();
      const activity = String(parts[2] ?? "").trim().toLowerCase();
      const title = activity && cityRegionId ? `${activity} in ${cityRegionId}` : activity;
      return {
        id: mixId,
        type: "location_activity",
        title: title.charAt(0).toUpperCase() + title.slice(1),
        subtitle: cityRegionId ? `Top ${activity} posts in ${cityRegionId}` : `Top ${activity} posts`,
        seed: { kind: "activity_query", query: activity ? `${activity} in ${cityRegionId}` : `${activity}` },
        activityFilters: activity ? [activity] : undefined,
        locationLabel: cityRegionId || undefined,
        locationConstraint: cityRegionId ? { cityRegionId } : undefined,
      };
    }
    if (mixId.startsWith("location_activity:")) {
      const parts = mixId.split(":");
      const stateName = String(parts[1] ?? "").trim();
      const activity = String(parts[2] ?? "").trim().toLowerCase();
      const stateRegionId = stateName ? buildStateRegionId("US", stateName) : "";
      const title = stateName ? `${activity} in ${stateName}` : activity;
      return {
        id: mixId,
        type: "location_activity",
        title: title.charAt(0).toUpperCase() + title.slice(1),
        subtitle: stateName ? `Top ${activity} posts in ${stateName}` : `Top ${activity} posts`,
        seed: { kind: "activity_query", query: stateName ? `${activity} in ${stateName}` : `${activity}` },
        activityFilters: [activity],
        locationLabel: stateName || undefined,
        locationConstraint: stateRegionId ? { stateRegionId } : undefined,
      };
    }
    if (mixId.startsWith("location_general:")) {
      const parts = mixId.split(":");
      const stateName = String(parts[1] ?? "").trim();
      const stateRegionId = stateName ? buildStateRegionId("US", stateName) : "";
      return {
        id: mixId,
        type: "location_general",
        title: stateName ? `Spots in ${stateName}` : "Spots",
        subtitle: stateName ? `Great spots in ${stateName}` : "Great spots",
        seed: { kind: "activity_query", query: stateName ? `spots in ${stateName}` : "spots" },
        locationLabel: stateName || undefined,
        locationConstraint: stateRegionId ? { stateRegionId } : undefined,
      };
    }
    // Fallback: treat unknown ids as activity mix ids.
    const activity = mixId.includes(":") ? mixId.split(":").slice(1).join(":") : mixId;
    return {
      id: mixId,
      type: "activity",
      title: activity,
      subtitle: `Top ${activity} posts`,
      seed: { kind: "activity_query", query: `${activity} near me` },
      activityFilters: [activity],
      locationLabel: "Near you",
    };
  }

  private async materializeMixRow(
    mix: MixDefinition,
    viewerCoords: { lat: number; lng: number } | null,
    scoringVersion: string,
    includeDebug: boolean,
  ): Promise<Record<string, unknown>> {
    const page = await this.generation.generateRankedPage({
      mix,
      viewerCoords,
      viewerId: undefined,
      limit: 24,
      poolLimit: 84,
    });

    const cover = page.ranked.slice(0, 4).map((row) => row.post);
    const coverPostIds = cover.map((p) => p.postId).filter(Boolean);
    const coverMediaUrls = cover
      .map((p) => String(p.thumbUrl ?? p.displayPhotoLink ?? ""))
      .filter((u) => /^https?:\/\//i.test(u));

    const hasCoverArt = coverMediaUrls.length > 0;
    const enoughPosts = page.ranked.length >= 8;

    return {
      id: mix.id,
      type: mix.type,
      title: mix.title,
      subtitle: mix.subtitle,
      coverPostIds,
      coverMediaUrls,
      primaryActivity: mix.activityFilters?.[0],
      activityFilters: mix.activityFilters,
      locationLabel: mix.locationLabel,
      center: viewerCoords ?? undefined,
      radiusMiles: undefined,
      resultCount: page.ranked.length,
      nextCursor: null,
      quality: {
        hasCoverArt,
        enoughPosts,
        locationTruthScore: viewerCoords ? 0.7 : 0.3,
        activityTruthScore: mix.activityFilters?.length ? 1 : 0.5,
      },
      ...(includeDebug
        ? {
            debug: {
              generationSource: "mixes_v1_orchestrator",
              scoringVersion,
            },
          }
        : {}),
    };
  }
}

