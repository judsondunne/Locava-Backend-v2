import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingStagingPresignContract,
  PostingStagingPresignBodySchema
} from "../../contracts/surfaces/posting-staging-presign.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import {
  enrichPresignSlotsForLegacyCompat,
  presignPostSessionStagingBatch,
  type StagingPresignItem
} from "../../services/storage/wasabi-presign.service.js";

export async function registerV2PostingStagingPresignRoutes(app: FastifyInstance): Promise<void> {
  app.post(postingStagingPresignContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    if (!viewer.viewerId || viewer.viewerId === "anonymous") {
      return reply.status(401).send(failure("unauthorized", "Viewer required for staging presign"));
    }

    const body = PostingStagingPresignBodySchema.parse(request.body);
    setRouteName(postingStagingPresignContract.routeName);

    const itemsPayload: StagingPresignItem[] = body.items.map((it) => ({
      index: it.index,
      assetType: it.assetType,
      ...(it.destinationKey ? { destinationKey: it.destinationKey } : {})
    }));

    const signed = await presignPostSessionStagingBatch(itemsPayload, body.sessionId);
    if (!signed.ok) {
      const code = signed.code === "not_configured" ? "object_storage_unavailable" : "presign_failed";
      const status = signed.code === "not_configured" ? 503 : 500;
      return reply.status(status).send(failure(code, signed.message));
    }

    const cfg = readWasabiConfigFromEnv();
    if (!cfg) {
      return reply.status(503).send(failure("object_storage_unavailable", "Wasabi configuration unavailable"));
    }

    const normalized = body.items.map((it) => ({ index: it.index, assetType: it.assetType }));
    const urls = enrichPresignSlotsForLegacyCompat(cfg, body.sessionId, signed.urls, normalized);

    return success({
      routeName: "posting.stagingpresign.post" as const,
      sessionId: body.sessionId,
      urls
    });
  });
}
