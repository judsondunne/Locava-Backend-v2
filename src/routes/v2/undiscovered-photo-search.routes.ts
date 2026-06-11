import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  undiscoveredPhotoSearchContract,
  UndiscoveredPhotoSearchBodySchema,
} from "../../contracts/surfaces/undiscovered-photo-search.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { searchPlaceWebImagesForUndiscovered } from "../../services/undiscovered/undiscoveredPhotoSearch.service.js";
import type { AppEnv } from "../../config/env.js";

export async function registerV2UndiscoveredPhotoSearchRoutes(
  app: FastifyInstance,
  env: AppEnv,
): Promise<void> {
  app.post(undiscoveredPhotoSearchContract.path, async (request, reply) => {
    setRouteName(undiscoveredPhotoSearchContract.routeName);
    const viewer = buildViewerContext(request);
    const body = UndiscoveredPhotoSearchBodySchema.parse(request.body);

    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      body,
      viewerId: viewer.viewerId,
    });

    if (!result.ok) {
      return reply.status(result.statusCode).send(failure(result.code, result.message));
    }

    return success(result.response);
  });
}
