import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { failure, success } from "../../lib/response.js";
import { toAppPostV2FromAny } from "../../lib/posts/app-post-v2/toAppPostV2.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { isPlaceholderLetterboxGradient } from "../../services/posting/select-publish-letterbox-gradients.js";

const PostIdParamsSchema = z.object({
  postId: z.string().min(8).max(160)
});

/** Dev-only inspection for letterbox gradient persistence (Firestore raw vs Master/App projections). */
export async function registerDebugPostGradientAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/debug/posts/:postId/gradient-audit", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!viewer.viewerId) {
      return reply.status(401).send(failure("unauthorized", "Authentication required"));
    }
    const params = PostIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send(failure("invalid_params", "Invalid post id"));
    }
    const { postId } = params.data;
    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("firestore_unavailable", "Firestore client not configured"));
    }
    const snap = await db.collection("posts").doc(postId).get();
    if (!snap.exists) {
      return reply.status(404).send(failure("post_not_found", "Post document was not found"));
    }
    const raw = (snap.data() ?? {}) as Record<string, unknown>;
    const rawLetterboxGradients = raw.letterboxGradients;
    const rawCarouselFitWidth = raw.carouselFitWidth;
    const assetsRaw = Array.isArray(raw.assets) ? (raw.assets as Record<string, unknown>[]) : [];
    const rawAssetsPresentation = assetsRaw.map((a) => {
      const pres = a.presentation && typeof a.presentation === "object" ? (a.presentation as Record<string, unknown>) : null;
      return pres?.letterboxGradient ?? null;
    });

    const rawPairs = Array.isArray(rawLetterboxGradients) ? (rawLetterboxGradients as unknown[]) : [];
    const isRawPlaceholder =
      rawPairs.length === 0 ||
      rawPairs.every((g) => {
        if (!g || typeof g !== "object") return true;
        const o = g as Record<string, unknown>;
        return isPlaceholderLetterboxGradient({
          top: typeof o.top === "string" ? o.top : "",
          bottom: typeof o.bottom === "string" ? o.bottom : "",
          source: typeof o.source === "string" ? o.source : undefined
        });
      });

    const canon = normalizeMasterPostV2(raw as never, { postId });
    const masterCoverGradient = canon.canonical.media.cover.gradient;

    const appPost = toAppPostV2FromAny(raw, { postId });
    const appCover = appPost.media.cover.gradient;
    const appAssetGradients = appPost.media.assets.map((a) => a.presentation?.letterboxGradient ?? null);

    let recommendation = "ok";
    if (isRawPlaceholder) {
      recommendation = "raw_doc_still_placeholder_or_missing_real_gradient";
    } else if (
      !masterCoverGradient ||
      isPlaceholderLetterboxGradient({
        top: masterCoverGradient.top ?? "",
        bottom: masterCoverGradient.bottom ?? ""
      })
    ) {
      recommendation = "master_cover_gradient_lost_check_normalizer";
    }

    return success({
      postId,
      rawLetterboxGradients,
      rawCarouselFitWidth,
      rawAssetsPresentation,
      isRawPlaceholder,
      masterPostCoverGradient: masterCoverGradient,
      appPostCoverGradient: appCover,
      appPostAssetGradients: appAssetGradients,
      recommendation
    });
  });
}
