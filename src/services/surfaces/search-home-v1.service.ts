import { MixPostsRepository } from "../../repositories/mixPosts.repository.js";
import { SearchHomeV1UsersRepository, type SearchHomeV1UserSummary } from "../../repositories/surfaces/search-home-v1-users.repository.js";
import { MixesRepository as MixPoolRepository } from "../../repositories/mixes/mixes.repository.js";
import { SuggestedFriendsService } from "./suggested-friends.service.js";
import { getBestPostCover } from "../mixes/mixCover.service.js";
import { SearchMixesServiceV2 } from "../mixes/v2/searchMixes.service.js";
import { mediaTypeFromRow } from "./search-home-v1.projection.js";

export {
  SEARCH_HOME_V1_ACTIVITY_KEYS,
  resolveSearchHomeV1ActivityAliases,
  resolveSearchHomeV1MixCanonicalKey,
  type SearchHomeV1ActivityKey,
} from "./search-home-v1.activity-aliases.js";

export const searchHomeV1CacheKeys = {
  homeFull(viewerId: string): string {
    return `search:home:v1:${viewerId}`;
  },
  userSummary(userId: string): string {
    return `user:summary:v1:${userId}`;
  },
  userFirstPost(userId: string): string {
    return `user:firstPost:v1:${userId}`;
  },
  mixPreview(activityKey: string): string {
    return `search:mixPreview:v1:${activityKey}`;
  },
} as const;

function firstPostFromRow(row: Record<string, unknown>): {
  id: string;
  thumbnailUrl: string | null;
  mediaType: "photo" | "video";
  activity: string;
  createdAt: string;
} | null {
  const id = String(row.postId ?? row.id ?? "").trim();
  if (!id) return null;
  const cover = getBestPostCover(row);
  const acts = Array.isArray(row.activities) ? row.activities : [];
  const activity = String(acts[0] ?? "").trim().toLowerCase() || "";
  const mt = mediaTypeFromRow(row);
  const t = Number(row.time ?? row.createdAtMs ?? 0);
  const createdAt = Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : new Date().toISOString();
  return {
    id,
    thumbnailUrl: cover.coverImageUrl,
    mediaType: mt,
    activity,
    createdAt,
  };
}

export type SearchHomeV1BuildResult = {
  version: 1;
  viewerId: string;
  generatedAt: string;
  suggestedUsers: Array<{
    user: SearchHomeV1UserSummary;
    firstPost: ReturnType<typeof firstPostFromRow>;
    reason: string;
  }>;
  /** Activity rails disabled — empty until mixes ship again. */
  activityMixes: Array<{
    id: string;
    title: string;
    activityKey: string;
    previewMode: "one" | "three";
    posts: Array<{
      id: string;
      thumbnailUrl: string | null;
      mediaType: "photo" | "video";
      activity: string;
      title: string | null;
      placeName: string | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
  }>;
  diagnostics: {
    suggestedUserCount: number;
    suggestedUsersWithFirstPostCount: number;
    activityMixCount: number;
    postsPerMix: number[];
  };
};

export class SearchHomeV1Service {
  private readonly suggested = new SuggestedFriendsService();
  private readonly usersRepo = new SearchHomeV1UsersRepository();
  private readonly postsRepo = new MixPostsRepository();
  private readonly mixPoolRepo = new MixPoolRepository();
  private readonly searchMixes = new SearchMixesServiceV2();

  async build(viewerId: string, opts?: { bypassSuggestedFriendsCache?: boolean }): Promise<SearchHomeV1BuildResult> {
    const now = new Date().toISOString();
    const suggestions = await this.suggested
      .getSuggestionsForUser(viewerId, {
        surface: "search",
        limit: 24,
        excludeAlreadyFollowing: true,
        excludeBlocked: true,
        bypassCache: Boolean(opts?.bypassSuggestedFriendsCache),
      })
      .catch(() => ({
        users: [],
        sourceBreakdown: {},
        generatedAt: Date.now(),
      }));

    const candidates = suggestions.users
      .filter((u) => u.userId && u.userId !== viewerId && !u.isFollowing)
      .slice(0, 8);

    const userIds = candidates.map((c) => c.userId);
    const summaryMap = await this.usersRepo.loadUserSummaries(userIds).catch(() => new Map<string, SearchHomeV1UserSummary>());

    const suggestedUsersRaw = await Promise.all(
      candidates.map(async (c) => {
        const userSummary = summaryMap.get(c.userId);
        if (!userSummary) return null;
        const rows = await this.postsRepo.listRecentPostsByUserId(c.userId, 1).catch(() => []);
        const top = rows[0];
        const firstPost = top ? firstPostFromRow(top as Record<string, unknown>) : null;
        return {
          user: userSummary,
          firstPost,
          reason: c.reason ?? "suggested",
        } satisfies SearchHomeV1BuildResult["suggestedUsers"][number];
      })
    );
    const suggestedUsers: SearchHomeV1BuildResult["suggestedUsers"] = suggestedUsersRaw.filter((row) => row !== null);

    const mixBootstrap = await this.searchMixes
      .bootstrap({
        viewerId,
        viewerCoords: null,
        limitGeneral: 8,
        includeDebug: false,
      })
      .catch(() => ({ mixes: [] as Awaited<ReturnType<SearchMixesServiceV2["bootstrap"]>>["mixes"] }));
    const mixPool = await this.mixPoolRepo.listFromPool().catch(() => ({ posts: [] as Array<Record<string, unknown>> }));
    const activityMixes = await this.buildActivityMixes(mixBootstrap.mixes, mixPool.posts as Array<Record<string, unknown>>);

    return {
      version: 1,
      viewerId,
      generatedAt: now,
      suggestedUsers,
      activityMixes,
      diagnostics: {
        suggestedUserCount: suggestedUsers.length,
        suggestedUsersWithFirstPostCount: suggestedUsers.filter((s) => s.firstPost != null).length,
        activityMixCount: activityMixes.length,
        postsPerMix: activityMixes.map((mix) => mix.posts.length),
      },
    };
  }

  private async buildActivityMixes(
    mixes: Awaited<ReturnType<SearchMixesServiceV2["bootstrap"]>>["mixes"],
    poolPosts: Array<Record<string, unknown>>
  ): Promise<SearchHomeV1BuildResult["activityMixes"]> {
    if (!mixes.length) return [];
    const previewById = new Map(
      poolPosts.map((row) => [String((row as Record<string, unknown>).postId ?? (row as Record<string, unknown>).id ?? ""), row] as const)
    );
    return mixes.slice(0, 8).map((mix) => {
      const posts = mix.previewPostIds
        .map((postId) => {
          const row = previewById.get(postId) ?? null;
          const preview = row ? firstPostFromRow(row) : null;
          if (!preview) return null;
          return {
            id: preview.id,
            thumbnailUrl: preview.thumbnailUrl ?? mix.coverMedia ?? null,
            mediaType: preview.mediaType,
            activity: preview.activity || String(mix.definition.activity ?? mix.mixId).replace(/^activity:/, ""),
            title: typeof row?.title === "string" ? row.title : typeof row?.caption === "string" ? row.caption : null,
            placeName: typeof row?.address === "string" ? row.address : null,
            createdAt: preview.createdAt,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .slice(0, 3);
      return {
        id: mix.mixId,
        title: mix.title,
        activityKey: String(mix.definition.activity ?? mix.mixId).replace(/^activity:/, ""),
        previewMode: posts.length >= 3 ? ("three" as const) : ("one" as const),
        posts,
        nextCursor: null,
      };
    });
  }
}
