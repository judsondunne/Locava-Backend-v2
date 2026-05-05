import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  AuthPushTokenBodySchema,
  authPushTokenContract
} from "../../contracts/surfaces/auth-push-token.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AuthMutationsService } from "../../services/mutations/auth-mutations.service.js";

export async function registerV2AuthPushTokenRoutes(app: FastifyInstance): Promise<void> {
  const authMutationsService = new AuthMutationsService();

  app.post(authPushTokenContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    if (!viewer.viewerId || viewer.viewerId === "anonymous") {
      return reply
        .status(401)
        .send(failure("viewer_id_required", "Signed-in viewer required to register a device push token"));
    }
    const body = AuthPushTokenBodySchema.parse(request.body);
    setRouteName(authPushTokenContract.routeName);

    const expoRaw = typeof body.expoPushToken === "string" ? body.expoPushToken.trim() : "";
    const pushRaw = typeof body.pushToken === "string" ? body.pushToken.trim() : "";
    const expoPushToken = expoRaw.length > 0 ? expoRaw : pushRaw;
    const pushToken = pushRaw.length > 0 ? pushRaw : expoRaw;
    if (!expoPushToken || !pushToken) {
      return reply.send(
        success({
          routeName: authPushTokenContract.routeName,
          success: false,
          error: "invalid_push_token"
        })
      );
    }

    try {
      const result = await authMutationsService.persistViewerDevicePushTokens(viewer.viewerId, {
        expoPushToken,
        pushToken,
        pushTokenPlatform: body.pushTokenPlatform
      }, {
        deferPersist: true
      });
      return success({
        routeName: authPushTokenContract.routeName,
        success: true,
        persisted: result.persisted
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "push_token_persist_failed";
      request.log.warn({ err: error, viewerId: viewer.viewerId }, "auth_push_token_persist_error");
      return success({
        routeName: authPushTokenContract.routeName,
        success: false,
        error: message
      });
    }
  });
}
