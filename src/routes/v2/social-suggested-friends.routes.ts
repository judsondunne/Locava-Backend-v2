import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName, getRequestContext } from "../../observability/request-context.js";
import { SocialSuggestedFriendsQuerySchema, socialSuggestedFriendsContract } from "../../contracts/surfaces/social-suggested-friends.contract.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";

function encodeSuggestedFriendsCursor(offset: number): string {
  return `offset:${offset}`;
}

function decodeSuggestedFriendsCursor(cursor?: string): number {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/.exec(cursor.trim());
  if (!match) {
    throw new Error("invalid_cursor");
  }
  return Number.parseInt(match[1] ?? "0", 10);
}

export async function registerV2SocialSuggestedFriendsRoutes(app: FastifyInstance): Promise<void> {
  const service = new SuggestedFriendsService();

  app.get(socialSuggestedFriendsContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Social suggested friends v2 is not enabled for this viewer"));
    }
    const query = SocialSuggestedFriendsQuerySchema.parse(request.query);
    const limit = query.limit ?? 20;
    let cursorOffset = 0;
    try {
      cursorOffset = decodeSuggestedFriendsCursor(query.cursor);
    } catch {
      return reply.status(400).send(failure("invalid_cursor", "Cursor is invalid"));
    }
    const surface = query.surface ?? "generic";
    const computeLimit =
      surface === "onboarding" ? limit : Math.min(16, Math.max(limit + cursorOffset + 1, limit));
    setRouteName(socialSuggestedFriendsContract.routeName);
    const data = await service.getSuggestionsForUser(viewer.viewerId, {
      limit: computeLimit,
      surface,
      includeContacts: true,
      includeMutuals: surface !== "onboarding",
      includePopular: surface !== "onboarding",
      includeNearby: false,
      includeGroups: true,
      includeReferral: true,
      includeAllUsersFallback: true,
      excludeAlreadyFollowing: true,
      excludeBlocked: true
    });
    const users = data.users.slice(cursorOffset, cursorOffset + limit);
    const nextOffset = cursorOffset + users.length;
    const hasMore = nextOffset < data.users.length;
    const nextCursor = hasMore ? encodeSuggestedFriendsCursor(nextOffset) : null;
    const reqCtx = getRequestContext();
    const excludedAlreadyFollowingCount = data.users.filter((u) => u.isFollowing).length;
    const payload = {
      routeName: socialSuggestedFriendsContract.routeName,
      viewerId: viewer.viewerId,
      surface,
      users,
      page: {
        limit,
        count: users.length,
        hasMore,
        nextCursor
      },
      sourceBreakdown: data.sourceBreakdown,
      returnedCount: users.length,
      generatedAt: data.generatedAt,
      etag: data.etag,
      diagnostics: {
        routeName: socialSuggestedFriendsContract.routeName,
        viewerId: viewer.viewerId,
        surface,
        returnedCount: users.length,
        sourceBreakdown: data.sourceBreakdown,
        payloadBytes: reqCtx?.payloadBytes ?? 0,
        dbReads: reqCtx?.dbOps.reads ?? 0,
        queryCount: reqCtx?.dbOps.queries ?? 0,
        cache: {
          hits: reqCtx?.cache.hits ?? 0,
          misses: reqCtx?.cache.misses ?? 0
        },
        dedupeCount: reqCtx?.dedupe.hits ?? 0,
        excludedAlreadyFollowingCount
      }
    };
    if (data.etag) {
      if (request.headers["if-none-match"] === data.etag) {
        return reply.status(304).send();
      }
      reply.header("etag", data.etag);
    }
    return success(payload);
  });
}
