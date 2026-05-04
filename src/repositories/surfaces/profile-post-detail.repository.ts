import { incrementDbOps } from "../../observability/request-context.js";
import { recordFallback, recordTimeout } from "../../observability/request-context.js";
import { mutationStateRepository } from "../mutations/mutation-state.repository.js";
import { ProfilePostDetailFirestoreAdapter } from "../source-of-truth/profile-post-detail-firestore.adapter.js";
import { enforceSourceOfTruthStrictness } from "../source-of-truth/strict-mode.js";
import { commentsRepository } from "./comments.repository.js";

const HEAVY_USER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";

export type ProfilePostDetailRecord = {
  postId: string;
  userId: string;
  caption?: string;
  title?: string | null;
  description?: string | null;
  activities?: string[];
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  geoData?: Record<string, unknown>;
  coordinates?: Record<string, unknown>;
  createdAtMs: number;
  updatedAtMs?: number;
  mediaType: "image" | "video";
  thumbUrl: string;
  assetsReady?: boolean;
  playbackLab?: Record<string, unknown>;
  assetLocations?: Array<Record<string, unknown>>;
  assets: Array<{
    id: string;
    type: "image" | "video";
    original?: string;
    poster?: string;
    thumbnail?: string;
    aspectRatio?: number | null;
    durationSec?: number | null;
    width?: number | null;
    height?: number | null;
    orientation?: string | null;
    hasAudio?: boolean;
    codecs?: Record<string, unknown>;
    variantMetadata?: Record<string, unknown>;
    instantPlaybackReady?: boolean;
    playbackLab?: Record<string, unknown>;
    generated?: Record<string, unknown>;
    variants?: Record<string, unknown>;
  }>;
  author: {
    userId: string;
    handle: string;
    name: string;
    profilePic: string;
  };
  social: {
    likeCount: number;
    commentCount: number;
    viewerHasLiked: boolean;
  };
  sourceRawPost?: Record<string, unknown>;
};

export class ProfilePostDetailRepository {
  constructor(private readonly firestoreAdapter: ProfilePostDetailFirestoreAdapter = new ProfilePostDetailFirestoreAdapter()) {}

  private isValidProfilePost(userId: string, postId: string): boolean {
    return postId.startsWith(`${userId}-post-`);
  }

  async getPostDetail(userId: string, postId: string, viewerId: string): Promise<ProfilePostDetailRecord> {
    if (this.firestoreAdapter.isEnabled()) {
      try {
        const firestore = await this.firestoreAdapter.getPostDetail({ userId, postId, viewerId });
        incrementDbOps("queries", firestore.queryCount);
        incrementDbOps("reads", firestore.readCount);
        return {
          ...firestore.data,
          social: {
            likeCount: firestore.data.social.likeCount + mutationStateRepository.getPostLikeDelta(postId),
            commentCount: firestore.data.social.commentCount,
            viewerHasLiked: firestore.data.social.viewerHasLiked || mutationStateRepository.hasViewerLikedPost(viewerId, postId)
          }
        };
      } catch (error) {
        if (error instanceof Error && error.message === "post_not_found_for_profile") {
          throw error;
        }
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("profile_post_detail_firestore");
          this.firestoreAdapter.markUnavailableBriefly();
        }
        recordFallback("profile_post_detail_firestore_fallback");
        enforceSourceOfTruthStrictness("profile_post_detail_firestore");
      }
    }

    incrementDbOps("queries", 1);
    incrementDbOps("reads", 1);

    if (!this.isValidProfilePost(userId, postId)) {
      throw new Error("post_not_found_for_profile");
    }

    const indexPart = Number(postId.split("-post-")[1] ?? "1");
    const safeIndex = Number.isFinite(indexPart) && indexPart > 0 ? Math.floor(indexPart) : 1;
    const mediaType: "image" | "video" = safeIndex % 4 === 0 ? "video" : "image";
    const thumbUrl = `https://picsum.photos/seed/${encodeURIComponent(`${userId}-${safeIndex}`)}/500/888`;

    const seededAssets =
      mediaType === "video"
        ? [
            {
              id: `${postId}-asset-1`,
              type: "video" as const,
              poster: thumbUrl,
              thumbnail: thumbUrl,
              variants: {
                startup720FaststartAvc: `https://cdn.locava.dev/video/${postId}/startup-720.mp4`,
                main720Avc: `https://cdn.locava.dev/video/${postId}/main-720.mp4`,
                hls: `https://cdn.locava.dev/video/${postId}/master.m3u8`
              }
            }
          ]
        : [
            {
              id: `${postId}-asset-1`,
              type: "image" as const,
              poster: thumbUrl,
              thumbnail: thumbUrl
            }
          ];
    const likeCount = 12 + safeIndex + mutationStateRepository.getPostLikeDelta(postId);
    const commentCount = 2 + (safeIndex % 4);
    const createdAtMs = Date.now() - safeIndex * 3600_000;

    return {
      postId,
      userId,
      caption: `Post ${safeIndex} from ${userId}`,
      createdAtMs,
      mediaType,
      thumbUrl,
      assets: seededAssets,
      author: {
        userId,
        handle: userId === HEAVY_USER_ID ? "locava_heavy_profile" : `user_${userId.slice(0, 8)}`,
        name: userId === HEAVY_USER_ID ? "Heavy Profile User" : "Locava Profile User",
        profilePic: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&q=80"
      },
      social: {
        likeCount,
        commentCount,
        viewerHasLiked:
          mutationStateRepository.hasViewerLikedPost(viewerId, postId) || viewerId.length % 2 === 0
      },
      sourceRawPost: {
        id: postId,
        postId,
        userId,
        caption: `Post ${safeIndex} from ${userId}`,
        createdAtMs,
        mediaType,
        thumbUrl,
        displayPhotoLink: thumbUrl,
        assets: seededAssets.map((a) => ({
          id: a.id,
          type: a.type,
          poster: a.poster,
          thumbnail: a.thumbnail,
          ...(a.type === "video" ? { variants: a.variants } : {})
        })),
        likesCount: likeCount,
        commentsCount: commentCount
      }
    };
  }

  async getCommentsPreview(postId: string, slowMs = 0): Promise<Array<{ commentId: string; userId: string; text: string; createdAtMs: number }>> {
    const page = await commentsRepository.listTopLevelComments({
      viewerId: "anonymous",
      postId,
      cursor: null,
      limit: 10
    });
    if (slowMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, slowMs));
    }
    return page.items.map((item) => ({
      commentId: item.commentId,
      userId: item.author.userId,
      text: item.text,
      createdAtMs: item.createdAtMs
    }));
  }
}
