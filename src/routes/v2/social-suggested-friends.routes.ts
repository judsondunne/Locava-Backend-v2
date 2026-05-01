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
    const targetUserId = query.userId?.trim() || viewer.viewerId;
    const limit = query.limit ?? 20;
    let cursorOffset = 0;
    try {
      cursorOffset = decodeSuggestedFriendsCursor(query.cursor);
    } catch {
      return reply.status(400).send(failure("invalid_cursor", "Cursor is invalid"));
    }
    const surface = query.surface ?? "generic";
    const excludeUserIds = String(query.excludeUserIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const computeLimit =
      surface === "onboarding"
        ? limit
        : Math.min(50, Math.max(limit, cursorOffset + limit));
    setRouteName(socialSuggestedFriendsContract.routeName);
    let fallbackReason: string | null = null;
    let fallbackErrorCode: string | null = null;
    let data;
    try {
      data = await service.getSuggestionsForUser(targetUserId, {
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
        excludeBlocked: true,
        excludeUserIds,
        sortBy: query.sortBy ?? "default",
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      fallbackReason = "repository_failure";
      fallbackErrorCode = rawMessage.includes("FAILED_PRECONDITION") ? "FAILED_PRECONDITION" : "unknown";
      request.log.error(
        {
          routeName: socialSuggestedFriendsContract.routeName,
          viewerId: targetUserId,
          surface,
          error: rawMessage,
          errorCode: fallbackErrorCode,
        },
        "suggested friends fallback to empty payload"
      );
      data = {
        users: [],
        sourceBreakdown: {},
        generatedAt: Date.now(),
        etag: undefined,
      };
    }
    const users = data.users.slice(cursorOffset, cursorOffset + limit);
    const nextOffset = cursorOffset + users.length;
    const hasMore = nextOffset < data.users.length;
    const nextCursor = hasMore ? encodeSuggestedFriendsCursor(nextOffset) : null;
    const reqCtx = getRequestContext();
    const excludedAlreadyFollowingCount = data.users.filter((u) => u.isFollowing).length;
    const payload = {
      routeName: socialSuggestedFriendsContract.routeName,
      viewerId: targetUserId,
      surface,
      users,
      suggestions: users,
      source: fallbackReason ? "fallback_empty" : "computed",
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
        viewerId: targetUserId,
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
        excludedAlreadyFollowingCount,
        ...(fallbackReason ? { reason: fallbackReason } : {}),
        ...(fallbackErrorCode ? { errorCode: fallbackErrorCode } : {}),
      }
    };
    return success(payload);
  });
}
