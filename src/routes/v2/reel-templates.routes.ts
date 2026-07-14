import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  reelTemplatesListContract,
  ReelTemplatesListQuerySchema,
  REEL_TEMPLATES_SCAN_LIMIT,
  REEL_TEMPLATES_DEFAULT_LIMIT
} from "../../contracts/surfaces/reel-templates.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { getFirebaseAdminFirestore } from "../../lib/firebase-admin.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";

function toEpochMs(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    const candidate = value as { toMillis?: () => number };
    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) ? millis : 0;
    }
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

function isPublicReel(doc: Record<string, unknown>): boolean {
  const privacy = String(doc.privacy ?? "public").toLowerCase().trim();
  // Native posts persist "Public Spot" / "Friends Spot" / "Secret Spot".
  // Accept both normalized tokens and the historical "public"/"everyone" values.
  return (
    privacy === "public" ||
    privacy === "everyone" ||
    privacy === "" ||
    privacy === "public spot"
  );
}

function firstVideoAsset(doc: Record<string, unknown>): { original?: string; poster?: string } | null {
  const assets = Array.isArray(doc.assets) ? (doc.assets as Record<string, unknown>[]) : [];
  const video = assets.find(
    (asset) => String(asset.type ?? "").toLowerCase() === "video"
  );
  if (!video) return null;
  return {
    original: typeof video.original === "string" ? video.original : undefined,
    poster: typeof video.poster === "string" ? video.poster : undefined
  };
}

export async function registerV2ReelTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.get(reelTemplatesListContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }

    const query = ReelTemplatesListQuerySchema.parse(request.query);
    setRouteName(reelTemplatesListContract.routeName);

    const limit = query.limit ?? REEL_TEMPLATES_DEFAULT_LIMIT;
    const db = getFirebaseAdminFirestore();

    // Prefer Firestore orderBy(createdAtMs desc) so the scanned pool is actually recent
    // as the reel corpus grows. Falls back to equality-only + in-memory sort if the
    // composite index (reel + createdAtMs) is not yet deployed.
    const posts = db.collection("posts");
    let snapshot;
    try {
      snapshot = await posts
        .where("reel", "==", true)
        .orderBy("createdAtMs", "desc")
        .limit(REEL_TEMPLATES_SCAN_LIMIT)
        .get();
    } catch {
      snapshot = await posts.where("reel", "==", true).limit(REEL_TEMPLATES_SCAN_LIMIT).get();
    }

    const templates = snapshot.docs
      .map((doc) => doc.data() as Record<string, unknown>)
      .filter((doc) => {
        if (!isPublicReel(doc)) return false;
        const editProject = doc.editProject;
        return (
          editProject != null &&
          typeof editProject === "object" &&
          !Array.isArray(editProject) &&
          Object.keys(editProject as Record<string, unknown>).length > 0
        );
      })
      .sort((a, b) => toEpochMs(b.createdAtMs ?? b.createdAt) - toEpochMs(a.createdAtMs ?? a.createdAt))
      .slice(0, limit)
      .map((doc) => {
        const video = firstVideoAsset(doc);
        const authorName = firstString(doc.userName, doc.authorName);
        const posterUrl = firstString(
          doc.posterUrl,
          doc.displayPhotoLink,
          doc.thumbUrl,
          video?.poster
        );
        const previewVideoUrl = firstString(doc.fallbackVideoUrl, video?.original) || undefined;
        const caption = firstString(doc.caption, doc.content, doc.title);
        const name = caption || (authorName ? `${authorName}'s reel` : "Reel");
        return {
          postId: firstString(doc.postId, doc.id) || "unknown",
          name,
          posterUrl,
          ...(previewVideoUrl ? { previewVideoUrl } : {}),
          ...(authorName ? { authorName } : {}),
          ...(firstString(doc.userHandle, doc.authorHandle)
            ? { authorHandle: firstString(doc.userHandle, doc.authorHandle) }
            : {}),
          createdAtMs: toEpochMs(doc.createdAtMs ?? doc.createdAt),
          editProject: doc.editProject as Record<string, unknown>
        };
      });

    return success({
      routeName: "reel.templates.list.get" as const,
      templates
    });
  });
}
