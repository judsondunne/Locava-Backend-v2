import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { socialBatchContract, SocialBatchQuerySchema } from "../../contracts/surfaces/social-batch.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CompatPostsBatchOrchestrator } from "../../orchestration/compat/posts-batch.orchestrator.js";
import { mutationStateRepository } from "../../repositories/mutations/mutation-state.repository.js";

function parsePostIdsFromQuery(raw: Record<string, unknown>): string[] {
  const postIds: string[] = [];
  const q = raw as Record<string, unknown>;
  const rawIds = q.postIds ?? q.ids ?? q.postId ?? q.id;
  if (Array.isArray(rawIds)) {
    for (const v of rawIds) {
      if (typeof v === "string" && v.trim()) postIds.push(v.trim());
    }
  } else if (typeof rawIds === "string" && rawIds.trim()) {
    const parts = rawIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    postIds.push(...parts);
  }
  return [...new Set(postIds.map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, 60);
}

export async function registerV2SocialBatchRoutes(app: FastifyInstance): Promise<void> {
  const postsBatch = new CompatPostsBatchOrchestrator();

  app.get(socialBatchContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Social batch v2 is not enabled for this viewer"));
    }
    const query = SocialBatchQuerySchema.parse(request.query);
    setRouteName(socialBatchContract.routeName);
    const mergedQuery = { ...query, ...(request.query as Record<string, unknown>) };
    const unique = parsePostIdsFromQuery(mergedQuery);
    if (unique.length === 0) {
      request.log.info(
        { event: "SOCIAL_BATCH_V2", requested: 0, returned: 0, route: socialBatchContract.path },
        "social batch v2 empty ids"
      );
      return success({ routeName: "social.batch.get", items: [] });
    }

    const posts = (await postsBatch.run({ postIds: unique })).posts;
    const byId = new Map(posts.map((p) => [String((p as any).postId ?? (p as any).id ?? ""), p]));

    const items = unique
      .map((postId) => {
        const row = byId.get(postId) as Record<string, unknown> | undefined;
        const likeCountRaw = row?.likeCount ?? row?.likesCount;
        const commentCountRaw = row?.commentCount ?? row?.commentsCount;
        const likeCount = typeof likeCountRaw === "number" && Number.isFinite(likeCountRaw) ? Math.max(0, likeCountRaw) : 0;
        const commentCount =
          typeof commentCountRaw === "number" && Number.isFinite(commentCountRaw) ? Math.max(0, commentCountRaw) : 0;
        return {
          postId,
          likeCount,
          commentCount,
          viewerHasLiked: mutationStateRepository.hasViewerLikedPost(viewer.viewerId, postId),
          viewerHasSaved: mutationStateRepository.resolveViewerSavedPost(viewer.viewerId, postId, false)
        };
      })
      .filter((it) => it.postId);

    request.log.info(
      {
        event: "SOCIAL_BATCH_V2",
        route: socialBatchContract.path,
        requested: unique.length,
        returned: items.length
      },
      "social batch v2"
    );
    return success({ routeName: "social.batch.get", items });
  });
}
