import type { ProfileHeaderRecord } from "../../repositories/surfaces/profile.repository.js";
import type { ProfileBootstrapResponse } from "../../contracts/surfaces/profile-bootstrap.contract.js";
import type { ProductCompatViewer } from "./compat-viewer-payload.js";

/**
 * Native `Viewer` shape for session bootstrap (subset of fields; extra compat fields tolerated).
 */
export type ProductSessionViewer = ProductCompatViewer;

export function profileHeaderToSessionViewer(header: ProfileHeaderRecord): ProductSessionViewer {
  const profilePic = header.profilePic ?? "";
  return {
    userId: header.userId,
    handle: header.handle,
    name: header.name,
    profilePic,
    onboardingComplete: true,
    createdAt: Date.now(),
    featureFlags: {},
    bio: header.bio
  };
}

/** Native profile bootstrap (`ProfileBootstrapResponse` in Locava-Native) from v2 orchestrator output. */
export function mapV2ProfileBootstrapToProductApi(v2: ProfileBootstrapResponse, viewerId: string): {
  viewer: {
    userId: string;
    handle: string;
    name: string;
    profilePic: string;
    bio?: string;
  };
  counts: { posts: number; followers: number; following: number };
  grid: {
    items: Array<{
      postId: string;
      updatedAtMs: number;
      mediaType: "image" | "video";
      thumbUrl: string;
      aspectRatio?: number;
      processing?: boolean;
      processingFailed?: boolean;
    }>;
    nextCursor: string | null;
  };
  serverTsMs: number;
  etagSeed: string;
} {
  const fr = v2.firstRender;
  const etagSeed = `profile:${viewerId}:v2:${fr.profile.handle}:${fr.counts.posts}:${fr.gridPreview.items.length}:${fr.gridPreview.nextCursor ?? "end"}`;
  return {
    viewer: {
      userId: fr.profile.userId,
      handle: fr.profile.handle,
      name: fr.profile.name,
      profilePic: fr.profile.profilePic ?? "",
      bio: fr.profile.bio
    },
    counts: fr.counts,
    grid: {
      items: fr.gridPreview.items.map((it) => ({
        postId: it.postId,
        updatedAtMs: it.updatedAtMs,
        mediaType: it.mediaType,
        thumbUrl: it.thumbUrl,
        aspectRatio: it.aspectRatio,
        processing: it.processing,
        processingFailed: it.processingFailed
      })),
      nextCursor: fr.gridPreview.nextCursor
    },
    serverTsMs: Date.now(),
    etagSeed
  };
}
