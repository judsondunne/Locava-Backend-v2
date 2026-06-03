import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postLikeItemDetailContract,
  postLikeRouteGeometryContract,
} from "../../contracts/surfaces/post-like-item-detail.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostsDetailOrchestrator } from "../../orchestration/surfaces/posts-detail.orchestrator.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";
import {
  getUnexploredRouteById,
  getUnexploredRouteGeometryChunks,
  getUnexploredSpotById,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";

function normalizeUnexploredSpot(doc: Record<string, unknown>) {
  return {
    ...doc,
    sourceCollection: "unexploredSpots",
    itemType: "unexploredSpot",
    itemId: String(doc.id ?? ""),
    isUnexplored: true,
    hasMedia: false,
  };
}

function normalizeUnexploredRoute(doc: Record<string, unknown>) {
  return {
    ...doc,
    sourceCollection: "unexploredRoutes",
    itemType: "unexploredRoute",
    itemId: String(doc.id ?? ""),
    isUnexplored: true,
    hasMedia: false,
    isRoute: true,
  };
}

export async function registerV2PostLikeItemDetailRoutes(app: FastifyInstance): Promise<void> {
  const orchestrator = new PostsDetailOrchestrator(new FeedService(new FeedRepository()));

  app.get(postLikeItemDetailContract.path, async (request, reply) => {
    setRouteName(postLikeItemDetailContract.routeName);
    buildViewerContext(request);
    const query = postLikeItemDetailContract.query.parse(request.query);

    if (query.sourceCollection === "posts" && query.itemType === "post") {
      try {
        const payload = await orchestrator.run({
          viewerId: buildViewerContext(request).viewerId,
          postId: query.id,
        });
        const post = payload.firstRender?.post as Record<string, unknown> | undefined;
        if (!post) {
          return reply.status(404).send(failure("post_not_found", "Post was not found"));
        }
        return success({
          routeName: "post_like.detail.get" as const,
          item: {
            ...post,
            id: query.id,
            itemId: query.id,
            postId: query.id,
            sourceCollection: "posts",
            itemType: "post",
            isUnexplored: false,
          },
          generatedAt: Date.now(),
        });
      } catch (error) {
        if (error instanceof Error && error.message === "feed_post_not_found") {
          return reply.status(404).send(failure("post_not_found", "Post was not found"));
        }
        throw error;
      }
    }

    if (query.sourceCollection === "unexploredSpots" && query.itemType === "unexploredSpot") {
      const doc = await getUnexploredSpotById(query.id);
      if (!doc) {
        return reply.status(404).send(failure("item_not_found", "Unexplored spot was not found"));
      }
      return success({
        routeName: "post_like.detail.get" as const,
        item: normalizeUnexploredSpot(doc),
        generatedAt: Date.now(),
      });
    }

    if (query.sourceCollection === "unexploredRoutes" && query.itemType === "unexploredRoute") {
      const doc = await getUnexploredRouteById(query.id);
      if (!doc) {
        return reply.status(404).send(failure("item_not_found", "Unexplored route was not found"));
      }
      return success({
        routeName: "post_like.detail.get" as const,
        item: normalizeUnexploredRoute(doc),
        generatedAt: Date.now(),
      });
    }

    return reply
      .status(400)
      .send(failure("unsupported_post_like_identity", "Unsupported sourceCollection/itemType pair"));
  });

  app.get(postLikeRouteGeometryContract.path, async (request, reply) => {
    setRouteName(postLikeRouteGeometryContract.routeName);
    buildViewerContext(request);
    const query = postLikeRouteGeometryContract.query.parse(request.query);

    if (query.sourceCollection !== "unexploredRoutes" || query.itemType !== "unexploredRoute") {
      return reply
        .status(400)
        .send(failure("unsupported_route_geometry", "Route geometry is only supported for unexplored routes"));
    }

    const doc = await getUnexploredRouteById(query.id);
    if (!doc) {
      return reply.status(404).send(failure("item_not_found", "Unexplored route was not found"));
    }

    const storage = doc.geometryStorage as { mode?: string } | undefined;
    const inlinePreview = Array.isArray(doc.coordinatesPreview) ? doc.coordinatesPreview : [];
    let coordinates = inlinePreview;
    if (storage?.mode === "chunked_subcollection") {
      coordinates = await getUnexploredRouteGeometryChunks(query.id);
    }

    return success({
      routeName: "post_like.route_geometry.get" as const,
      route: {
        ...doc,
        coordinates,
        geometryStorage: storage,
      },
      generatedAt: Date.now(),
    });
  });
}
