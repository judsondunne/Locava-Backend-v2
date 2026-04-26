import { incrementDbOps } from "../../observability/request-context.js";
import { recordTimeout } from "../../observability/request-context.js";
import { mutationStateRepository } from "../mutations/mutation-state.repository.js";
import {
  ProfileFirestoreAdapter,
  parseProfileGridCursor
} from "../source-of-truth/profile-firestore.adapter.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export type ProfileHeaderRecord = {
  userId: string;
  handle: string;
  name: string;
  profilePic: string | null;
  bio?: string;
  counts: {
    posts: number;
    followers: number;
    following: number;
  };
};

export type RelationshipRecord = {
  isSelf: boolean;
  following: boolean;
  followedBy: boolean;
  canMessage: boolean;
};

export type ProfileGridPreviewItemRecord = {
  postId: string;
  thumbUrl: string;
  mediaType: "image" | "video";
  aspectRatio?: number;
  updatedAtMs: number;
  processing?: boolean;
  processingFailed?: boolean;
};

export type ProfileGridPreviewRecord = {
  items: ProfileGridPreviewItemRecord[];
  nextCursor: string | null;
};

export type ProfileGridPageInput = {
  userId: string;
  cursor: string | null;
  limit: number;
};

export class ProfileRepository {
  constructor(private readonly firestoreAdapter: ProfileFirestoreAdapter = new ProfileFirestoreAdapter()) {}

  /** @deprecated Use parseProfileGridCursor; numeric offset cursors are legacy-only. */
  parseGridCursor(cursor: string | null): number {
    const parsed = parseProfileGridCursor(cursor);
    if (parsed.mode === "legacy_offset") return parsed.offset;
    return 0;
  }

  async getProfileHeader(userId: string): Promise<ProfileHeaderRecord> {
    if (!this.firestoreAdapter.isEnabled()) {
      throw new SourceOfTruthRequiredError("profile_header_firestore_unavailable");
    }
    try {
      const firestore = await this.firestoreAdapter.getProfileHeader(userId);
      incrementDbOps("queries", firestore.queryCount);
      incrementDbOps("reads", firestore.readCount);
      return firestore.data;
    } catch (error) {
      if (error instanceof Error && error.message.includes("_timeout")) {
        recordTimeout("profile_header_firestore");
        this.firestoreAdapter.markUnavailableBriefly();
        // Retry once to avoid transient Firestore jitter failing strict parity paths.
        const retry = await this.firestoreAdapter.getProfileHeader(userId);
        incrementDbOps("queries", retry.queryCount);
        incrementDbOps("reads", retry.readCount);
        return retry.data;
      }
      throw new SourceOfTruthRequiredError("profile_header_firestore");
    }
  }

  async getRelationship(viewerId: string, targetUserId: string): Promise<RelationshipRecord> {
    if (viewerId === targetUserId) {
      return {
        isSelf: true,
        following: false,
        followedBy: false,
        canMessage: false
      };
    }
    if (!this.firestoreAdapter.isEnabled()) {
      throw new SourceOfTruthRequiredError("profile_relationship_firestore_unavailable");
    }
    try {
      const firestore = await this.firestoreAdapter.getRelationship(viewerId, targetUserId);
      incrementDbOps("queries", firestore.queryCount);
      incrementDbOps("reads", firestore.readCount);
      const followedByMutation = mutationStateRepository.isFollowing(viewerId, targetUserId);
      return {
        ...firestore.data,
        following: firestore.data.isSelf ? false : firestore.data.following || followedByMutation
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("_timeout")) {
        recordTimeout("profile_relationship_firestore");
        this.firestoreAdapter.markUnavailableBriefly();
        const retry = await this.firestoreAdapter.getRelationship(viewerId, targetUserId);
        incrementDbOps("queries", retry.queryCount);
        incrementDbOps("reads", retry.readCount);
        const followedByMutation = mutationStateRepository.isFollowing(viewerId, targetUserId);
        return {
          ...retry.data,
          following: retry.data.isSelf ? false : retry.data.following || followedByMutation
        };
      }
      throw new SourceOfTruthRequiredError("profile_relationship_firestore");
    }
  }

  async getGridPreview(userId: string, limit: number): Promise<ProfileGridPreviewRecord> {
    if (!this.firestoreAdapter.isEnabled()) {
      throw new SourceOfTruthRequiredError("profile_grid_preview_firestore_unavailable");
    }
    try {
      const firestore = await this.firestoreAdapter.getGridPreview(userId, limit);
      incrementDbOps("queries", firestore.queryCount);
      incrementDbOps("reads", firestore.readCount);
      return { items: firestore.items, nextCursor: firestore.nextCursor };
    } catch (error) {
      if (error instanceof Error && error.message.includes("_timeout")) {
        recordTimeout("profile_grid_preview_firestore");
        this.firestoreAdapter.markUnavailableBriefly();
        const retry = await this.firestoreAdapter.getGridPreview(userId, limit);
        incrementDbOps("queries", retry.queryCount);
        incrementDbOps("reads", retry.readCount);
        return { items: retry.items, nextCursor: retry.nextCursor };
      }
      throw new SourceOfTruthRequiredError("profile_grid_preview_firestore");
    }
  }

  async getGridPage(input: ProfileGridPageInput): Promise<ProfileGridPreviewRecord> {
    const { userId, cursor, limit } = input;
    const safeLimit = Math.max(1, Math.min(limit, 24));
    let gridCursor;
    try {
      gridCursor = parseProfileGridCursor(cursor);
    } catch {
      throw new Error("Invalid cursor format");
    }
    if (!this.firestoreAdapter.isEnabled()) {
      throw new SourceOfTruthRequiredError("profile_grid_page_firestore_unavailable");
    }
    try {
      const firestore = await this.firestoreAdapter.getGridPage(userId, gridCursor, safeLimit);
      incrementDbOps("queries", firestore.queryCount);
      incrementDbOps("reads", firestore.readCount);
      return { items: firestore.items, nextCursor: firestore.nextCursor };
    } catch (error) {
      if (error instanceof Error && error.message.includes("_timeout")) {
        recordTimeout("profile_grid_page_firestore");
        this.firestoreAdapter.markUnavailableBriefly();
        const retry = await this.firestoreAdapter.getGridPage(userId, gridCursor, safeLimit);
        incrementDbOps("queries", retry.queryCount);
        incrementDbOps("reads", retry.readCount);
        return { items: retry.items, nextCursor: retry.nextCursor };
      }
      throw new SourceOfTruthRequiredError("profile_grid_page_firestore");
    }
  }

  async getProfileBadgeSummary(userId: string, slowMs = 0): Promise<{ badge: string; score: number }> {
    incrementDbOps("queries", 1);
    incrementDbOps("reads", 1);

    if (slowMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, slowMs));
    }

    return {
      badge: "rising",
      score: 62
    };
  }
}
