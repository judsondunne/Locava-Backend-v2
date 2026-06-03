import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingClaimCandidateGetContract,
  PostingClaimCandidateQuerySchema,
  postingClaimCandidatePostContract,
  PostingClaimCandidateBodySchema
} from "../../contracts/surfaces/posting-claim-candidate.contract.js";
import {
  postingClaimFinalizeContract,
  PostingClaimFinalizeBodySchema
} from "../../contracts/surfaces/posting-claim-finalize.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { resolvePostingClaimCandidate } from "../../services/posting/postingClaimCandidate.service.js";
import {
  finalizePostingClaim,
  listUserCapturedSpots
} from "../../services/posting/postingClaimFinalize.service.js";
import { z } from "zod";

function parseActivitiesFromQuery(raw?: string): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Required Firestore indexes:
 * - users/{userId}/capturedSpots: capturedAt DESC
 */
export async function registerV2PostingClaimRoutes(app: FastifyInstance): Promise<void> {
  app.get(postingClaimCandidateGetContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    setRouteName(postingClaimCandidateGetContract.routeName);
    const query = PostingClaimCandidateQuerySchema.parse(request.query);
    const { candidate } = await resolvePostingClaimCandidate({
      lat: query.lat,
      lng: query.lng,
      activities: parseActivitiesFromQuery(query.activities),
      title: query.title,
      itemTypes: query.itemTypes,
      maxRadiusMeters: query.maxRadiusMeters
    });

    return success({
      routeName: "posting.claim_candidate.get",
      candidate
    });
  });

  app.post(postingClaimCandidatePostContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    setRouteName(postingClaimCandidatePostContract.routeName);
    const body = PostingClaimCandidateBodySchema.parse(request.body);
    const { candidate } = await resolvePostingClaimCandidate({
      lat: body.lat,
      lng: body.lng,
      activities: body.activities,
      title: body.title,
      itemTypes: body.itemTypes,
      maxRadiusMeters: body.maxRadiusMeters
    });

    return success({
      routeName: "posting.claim_candidate.post",
      candidate
    });
  });

  app.post(postingClaimFinalizeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    setRouteName(postingClaimFinalizeContract.routeName);
    if (process.env.NODE_ENV !== "production") {
      const rawBody = request.body;
      request.log.info(
        {
          claimFinalizeBodyType: typeof rawBody,
          claimFinalizeBodyKeys:
            rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
              ? Object.keys(rawBody as Record<string, unknown>)
              : []
        },
        "claim_finalize_body_inspect"
      );
    }
    const body = PostingClaimFinalizeBodySchema.parse(request.body);
    if (body.userId !== viewer.viewerId) {
      return reply.status(403).send(failure("forbidden", "Cannot finalize claim for another user"));
    }

    const result = await finalizePostingClaim({
      viewerId: viewer.viewerId,
      postId: body.postId,
      userId: body.userId,
      lat: body.lat,
      lng: body.lng,
      candidateId: body.candidateId,
      sourceCollection: body.sourceCollection,
      itemType: body.itemType,
      activities: body.activities,
      title: body.title,
      enforcePostDistanceCheck: body.enforcePostDistanceCheck
    });

    if (process.env.NODE_ENV !== "production" && result.reason === "post_too_far_from_candidate") {
      request.log.warn(
        {
          postId: body.postId,
          userId: body.userId,
          requestLat: body.lat,
          requestLng: body.lng,
          candidateId: body.candidateId,
          enforcePostDistanceCheck: body.enforcePostDistanceCheck
        },
        "claim_finalize_post_too_far"
      );
    }

    return success({
      routeName: "posting.claim_finalize.post",
      ...result
    });
  });

  app.get("/v2/users/:userId/captured-spots", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    const params = z.object({ userId: z.string().trim().min(1) }).parse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).optional()
      })
      .parse(request.query);

    if (params.userId !== viewer.viewerId) {
      return reply.status(403).send(failure("forbidden", "Cannot read captured spots for another user"));
    }

    const spots = await listUserCapturedSpots({
      userId: params.userId,
      limit: query.limit
    });

    return success({
      routeName: "users.captured_spots.get",
      spots
    });
  });
}
