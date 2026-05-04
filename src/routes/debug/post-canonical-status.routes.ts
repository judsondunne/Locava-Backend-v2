import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { failure, success } from "../../lib/response.js";
import { toAppPostV2FromAny, toMasterPostV2FromAnyWithProvenance } from "../../lib/posts/app-post-v2/toAppPostV2.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { isPlaceholderLetterboxGradient } from "../../services/posting/select-publish-letterbox-gradients.js";

const PostIdParamsSchema = z.object({
  postId: z.string().min(8).max(160)
});

/** Non-production inspection: Master Post V2 vs legacy fields on a Firestore post doc. */
export async function registerDebugPostCanonicalStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/debug/posts/:postId/canonical-status", async (request, reply) => {
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
    const schema = raw.schema && typeof raw.schema === "object" ? (raw.schema as Record<string, unknown>) : null;
    const schemaVersion = schema?.version;
    const versionNum = typeof schemaVersion === "number" ? schemaVersion : typeof schemaVersion === "string" ? Number(schemaVersion) : NaN;
    const media = raw.media && typeof raw.media === "object" ? (raw.media as Record<string, unknown>) : null;
    const canonicalAssets = Array.isArray(media?.assets) ? (media.assets as unknown[]).length : 0;
    const legacyAssets = Array.isArray(raw.assets) ? (raw.assets as unknown[]).length : 0;
    const compat = raw.compatibility && typeof raw.compatibility === "object" ? (raw.compatibility as Record<string, unknown>) : null;

    const { master, normalizedFromLegacy } = toMasterPostV2FromAnyWithProvenance(raw, { postId });
    const appPost = toAppPostV2FromAny(raw, { postId });

    const rawGradients = Array.isArray(raw.letterboxGradients) ? (raw.letterboxGradients as unknown[]) : [];
    const gradientStatus =
      rawGradients.length === 0
        ? "missing_top_level_letterboxGradients"
        : rawGradients.every((g) => {
            if (!g || typeof g !== "object") return true;
            const o = g as Record<string, unknown>;
            return isPlaceholderLetterboxGradient({
              top: typeof o.top === "string" ? o.top : "",
              bottom: typeof o.bottom === "string" ? o.bottom : "",
              source: typeof o.source === "string" ? o.source : undefined
            });
          })
          ? "placeholder_only"
          : "has_non_placeholder";

    const warnings = [...(master.audit.warnings ?? []).map((w) => w.code)];

    return success({
      postId,
      hasSchema: Boolean(schema),
      schemaVersion: Number.isFinite(versionNum) ? versionNum : null,
      sourceShape: typeof schema?.sourceShape === "string" ? schema.sourceShape : null,
      hasCanonicalMedia: Boolean(media),
      canonicalAssetCount: canonicalAssets,
      legacyAssetCount: legacyAssets,
      hasCompatibilityAliases: Boolean(compat && typeof compat.photoLink === "string" && String(compat.photoLink).trim()),
      hasAppPostV2: Boolean(appPost?.id),
      normalizedFromLegacy,
      gradientStatus,
      warnings
    });
  });
}
