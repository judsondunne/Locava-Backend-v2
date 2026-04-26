import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { SocialContactsSyncBodySchema, socialContactsSyncContract } from "../../contracts/surfaces/social-contacts-sync.contract.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";

export async function registerV2SocialContactsSyncRoutes(app: FastifyInstance): Promise<void> {
  const service = new SuggestedFriendsService();

  app.post(socialContactsSyncContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("search", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Social contact sync v2 is not enabled for this viewer"));
    }
    const body = SocialContactsSyncBodySchema.parse(request.body);
    setRouteName(socialContactsSyncContract.routeName);
    // invalidation: syncing contacts refreshes suggested-friends and contact-match caches for this viewer.
    const data = await service.syncContacts({
      viewerId: viewer.viewerId,
      contacts: body.contacts
    });
    return success({
      routeName: socialContactsSyncContract.routeName,
      matchedUsers: data.matchedUsers,
      matchedCount: data.matchedCount,
      syncedAt: data.syncedAt
    });
  });
}
