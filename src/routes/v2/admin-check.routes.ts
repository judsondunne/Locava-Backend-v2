import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { hasAdminAccess } from "../../auth/admin-access.js";
import { adminCheckContract } from "../../contracts/surfaces/admin-check.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";

export async function registerV2AdminCheckRoutes(app: FastifyInstance): Promise<void> {
  app.get(adminCheckContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!viewer.viewerId || viewer.viewerId === "anonymous") {
      return reply
        .status(401)
        .send(failure("unauthorized", "Signed-in viewer required"));
    }

    setRouteName(adminCheckContract.routeName);
    return success({
      routeName: adminCheckContract.routeName,
      isAdmin: hasAdminAccess({ uid: viewer.viewerId }),
      viewerId: viewer.viewerId,
    });
  });
}
