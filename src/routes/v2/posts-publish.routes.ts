import type { FastifyInstance, FastifyReply } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { postsStageContract, PostsStageBodySchema } from "../../contracts/surfaces/posts-stage.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { PostsPublishOrchestrator } from "../../orchestration/mutations/posts-publish.orchestrator.js";
import { PostsStageRepositoryError } from "../../repositories/mutations/posts-stage.repository.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import { PostsPublishService } from "../../services/mutations/posts-publish.service.js";
import {
  postsMediaSignUploadContract,
  PostsMediaSignUploadBodySchema
} from "../../contracts/surfaces/posts-media-sign-upload.contract.js";
import {
  postsMediaCompleteContract,
  PostsMediaCompleteBodySchema
} from "../../contracts/surfaces/posts-media-complete.contract.js";
import { postsPublishContract, PostsPublishBodySchema } from "../../contracts/surfaces/posts-publish.contract.js";
import { postsCardContract, PostsCardParamsSchema } from "../../contracts/surfaces/posts-card.contract.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";

function publicPostingTestEnabled(): boolean {
  return process.env.ALLOW_PUBLIC_POSTING_TEST === "1" || process.env.ALLOW_PUBLIC_POSTING_TEST === "true";
}

function resolvePostingViewer(request: Parameters<typeof buildViewerContext>[0]): { viewerId: string; roles: string[] } {
  const viewer = buildViewerContext(request);
  if (viewer.viewerId !== "anonymous") {
    return { viewerId: viewer.viewerId, roles: [...viewer.roles] };
  }
  if (!publicPostingTestEnabled()) {
    return { viewerId: viewer.viewerId, roles: [...viewer.roles] };
  }
  const fallbackViewerId = process.env.DEBUG_VIEWER_ID?.trim() || "public-posting-test-viewer";
  return { viewerId: fallbackViewerId, roles: ["internal"] };
}

function canUsePostingSurface(roles: readonly string[]): boolean {
  if (publicPostingTestEnabled()) return true;
  return canUseV2Surface("posting", roles);
}

function mapStageError(error: PostsStageRepositoryError, reply: FastifyReply) {
  if (error.code === "stage_not_found") return reply.status(404).send(failure("stage_not_found", error.message));
  if (error.code === "stage_not_owned") return reply.status(403).send(failure("stage_not_owned", error.message));
  if (error.code === "stage_expired") return reply.status(410).send(failure("stage_expired", error.message));
  if (error.code === "stage_not_ready") return reply.status(409).send(failure("stage_not_ready", error.message));
  if (error.code === "stage_not_publishable") return reply.status(409).send(failure("stage_not_publishable", error.message));
  return reply.status(400).send(failure(error.code, error.message));
}

export async function registerV2PostsPublishRoutes(app: FastifyInstance): Promise<void> {
  const service = new PostsPublishService();
  const orchestrator = new PostsPublishOrchestrator(service);
  const feedService = new FeedService(new FeedRepository());

  app.post(postsStageContract.path, async (request, reply) => {
    const viewer = resolvePostingViewer(request);
    if (!canUsePostingSurface(viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    const body = PostsStageBodySchema.parse(request.body);
    setRouteName(postsStageContract.routeName);
    try {
      const payload = await orchestrator.stage({
        viewerId: viewer.viewerId,
        clientMutationId: body.clientMutationId,
        title: body.title,
        caption: body.caption,
        activities: body.activities,
        privacy: body.privacy,
        lat: body.lat,
        long: body.long,
        address: body.address,
        tags: body.tags,
        assets: body.assets
      });
      return success(payload);
    } catch (error) {
      if (error instanceof SourceOfTruthRequiredError) {
        return reply.status(503).send(failure("source_of_truth_required", error.sourceLabel));
      }
      throw error;
    }
  });

  app.post(postsMediaSignUploadContract.path, async (request, reply) => {
    const viewer = resolvePostingViewer(request);
    if (!canUsePostingSurface(viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    const body = PostsMediaSignUploadBodySchema.parse(request.body);
    setRouteName(postsMediaSignUploadContract.routeName);
    try {
      const payload = await orchestrator.signUpload({
        viewerId: viewer.viewerId,
        stageId: body.stageId,
        items: body.items
      });
      return success(payload);
    } catch (error) {
      if (error instanceof PostsStageRepositoryError) {
        return mapStageError(error, reply);
      }
      if (error instanceof SourceOfTruthRequiredError) {
        return reply.status(503).send(failure("source_of_truth_required", error.sourceLabel));
      }
      if (error instanceof Error && error.message === "object_storage_unavailable") {
        return reply.status(503).send(failure("object_storage_unavailable", "Object storage is unavailable"));
      }
      throw error;
    }
  });

  app.post(postsMediaCompleteContract.path, async (request, reply) => {
    const viewer = resolvePostingViewer(request);
    if (!canUsePostingSurface(viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    const body = PostsMediaCompleteBodySchema.parse(request.body);
    setRouteName(postsMediaCompleteContract.routeName);
    try {
      const payload = await orchestrator.completeUpload({
        viewerId: viewer.viewerId,
        stageId: body.stageId,
        items: body.items
      });
      return success(payload);
    } catch (error) {
      if (error instanceof PostsStageRepositoryError) {
        return mapStageError(error, reply);
      }
      if (error instanceof SourceOfTruthRequiredError) {
        return reply.status(503).send(failure("source_of_truth_required", error.sourceLabel));
      }
      if (error instanceof Error && (error.message === "object_storage_unavailable" || error.message === "storage_probe_failed")) {
        return reply.status(503).send(failure("object_storage_unavailable", "Unable to verify uploaded media"));
      }
      throw error;
    }
  });

  app.post(postsPublishContract.path, async (request, reply) => {
    const viewer = resolvePostingViewer(request);
    if (!canUsePostingSurface(viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    const body = PostsPublishBodySchema.parse(request.body);
    setRouteName(postsPublishContract.routeName);
    try {
      const payload = await orchestrator.publish({
        viewerId: viewer.viewerId,
        authorizationHeader: request.headers.authorization?.toString(),
        stageId: body.stageId,
        clientMutationId: body.clientMutationId,
        title: body.title,
        caption: body.caption,
        activities: body.activities,
        privacy: body.privacy,
        lat: body.lat,
        long: body.long,
        address: body.address,
        tags: body.tags,
        texts: body.texts,
        recordingsList: body.recordingsList
      });
      return success(payload);
    } catch (error) {
      if (error instanceof PostsStageRepositoryError) {
        return mapStageError(error, reply);
      }
      if (error instanceof SourceOfTruthRequiredError) {
        return reply.status(503).send(failure("source_of_truth_required", error.sourceLabel));
      }
      if (error instanceof Error && error.message === "legacy_monolith_unavailable") {
        return reply
          .status(503)
          .send(failure("source_of_truth_required", "LEGACY_MONOLITH_PROXY_BASE_URL is required for publish source-of-truth"));
      }
      if (error instanceof Error && error.message === "publish_failed") {
        return reply.status(502).send(failure("upstream_publish_failed", "Legacy publish failed"));
      }
      if (error instanceof Error && error.message.toLowerCase().includes("unauthorized")) {
        return reply.status(401).send(failure("unauthorized", error.message));
      }
      throw error;
    }
  });

  app.get(postsCardContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("postViewer", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Post viewer v2 surface is not enabled for this viewer"));
    }
    const params = PostsCardParamsSchema.parse(request.params);
    setRouteName(postsCardContract.routeName);
    const card = await feedService.loadPostCardSummary(viewer.viewerId, params.postId);
    return success({
      routeName: "posts.card.get" as const,
      card
    });
  });
}
