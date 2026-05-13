import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { CollectionsGeneratedCreateService } from "../../services/surfaces/collections-generated-create.service.js";

const MixBodySchema = z.object({
  type: z.literal("mix"),
  prompt: z.string().trim().max(120).optional(),
  activity: z.string().trim().max(80).optional(),
  activities: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  postCount: z.coerce.number().int().min(4).max(24).optional().default(12),
  lat: z.coerce.number().finite().optional(),
  lng: z.coerce.number().finite().optional(),
  radiusMiles: z.coerce.number().min(1).max(50).optional(),
});

const BlendBodySchema = z.object({
  type: z.literal("blend"),
  userIds: z.array(z.string().min(1)).min(1).max(24),
  postCount: z.coerce.number().int().min(4).max(24).optional().default(12),
});

const GeneratedBodySchema = z.union([MixBodySchema, BlendBodySchema]);

export async function registerV2CollectionsGeneratedRoutes(app: FastifyInstance): Promise<void> {
  const service = new CollectionsGeneratedCreateService();

  app.post("/v2/collections/generated", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    setRouteName("collections.generated.post");
    const parsed = GeneratedBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const msg = parsed.error.flatten().formErrors[0] ?? parsed.error.message;
      return reply.status(400).send(failure("invalid_body", String(msg)));
    }
    const body = parsed.data;
    if (body.type === "mix") {
      const hasPrompt = !!(body.prompt && body.prompt.length > 0);
      const hasActivity = !!(body.activity && body.activity.length > 0);
      const hasActivities = Array.isArray(body.activities) && body.activities.length > 0;
      const hasGeo =
        typeof body.lat === "number" &&
        Number.isFinite(body.lat) &&
        typeof body.lng === "number" &&
        Number.isFinite(body.lng) &&
        typeof body.radiusMiles === "number" &&
        Number.isFinite(body.radiusMiles);
      if (!hasPrompt && !hasActivity && !hasActivities && !hasGeo) {
        return reply
          .status(400)
          .send(failure("invalid_body", "Add a mood, an activity, at least one activity, or a full location (lat, lng, radius)."));
      }
    }
    try {
      if (body.type === "blend") {
        const out = await service.createBlend({
          viewerId: viewer.viewerId,
          userIds: body.userIds,
          postCount: body.postCount,
        });
        if (!out.success) {
          return reply.status(400).send(failure("blend_create_failed", out.error));
        }
        return success({
          routeName: "collections.generated.post" as const,
          collectionId: out.collectionId,
        });
      }
      const activitiesList = [...(body.activities ?? [])].map((a) => String(a).trim()).filter(Boolean);
      const singleActivity = String(body.activity ?? "").trim();
      if (singleActivity && !activitiesList.includes(singleActivity)) {
        activitiesList.unshift(singleActivity);
      }
      const out = await service.createMix({
        viewerId: viewer.viewerId,
        activities: activitiesList,
        postCount: body.postCount,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        radiusMiles: body.radiusMiles ?? null,
        prompt: body.prompt ?? null,
      });
      if (!out.success) {
        return reply.status(400).send(failure("mix_create_failed", out.error));
      }
      return success({
        routeName: "collections.generated.post" as const,
        collectionId: out.collectionId,
      });
    } catch (error) {
      request.log.error(
        { event: "collections_generated_failed", error: error instanceof Error ? error.message : String(error) },
        "collections generated create failed",
      );
      return reply.status(503).send(failure("upstream_unavailable", "Could not create generated collection"));
    }
  });
}
