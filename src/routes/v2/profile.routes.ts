import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  ProfileAchievementsParamsSchema,
  ProfileAchievementsQuerySchema,
  profileAchievementsContract
} from "../../contracts/surfaces/profile-achievements.contract.js";
import {
  ProfileBootstrapParamsSchema,
  ProfileBootstrapQuerySchema,
  profileBootstrapContract
} from "../../contracts/surfaces/profile-bootstrap.contract.js";
import {
  ProfileCollectionsParamsSchema,
  ProfileCollectionsQuerySchema,
  profileCollectionsContract
} from "../../contracts/surfaces/profile-collections.contract.js";
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
import {
  ProfileRelationshipParamsSchema,
  profileRelationshipContract
} from "../../contracts/surfaces/profile-relationship.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { getRequestContext, setRouteName } from "../../observability/request-context.js";
import { ProfileAchievementsOrchestrator } from "../../orchestration/surfaces/profile-achievements.orchestrator.js";
import { ProfileBootstrapOrchestrator } from "../../orchestration/surfaces/profile-bootstrap.orchestrator.js";
import { ProfileCollectionsOrchestrator } from "../../orchestration/surfaces/profile-collections.orchestrator.js";
import { ProfileFollowersOrchestrator } from "../../orchestration/surfaces/profile-followers.orchestrator.js";
import { ProfileFollowingOrchestrator } from "../../orchestration/surfaces/profile-following.orchestrator.js";
import {
  ProfileLikedPostsQuerySchema,
  profileLikedPostsContract
} from "../../contracts/surfaces/profile-liked-posts.contract.js";
import { ProfileLikedPostsOrchestrator } from "../../orchestration/surfaces/profile-liked-posts.orchestrator.js";
import { ProfileRelationshipOrchestrator } from "../../orchestration/surfaces/profile-relationship.orchestrator.js";
import { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { ProfileService } from "../../services/surfaces/profile.service.js";

function logProfileRoute(
  request: { log: { info: (payload: Record<string, unknown>, message: string) => void } },
  input: { routeName: string; profileUserId: string; viewerId: string; counts?: Partial<Record<"grid" | "collections" | "achievements", number>> }
): void {
  const ctx = getRequestContext();
  request.log.info(
    {
      routeName: input.routeName,
      profileUserId: input.profileUserId,
      viewerId: input.viewerId,
      latencyMs: ctx ? Number((Number(process.hrtime.bigint() - ctx.startNs) / 1_000_000).toFixed(2)) : undefined,
      readCount: ctx?.dbOps.reads ?? 0,
      payloadSize: ctx?.payloadBytes ?? 0,
      cacheHits: ctx?.cache.hits ?? 0,
      cacheMisses: ctx?.cache.misses ?? 0,
      counts: input.counts ?? {},
      fallbacks: ctx?.fallbacks ?? [],
    },
    "profile route completed"
  );
}

export async function registerV2ProfileRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ProfileRepository();
  const service = new ProfileService(repository);
  const orchestrator = new ProfileBootstrapOrchestrator(service);
  const collectionsOrchestrator = new ProfileCollectionsOrchestrator(service);
  const achievementsOrchestrator = new ProfileAchievementsOrchestrator(service);
  const followersOrchestrator = new ProfileFollowersOrchestrator(service);
  const followingOrchestrator = new ProfileFollowingOrchestrator(service);
  const likedPostsOrchestrator = new ProfileLikedPostsOrchestrator(service);
  const relationshipOrchestrator = new ProfileRelationshipOrchestrator(service);

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
    logProfileRoute(request, {
      routeName: profileBootstrapContract.routeName,
      profileUserId: params.userId,
      viewerId: viewer.viewerId,
      counts: {
        grid: payload.firstRender.gridPreview.items.length,
        collections: payload.firstRender.collectionsPreview.items.length,
        achievements: payload.firstRender.achievementsPreview.items.length,
      }
    });

    return success(payload);
  });

  app.get(profileRelationshipContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }
    const params = ProfileRelationshipParamsSchema.parse(request.params);
    setRouteName(profileRelationshipContract.routeName);
    const payload = await relationshipOrchestrator.run({
      viewerId: viewer.viewerId,
      userId: params.userId,
    });
    logProfileRoute(request, {
      routeName: profileRelationshipContract.routeName,
      profileUserId: params.userId,
      viewerId: viewer.viewerId,
    });
    return success(payload);
  });

  app.get(profileCollectionsContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }
    const params = ProfileCollectionsParamsSchema.parse(request.params);
    const query = ProfileCollectionsQuerySchema.parse(request.query);
    setRouteName(profileCollectionsContract.routeName);
    const payload = await collectionsOrchestrator.run({
      viewerId: viewer.viewerId,
      userId: params.userId,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });
    logProfileRoute(request, {
      routeName: profileCollectionsContract.routeName,
      profileUserId: params.userId,
      viewerId: viewer.viewerId,
      counts: { collections: payload.items.length },
    });
    return success(payload);
  });

  app.get(profileAchievementsContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("profile", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Profile v2 surface is not enabled for this viewer"));
    }
    const params = ProfileAchievementsParamsSchema.parse(request.params);
    const query = ProfileAchievementsQuerySchema.parse(request.query);
    setRouteName(profileAchievementsContract.routeName);
    const payload = await achievementsOrchestrator.run({
      viewerId: viewer.viewerId,
      userId: params.userId,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });
    logProfileRoute(request, {
      routeName: profileAchievementsContract.routeName,
      profileUserId: params.userId,
      viewerId: viewer.viewerId,
      counts: { achievements: payload.items.length },
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
