import { mixCache } from "../cache/mixCache.js";
import { SearchMixesServiceV2 } from "../services/mixes/v2/searchMixes.service.js";
import { buildPostEnvelope } from "../lib/posts/post-envelope.js";

export class SearchMixesOrchestrator {
  private readonly v2 = new SearchMixesServiceV2();

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
    const scoringVersion = "mixes_v2";
    const cacheKey = `v2_search_mixes_bootstrap:${input.viewerId}:${input.lat ?? "_"}:${input.lng ?? "_"}:${input.limit}:${input.includeDebug ? "d" : "_"}`;
    const cached = mixCache.get<{ mixes: Array<Record<string, unknown>>; scoringVersion: string }>(cacheKey);
    if (cached) {
      return { routeName: "search.mixes.bootstrap.get", mixes: cached.mixes, scoringVersion: cached.scoringVersion };
    }

    const viewerCoords = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const payload = await this.v2.bootstrap({
      viewerId: input.viewerId,
      viewerCoords,
      limitGeneral: input.limit,
      includeDebug: input.includeDebug,
    });

    // Contract expects SearchMixSchema (id/key/title/subtitle/type/intent/coverImageUrl/...)
    const mixes = payload.mixes.map((m) => ({
      id: m.mixId,
      key: m.mixId,
      title: m.title,
      subtitle: m.subtitle,
      type: m.mixType === "general" ? "general" : m.mixType,
      intent: {
        seedKind:
          m.definition.kind === "friends" ? "friends" : m.definition.kind === "daily" ? "daily" : "activity_query",
        seedQuery: m.definition.kind === "activity" ? `${m.definition.activity}` : null,
        activityFilters: m.definition.kind === "activity" && m.definition.activity ? [m.definition.activity] : [],
        locationLabel: m.mixType === "nearby" ? "Near you" : null,
        locationConstraint: null,
      },
      coverImageUrl: m.coverMedia,
      coverPostId: m.coverPostId,
      previewPostIds: m.previewPostIds,
      candidateCount: m.availableCount,
      requiresLocation: Boolean(m.requiresLocation),
      requiresFollowing: Boolean(m.requiresFollowing),
      hiddenReason: m.hiddenReason ?? null,
      ...(input.includeDebug ? { debugMix: m.debugMix ?? {} } : {}),
    }));

    mixCache.set(cacheKey, { mixes, scoringVersion }, 15_000);
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
    mixType?: string;
    posts: Array<Record<string, unknown>>;
    nextCursor: string | null;
    hasMore: boolean;
    scoringVersion: string;
    debug?: Record<string, unknown>;
  }> {
    const scoringVersion = "mixes_v2";
    const viewerCoords = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const payload = await this.v2.feed({
      viewerId: input.viewerId,
      mixId: input.mixId,
      viewerCoords,
      limit: input.limit,
      cursor: input.cursor ?? null,
      includeDebug: input.includeDebug,
    });
    return {
      routeName: "search.mixes.feed.post",
      mixId: input.mixId,
      mixType: payload.mixType,
      posts: payload.posts.map((row, index) =>
        buildPostEnvelope({
          postId: String(row.postId ?? row.id ?? ""),
          seed: {
            ...row,
            rankToken: `mix-${input.mixId}-${index + 1}`,
          },
          sourcePost: row,
          rawPost: row,
          hydrationLevel: "card",
          sourceRoute: "search.mixes.feed",
          rankToken: `mix-${input.mixId}-${index + 1}`,
          debugSource: "SearchMixesOrchestrator.feedPage",
        }),
      ),
      nextCursor: payload.nextCursor,
      hasMore: payload.hasMore,
      scoringVersion,
      ...(input.includeDebug ? { debug: payload.debug ?? {} } : {}),
    };
  }
}
