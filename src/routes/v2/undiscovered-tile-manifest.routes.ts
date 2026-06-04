import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { undiscoveredTileManifestContract } from "../../contracts/surfaces/undiscovered-tile-manifest.contract.js";
import { success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { getUndiscoveredTileManifest } from "../../services/map/undiscoveredTileManifest.service.js";

export async function registerV2UndiscoveredTileManifestRoutes(app: FastifyInstance): Promise<void> {
  app.get(undiscoveredTileManifestContract.path, async (request, reply) => {
    setRouteName(undiscoveredTileManifestContract.routeName);
    buildViewerContext(request);
    const manifest = await getUndiscoveredTileManifest();
    reply.header("Cache-Control", "public, max-age=300");
    return success({
      routeName: undiscoveredTileManifestContract.routeName,
      ...manifest,
    });
  });
}
