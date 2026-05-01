import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingSongsContract,
  PostingSongsQuerySchema
} from "../../contracts/surfaces/posting-songs.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostingAudioService } from "../../services/posting/posting-audio.service.js";

export async function registerV2PostingSongsRoutes(app: FastifyInstance): Promise<void> {
  const audioService = new PostingAudioService();

  app.get(postingSongsContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    setRouteName(postingSongsContract.routeName);
    const query = PostingSongsQuerySchema.parse(request.query);
    const payload = await audioService.listSongs({
      page: query.page,
      limit: query.limit,
      search: query.search,
      genre: query.genre
    });

    return success({
      routeName: "posting.songs.get" as const,
      audio: payload.audio,
      total: payload.total,
      page: payload.page,
      limit: payload.limit
    });
  });
}
