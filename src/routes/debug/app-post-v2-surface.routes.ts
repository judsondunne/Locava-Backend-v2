import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import type { PostEngagementSourceAuditV2 } from "../../contracts/master-post-v2.types.js";
import { hydrateAppPostsViewerState } from "../../lib/posts/app-post-v2/hydrateAppPostViewerState.js";
import { auditPostEngagementSourcesV2 } from "../../lib/posts/master-post-v2/auditPostEngagementSourcesV2.js";
import { buildSurfaceComparePayload, toAppPostV2FromAny } from "../../lib/posts/app-post-v2/toAppPostV2.js";

const ParamsSchema = z.object({ postId: z.string().min(1) });
const QuerySchema = z.object({
  viewerId: z.string().min(1).optional()
});

/**
 * GET /debug/app-post-v2/surface-compare/:postId
 * Compares projections derived from {@link AppPostV2} for QA / rollout verification.
 */
export async function registerAppPostV2SurfaceCompareRoutes(app: FastifyInstance): Promise<void> {
  const allow =
    app.config.NODE_ENV !== "production" || app.config.ENABLE_POST_REBUILDER_DEBUG_ROUTES === true;
  if (!allow) {
    app.log.info("app-post-v2 surface compare disabled in production (enable ENABLE_POST_REBUILDER_DEBUG_ROUTES)");
    return;
  }

  app.get<{ Params: { postId: string }; Querystring: { viewerId?: string } }>(
    "/debug/app-post-v2/surface-compare/:postId",
    async (request) => {
    const params = ParamsSchema.parse(request.params);
    const query = QuerySchema.parse(request.query ?? {});
    const db = getFirestoreSourceClient();
    if (!db) {
      return {
        routeName: "debug.app_post_v2.surface_compare",
        postId: params.postId,
        postContractVersion: 2 as const,
        error: "firestore_unavailable"
      };
    }
    const snap = await db.collection("posts").doc(params.postId).get();
    if (!snap.exists) {
      return {
        routeName: "debug.app_post_v2.surface_compare",
        postId: params.postId,
        postContractVersion: 2 as const,
        error: "post_not_found"
      };
    }
    const raw = (snap.data() ?? {}) as Record<string, unknown>;
    let engagementSourceAudit: PostEngagementSourceAuditV2 | null = null;
    try {
      engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, raw);
    } catch {
      engagementSourceAudit = null;
    }
    let appPost = toAppPostV2FromAny(raw, {
      postId: params.postId,
      engagementSourceAudit
    });
    const hydrationRequested = Boolean(query.viewerId?.trim());
    if (hydrationRequested && query.viewerId) {
      const { posts } = await hydrateAppPostsViewerState([appPost], { viewerId: query.viewerId.trim() });
      appPost = posts[0] ?? appPost;
    }
    const compare = buildSurfaceComparePayload(appPost);
    return {
      routeName: "debug.app_post_v2.surface_compare",
      postId: params.postId,
      postContractVersion: 2 as const,
      engagementSourceAuditPresent: Boolean(engagementSourceAudit),
      viewerHydrationRequested: hydrationRequested,
      viewerHydrationViewerId: hydrationRequested ? query.viewerId?.trim() ?? null : null,
      legacyCompatPostcard: compare.projections.feedCard?.legacyCompat ?? null,
      appPostFull: compare.appPostFull,
      projections: compare.projections
    };
  });
}
