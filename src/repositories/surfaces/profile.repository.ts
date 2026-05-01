import { incrementDbOps } from "../../observability/request-context.js";
import { recordTimeout } from "../../observability/request-context.js";
import { mutationStateRepository } from "../mutations/mutation-state.repository.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { readMaybeMillis } from "../source-of-truth/post-firestore-projection.js";
import {
  ProfileFirestoreAdapter,
  parseProfileGridCursor
} from "../source-of-truth/profile-firestore.adapter.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";
import { withTimeout } from "../../orchestration/timeouts.js";

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

type ProfilePostWithLikeMeta = Record<string, unknown> & {
  time: unknown;
  createdAtMs: unknown;
  updatedAtMs: unknown;
  likedAt: unknown;
  likedAtMs: number;
};

export type ProfileConnectionsPage = {
  items: Array<{
    userId: string;
    handle: string;
    displayName: string | null;
    profilePic: string | null;
    isFollowing?: boolean;
  }>;
  totalCount: number;
  nextCursor: string | null;
};

export type ProfileLikedPostsPage = {
  posts: Array<Record<string, unknown>>;
  nextCursor: string | null;
  totalCount: number;
  serverTsMs: number;
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

  async getFollowers(input: { viewerId: string; userId: string; cursor: string | null; limit: number }): Promise<ProfileConnectionsPage> {
    if (!this.firestoreAdapter.isEnabled()) {
      throw new SourceOfTruthRequiredError("profile_followers_firestore_unavailable");
    }
    const firestore = await this.firestoreAdapter.listFollowers(input);
    incrementDbOps("queries", firestore.queryCount);
    incrementDbOps("reads", firestore.readCount);
    return { items: firestore.items, totalCount: firestore.totalCount, nextCursor: firestore.nextCursor };
  }

  async getFollowing(input: { viewerId: string; userId: string; cursor: string | null; limit: number }): Promise<ProfileConnectionsPage> {
    if (!this.firestoreAdapter.isEnabled()) {
      throw new SourceOfTruthRequiredError("profile_following_firestore_unavailable");
    }
    const firestore = await this.firestoreAdapter.listFollowing(input);
    incrementDbOps("queries", firestore.queryCount);
    incrementDbOps("reads", firestore.readCount);
    return { items: firestore.items, totalCount: firestore.totalCount, nextCursor: firestore.nextCursor };
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

  async getMyLikedPosts(input: {
    viewerId: string;
    cursor: string | null;
    limit: number;
  }): Promise<ProfileLikedPostsPage> {
    const db = getFirestoreSourceClient();
    if (!db) throw new SourceOfTruthRequiredError("profile_liked_posts_firestore_unavailable");

    const viewerId = input.viewerId.trim();
    const safeLimit = Math.max(1, Math.min(Math.floor(input.limit || 24), 48));
    const cursor = input.cursor;

    type LikedPostsCursor = { v: 1; lastDocId: string };
    const encodeCursor = (c: LikedPostsCursor): string =>
      Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
    const decodeCursor = (raw: string | null): LikedPostsCursor | null => {
      if (!raw || typeof raw !== "string") return null;
      try {
        const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as LikedPostsCursor;
        if (parsed?.v !== 1) return null;
        if (typeof parsed.lastDocId !== "string" || !parsed.lastDocId.trim()) return null;
        return { v: 1, lastDocId: parsed.lastDocId.trim() };
      } catch {
        return null;
      }
    };
    const numericOffsetFromCursor = (raw: string | null): number => {
      if (!raw) return 0;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.floor(n);
    };

    const loadLikedIds = async (): Promise<string[]> => {
      const merged = new Set<string>();
      const userDoc = await withTimeout(
        db.collection("users").doc(viewerId).get(),
        600,
        "profile-liked-posts-user-doc"
      );
      const fromUser = userDoc.exists ? ((userDoc.data() as { likedPosts?: unknown } | undefined)?.likedPosts ?? []) : [];
      if (Array.isArray(fromUser)) {
        for (const id of fromUser) {
          const s = String(id ?? "").trim();
          if (s) merged.add(s);
        }
      }
      try {
        const cg = await withTimeout(
          db.collectionGroup("likes").where("userId", "==", viewerId).get(),
          800,
          "profile-liked-posts-collection-group-likes"
        );
        for (const d of cg.docs) {
          const postId = d.ref.parent.parent?.id;
          if (postId) merged.add(postId);
        }
      } catch {
        // Collection group may require an index in some environments; user.likedPosts remains authoritative for new clients.
      }
      return [...merged];
    };

    const likedIds = await loadLikedIds();
    if (likedIds.length === 0) {
      return { posts: [], nextCursor: null, totalCount: 0, serverTsMs: Date.now() };
    }

    const likedMetaRef = db.collection("users").doc(viewerId).collection("likedPostsMeta");
    const decoded = decodeCursor(cursor);
    const legacyOffsetMode = cursor && !decoded && numericOffsetFromCursor(cursor) > 0;

    const loadPostsByIds = async (postIds: string[]): Promise<Array<Record<string, unknown>>> => {
      if (postIds.length === 0) return [];
      const refs = postIds.map((id) => db.collection("posts").doc(id));
      const snaps = await withTimeout(Promise.all(refs.map((r) => r.get())), 1200, "profile-liked-posts-post-docs");
      const byId = new Map<string, Record<string, unknown>>();
      snaps.forEach((snap) => {
        if (!snap.exists) return;
        const row = (snap.data() ?? {}) as Record<string, unknown>;
        byId.set(snap.id, { id: snap.id, postId: snap.id, ...row });
      });
      return postIds.map((id) => byId.get(id)).filter((x): x is Record<string, unknown> => Boolean(x));
    };

    // If cursor is numeric, preserve the legacy paging semantics as a fallback.
    if (legacyOffsetMode) {
      const offset = numericOffsetFromCursor(cursor);
      const orderedIds = [...likedIds].reverse();
      const pageIds = orderedIds.slice(offset, offset + safeLimit);
      const posts = await loadPostsByIds(pageIds);
      const nextOffset = offset + pageIds.length;
      return {
        posts,
        nextCursor: nextOffset < orderedIds.length ? String(nextOffset) : null,
        totalCount: orderedIds.length,
        serverTsMs: Date.now()
      };
    }

    let query = likedMetaRef.orderBy("likedAt", "desc").limit(safeLimit + 1);
    if (decoded?.lastDocId) {
      const cursorDoc = await withTimeout(
        likedMetaRef.doc(decoded.lastDocId).get(),
        600,
        "profile-liked-posts-cursor-doc"
      );
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const metaSnapshot = await withTimeout(query.get(), 900, "profile-liked-posts-meta-query");
    incrementDbOps("queries", 1);
    incrementDbOps("reads", metaSnapshot.docs.length);
    const metaDocs = metaSnapshot.docs;

    // If meta collection isn't populated yet, deterministically fall back to user.likedPosts ordering.
    if (metaDocs.length === 0 && !decoded) {
      const orderedIds = [...likedIds].reverse();
      const pageIds = orderedIds.slice(0, safeLimit);
      const posts = await loadPostsByIds(pageIds);
      return {
        posts,
        nextCursor: pageIds.length < orderedIds.length ? String(pageIds.length) : null,
        totalCount: orderedIds.length,
        serverTsMs: Date.now()
      };
    }

    const visibleMetaDocs = metaDocs.slice(0, safeLimit);
    const metaByPostId = new Map<string, { likedAt: unknown; likedAtMs: number }>();
    const pageIds: string[] = [];
    for (const doc of visibleMetaDocs) {
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const postId = String(data.postId ?? doc.id).trim();
      if (!postId) continue;
      pageIds.push(postId);
      const likedAt = data.likedAt ?? data.createdAt ?? null;
      metaByPostId.set(postId, { likedAt, likedAtMs: readMaybeMillis(likedAt) ?? 0 });
    }

    const rawPosts = await loadPostsByIds(pageIds);
    const postById = new Map<string, Record<string, unknown>>();
    for (const row of rawPosts) {
      const id = String(row.id ?? row.postId ?? "").trim();
      if (id) postById.set(id, row);
    }

    const posts: ProfilePostWithLikeMeta[] = pageIds
      .map<ProfilePostWithLikeMeta | null>((postId) => {
        const post = postById.get(postId);
        if (!post) return null;
        const meta = metaByPostId.get(postId);
        // Keep legacy-ish fields stable for existing native consumers.
        return {
          ...post,
          time: readMaybeMillis((post as { time?: unknown }).time) ?? (post as { time?: unknown }).time,
          createdAtMs: readMaybeMillis((post as { createdAtMs?: unknown }).createdAtMs) ?? (post as { createdAtMs?: unknown }).createdAtMs,
          updatedAtMs: readMaybeMillis((post as { updatedAtMs?: unknown }).updatedAtMs) ?? (post as { updatedAtMs?: unknown }).updatedAtMs,
          likedAt: meta?.likedAt ?? null,
          likedAtMs: meta?.likedAtMs ?? 0
        };
      })
      .filter((row): row is ProfilePostWithLikeMeta => row !== null);

    const hasMore = metaDocs.length > safeLimit;
    const lastVisible = visibleMetaDocs[visibleMetaDocs.length - 1];

    return {
      posts,
      nextCursor: hasMore && lastVisible ? encodeCursor({ v: 1, lastDocId: lastVisible.id }) : null,
      totalCount: likedIds.length,
      serverTsMs: Date.now()
    };
  }
}
