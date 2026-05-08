import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName, getRequestContext } from "../../observability/request-context.js";
import { SocialSuggestedFriendsQuerySchema, socialSuggestedFriendsContract } from "../../contracts/surfaces/social-suggested-friends.contract.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";

const suggestedFriendsCache = new Map<string, { expiresAtMs: number; payload: Record<string, unknown> }>();
const suggestedFriendsInFlight = new Map<string, Promise<Record<string, unknown>>>();

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
    if (!targetUserId) {
      return success({
        routeName: socialSuggestedFriendsContract.routeName,
        viewerId: null,
        surface: query.surface ?? "generic",
        users: [],
        suggestions: [],
        source: "fallback_empty",
        page: {
          limit: query.limit ?? 20,
          count: 0,
          hasMore: false,
          nextCursor: null
        },
        sourceBreakdown: {},
        returnedCount: 0,
        generatedAt: Date.now(),
        etag: undefined,
        diagnostics: {
          routeName: socialSuggestedFriendsContract.routeName,
          viewerId: null,
          surface: query.surface ?? "generic",
          returnedCount: 0,
          sourceBreakdown: {},
          payloadBytes: 0,
          dbReads: 0,
          queryCount: 0,
          cache: { hits: 0, misses: 0 },
          dedupeCount: 0,
          excludedAlreadyFollowingCount: 0,
          reason: "missing_viewer"
        }
      });
    }
    const surface = query.surface ?? "generic";
    const limit = surface === "generic" ? query.limit ?? 8 : query.limit ?? 20;
    let cursorOffset = 0;
    try {
      cursorOffset = decodeSuggestedFriendsCursor(query.cursor);
    } catch {
      return reply.status(400).send(failure("invalid_cursor", "Cursor is invalid"));
    }
    const excludeUserIds = String(query.excludeUserIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const computeLimit =
      surface === "onboarding"
        ? limit
        : Math.min(50, Math.max(limit, cursorOffset + limit));
    const cacheKey = [
      targetUserId,
      surface,
      String(limit),
      String(cursorOffset),
      String(query.sortBy ?? "default"),
      excludeUserIds.join(","),
    ].join("|");
    const cached = suggestedFriendsCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      request.log.info(
        {
          event: "SUGGESTED_FRIENDS_CACHE_HIT",
          viewerId: targetUserId,
          surface,
          limit,
        },
        "suggested friends response served from route cache",
      );
      return success(cached.payload);
    }
    const existingInFlight = suggestedFriendsInFlight.get(cacheKey);
    if (existingInFlight) {
      return success(await existingInFlight);
    }
    setRouteName(socialSuggestedFriendsContract.routeName);
    const loadPromise = (async (): Promise<Record<string, unknown>> => {
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
          includeGroups: process.env.LOCAVA_SUGGESTED_FRIENDS_GROUPS === "1",
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
        request.log.warn(
          {
            routeName: socialSuggestedFriendsContract.routeName,
            viewerId: targetUserId,
            surface,
            errorCode: fallbackErrorCode,
          },
          "suggested friends source degraded to empty payload"
        );
        data = {
          users: [],
          sourceBreakdown: {},
          generatedAt: Date.now(),
          etag: undefined,
          sourceDiagnostics: [
            {
              sourceName: "aggregate",
              enabled: true,
              skipped: false,
              errorKind: fallbackErrorCode ?? "unknown",
              readCount: 0,
              queryCount: 0,
              latencyMs: 0,
              returnedCount: 0,
            },
          ],
        };
      }
      const users = data.users.slice(cursorOffset, cursorOffset + limit);
      const nextOffset = cursorOffset + users.length;
      const hasMore = nextOffset < data.users.length;
      const nextCursor = hasMore ? encodeSuggestedFriendsCursor(nextOffset) : null;
      const reqCtx = getRequestContext();
      const excludedAlreadyFollowingCount = data.users.filter((u) => u.isFollowing).length;
      return {
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
          sourceDiagnostics: data.sourceDiagnostics ?? [],
        }
      };
    })();
    suggestedFriendsInFlight.set(cacheKey, loadPromise);
    try {
      const payload = await loadPromise;
      suggestedFriendsCache.set(cacheKey, { expiresAtMs: Date.now() + 120_000, payload });
      return success(payload);
    } finally {
      suggestedFriendsInFlight.delete(cacheKey);
    }
  });
}
