import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { getRequestContext, setRouteName } from "../../observability/request-context.js";
import { UsersSuggestedQuerySchema, usersSuggestedContract } from "../../contracts/surfaces/users-suggested.contract.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";

function encodeCursor(offset: number): string {
  return `offset:${offset}`;
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/.exec(cursor.trim());
  if (!match) throw new Error("invalid_cursor");
  return Number.parseInt(match[1] ?? "0", 10);
}

export async function registerV2UsersSuggestedRoutes(app: FastifyInstance): Promise<void> {
  const service = new SuggestedFriendsService();

  app.get(usersSuggestedContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Users suggested v2 is not enabled for this viewer"));
    }
    const query = UsersSuggestedQuerySchema.parse(request.query);
    const limit = query.limit ?? 50;
    const surface = query.surface ?? "generic";
    const includeDebug = query.includeDebug === "1";
    let offset = 0;
    try {
      offset = decodeCursor(query.cursor);
    } catch {
      return reply.status(400).send(failure("invalid_cursor", "Cursor is invalid"));
    }

    setRouteName(usersSuggestedContract.routeName);

    // Compute enough suggestions to serve this page + stable cursor pagination.
    const computeLimit = Math.min(120, Math.max(limit + offset + 10, limit));
    const data = await service.getSuggestionsForUser(viewer.viewerId, {
      limit: computeLimit,
      surface,
      includeContacts: true,
      includeMutuals: true,
      includePopular: true,
      includeGroups: true,
      includeReferral: true,
      includeAllUsersFallback: true,
      excludeAlreadyFollowing: true,
      excludeBlocked: true
    });

    const pageUsers = data.users.slice(offset, offset + limit);
    const nextOffset = offset + pageUsers.length;
    const hasMore = nextOffset < data.users.length;
    const nextCursor = hasMore ? encodeCursor(nextOffset) : null;

    const items = pageUsers.map((u) => ({
      user: {
        id: u.userId,
        ...(u.name ? { name: u.name } : {}),
        ...(u.handle ? { handle: u.handle } : {}),
        ...(u.profilePic ? { profilePic: u.profilePic } : {})
      },
      score: u.score,
      mutualCount: u.mutualCount ?? 0,
      mutualPreviewUserIds: (u.mutualPreview ?? []).map((p) => p.userId),
      mutualPreview: u.mutualPreview,
      reasons: [
        {
          type: u.reason,
          label: (u.reasonLabel ?? "").trim() || defaultReasonLabel(u)
        }
      ],
      cursor: u.userId
    }));

    const reqCtx = getRequestContext();
    return success({
      routeName: usersSuggestedContract.routeName,
      viewerId: viewer.viewerId,
      surface,
      items,
      nextCursor,
      fromCache: false,
      ...(includeDebug
        ? {
            diagnostics: {
              payloadBytes: reqCtx?.payloadBytes ?? 0,
              dbReads: reqCtx?.dbOps.reads ?? 0,
              queryCount: reqCtx?.dbOps.queries ?? 0,
              cache: { hits: reqCtx?.cache.hits ?? 0, misses: reqCtx?.cache.misses ?? 0 }
            }
          }
        : {})
    });
  });
}

function defaultReasonLabel(user: { reason: string; mutualCount?: number }): string {
  if (user.reason === "contacts") return "In your contacts";
  if (user.reason === "referral") return "From an invite";
  if (user.reason === "groups") return "In your communities";
  if (user.reason === "mutuals") {
    const c = user.mutualCount ?? 0;
    if (c <= 0) return "Mutuals";
    return c === 1 ? "1 mutual" : `${c} mutuals`;
  }
  if (user.reason === "popular") return "Popular on Locava";
  if (user.reason === "nearby") return "Near you";
  return "Suggested for you";
}

