import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  ProfileBootstrapParamsSchema,
  ProfileBootstrapQuerySchema,
  profileBootstrapContract
} from "../../contracts/surfaces/profile-bootstrap.contract.js";
import {
  ProfileFollowersParamsSchema,
  ProfileFollowersQuerySchema,
  profileFollowersContract
} from "../../contracts/surfaces/profile-followers.contract.js";
import {
  ProfileFollowingParamsSchema,
  ProfileFollowingQuerySchema,
  profileFollowingContract
} from "../../contracts/surfaces/profile-following.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { ProfileBootstrapOrchestrator } from "../../orchestration/surfaces/profile-bootstrap.orchestrator.js";
import { ProfileFollowersOrchestrator } from "../../orchestration/surfaces/profile-followers.orchestrator.js";
import { ProfileFollowingOrchestrator } from "../../orchestration/surfaces/profile-following.orchestrator.js";
import {
  ProfileLikedPostsQuerySchema,
  profileLikedPostsContract
} from "../../contracts/surfaces/profile-liked-posts.contract.js";
import { ProfileLikedPostsOrchestrator } from "../../orchestration/surfaces/profile-liked-posts.orchestrator.js";
import { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { ProfileService } from "../../services/surfaces/profile.service.js";

export async function registerV2ProfileRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ProfileRepository();
  const service = new ProfileService(repository);
  const orchestrator = new ProfileBootstrapOrchestrator(service);
  const followersOrchestrator = new ProfileFollowersOrchestrator(service);
  const followingOrchestrator = new ProfileFollowingOrchestrator(service);
  const likedPostsOrchestrator = new ProfileLikedPostsOrchestrator(service);

  app.get(profileBootstrapContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }

    const params = ProfileBootstrapParamsSchema.parse(request.params);
    const query = ProfileBootstrapQuerySchema.parse(request.query);

    setRouteName(profileBootstrapContract.routeName);

    const payload = await orchestrator.run({
      viewer,
      userId: params.userId,
      gridLimit: query.gridLimit,
      debugSlowDeferredMs: query.debugSlowDeferredMs
    });

    return success(payload);
  });

  app.get(profileFollowersContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }
    const params = ProfileFollowersParamsSchema.parse(request.params);
    const query = ProfileFollowersQuerySchema.parse(request.query);
    setRouteName(profileFollowersContract.routeName);
    const payload = await followersOrchestrator.run({
      viewer,
      userId: params.userId,
      cursor: query.cursor,
      limit: query.limit
    });
    return success(payload);
  });

  app.get(profileFollowingContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }
    const params = ProfileFollowingParamsSchema.parse(request.params);
    const query = ProfileFollowingQuerySchema.parse(request.query);
    setRouteName(profileFollowingContract.routeName);
    const payload = await followingOrchestrator.run({
      viewer,
      userId: params.userId,
      cursor: query.cursor,
      limit: query.limit
    });
    return success(payload);
  });

  app.get(profileLikedPostsContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }
    setRouteName(profileLikedPostsContract.routeName);
    const query = ProfileLikedPostsQuerySchema.parse(request.query);
    const payload = await likedPostsOrchestrator.run({
      viewerId: viewer.viewerId,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 24
    });
    return success(payload);
  });
}
