import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import type { CommentSummary } from "../../contracts/entities/comment-entities.contract.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import { incrementDbOps, recordSurfaceTimings } from "../../observability/request-context.js";
import { withTimeout } from "../../orchestration/timeouts.js";
import { AuthBootstrapFirestoreAdapter } from "../source-of-truth/auth-bootstrap-firestore.adapter.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

type CommentRecord = CommentSummary & {
  deletedAtMs: number | null;
};

type CommentStorageMode = "embedded" | "subcollection";

export class CommentRepositoryError extends Error {
  constructor(
    public readonly code: "invalid_cursor" | "comment_not_found" | "comment_not_owned" | "source_unavailable",
    message: string
  ) {
    super(message);
  }
}

const DUPLICATE_WINDOW_MS = 4_000;
export class CommentsRepository {
  private readonly db = getFirestoreSourceClient();
  private readonly authBootstrapAdapter = new AuthBootstrapFirestoreAdapter();
  private readonly commentsByPostFallback = new Map<string, CommentRecord[]>();
  private readonly commentById = new Map<string, CommentRecord>();
  private readonly commentWireById = new Map<string, Record<string, unknown>>();
  private readonly embeddedCommentWireById = new Map<string, Record<string, unknown>>();
  private readonly commentWiresByPost = new Map<string, Record<string, unknown>[]>();
  private readonly commentStorageById = new Map<string, CommentStorageMode>();
  private readonly commentStorageByPost = new Map<string, CommentStorageMode>();
  private readonly createIdempotencyByViewerKey = new Map<string, { commentId: string; createdAtMs: number }>();
  private readonly likedByCommentByViewer = new Map<string, Set<string>>();

  private assertOrUseFallback(): "firestore" | "fallback" {
    return this.db ? "firestore" : "fallback";
  }

  private mapWireToRecord(postId: string, wire: Record<string, unknown>, viewerId: string): CommentRecord {
    const commentId = String(wire.id ?? wire.commentId ?? "").trim();
    const authorId = String(wire.userId ?? "").trim();
    const likedBy = Array.isArray(wire.likedBy) ? wire.likedBy.filter((id): id is string => typeof id === "string") : [];
    const createdAtMs = Number(
      wire.createdAtMs ??
        (wire.time as { _seconds?: unknown; seconds?: unknown } | undefined)?._seconds ??
        (wire.time as { _seconds?: unknown; seconds?: unknown } | undefined)?.seconds
    );
    const safeCreatedAtMs =
      Number.isFinite(createdAtMs) && createdAtMs > 0
        ? Math.floor(
            createdAtMs > 10_000_000_000
              ? createdAtMs
              : createdAtMs * 1000
          )
        : Date.now();
    const record: CommentRecord = {
      commentId,
      postId,
      author: {
        userId: authorId,
        handle: String(wire.userHandle ?? wire.handle ?? `user_${authorId.slice(0, 8)}`),
        name: String(wire.userName ?? wire.handle ?? "User"),
        pic: String(wire.userPic ?? "").trim() || null
      },
      text: String(wire.content ?? wire.text ?? "").trim(),
      replyingTo: typeof wire.replyingTo === "string" ? wire.replyingTo : null,
      createdAtMs: safeCreatedAtMs,
      likeCount: likedBy.length,
      viewerState: {
        liked: likedBy.includes(viewerId),
        owned: authorId === viewerId
      },
      deletedAtMs: wire.deletedAt ? safeCreatedAtMs : null
    };
    if (commentId) {
      this.commentWireById.set(commentId, wire);
    }
    return record;
  }

  private async loadPostComments(postId: string, viewerId: string): Promise<CommentRecord[]> {
    const mode = this.assertOrUseFallback();
    if (mode === "fallback") {
      return (this.commentsByPostFallback.get(postId) ?? []).filter((comment) => comment.deletedAtMs == null);
    }
    const cachedWires = this.commentWiresByPost.get(postId);
    if (cachedWires) {
      const mapped = cachedWires
        .map((entry) => this.mapWireToRecord(postId, entry, viewerId))
        .filter((comment) => comment.commentId.length > 0 && comment.deletedAtMs == null)
        .sort((a, b) => (b.createdAtMs === a.createdAtMs ? b.commentId.localeCompare(a.commentId) : b.createdAtMs - a.createdAtMs));
      for (const comment of mapped) {
        this.commentById.set(comment.commentId, comment);
      }
      return mapped;
    }
    const postStorageMode = this.commentStorageByPost.get(postId);
    const prefersSubcollection = postStorageMode === "subcollection";
    const embeddedSource = prefersSubcollection
      ? { wires: [] as Record<string, unknown>[], hasEmbeddedField: false }
      : await this.loadEmbeddedCommentSource(postId);
    const embeddedWires = embeddedSource.wires;
    const subcollectionWires =
      prefersSubcollection || (!embeddedSource.hasEmbeddedField && embeddedWires.length === 0)
        ? await this.loadSubcollectionCommentWires(postId)
        : [];
    if (subcollectionWires.length > 0) {
      this.commentStorageByPost.set(postId, "subcollection");
    }
    const mergedWires: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const wire of subcollectionWires) {
      const id = String((wire as { id?: unknown; commentId?: unknown }).id ?? (wire as { id?: unknown; commentId?: unknown }).commentId ?? "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      this.commentStorageById.set(id, "subcollection");
      mergedWires.push(wire);
    }
    const fallbackWires = embeddedWires;
    for (const wire of fallbackWires) {
      const id = String((wire as { id?: unknown; commentId?: unknown }).id ?? (wire as { id?: unknown; commentId?: unknown }).commentId ?? "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      this.commentStorageById.set(id, "embedded");
      this.embeddedCommentWireById.set(id, wire);
      mergedWires.push(wire);
    }
    this.commentWiresByPost.set(postId, mergedWires);
    const mapped = mergedWires
      .map((entry) => this.mapWireToRecord(postId, entry, viewerId))
      .filter((comment) => comment.commentId.length > 0 && comment.deletedAtMs == null)
      .sort((a, b) => (b.createdAtMs === a.createdAtMs ? b.commentId.localeCompare(a.commentId) : b.createdAtMs - a.createdAtMs));
    for (const comment of mapped) {
      this.commentById.set(comment.commentId, comment);
    }
    return mapped;
  }

  private async resolveViewerAuthor(viewerId: string): Promise<CommentRecord["author"]> {
    const mode = this.assertOrUseFallback();
    if (mode === "firestore") {
      const summaryCacheKey = entityCacheKeys.userSummary(viewerId);
      const authBootstrapSummary = AuthBootstrapFirestoreAdapter.getCachedViewerSummary(viewerId);
      if (authBootstrapSummary) {
        return {
          userId: viewerId,
          handle: authBootstrapSummary.handle,
          name: authBootstrapSummary.name,
          pic: authBootstrapSummary.pic
        };
      }
      const [cached, cachedUserDoc] = await Promise.all([
        globalCache.get<{ userId: string; handle: string; name: string | null; pic: string | null }>(summaryCacheKey),
        globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId)),
      ]);
      if (cached) {
        return {
          userId: cached.userId,
          handle: cached.handle,
          name: cached.name ?? cached.handle ?? `User ${viewerId.slice(0, 8)}`,
          pic: cached.pic
        };
      }
      if (cachedUserDoc) {
        const handle = String(cachedUserDoc.handle ?? "").replace(/^@+/, "").trim();
        const name = String(cachedUserDoc.name ?? cachedUserDoc.displayName ?? "").trim();
        const pic = String(cachedUserDoc.profilePic ?? cachedUserDoc.profilePicture ?? cachedUserDoc.photo ?? "").trim();
        const author = {
          userId: viewerId,
          handle: handle || `user_${viewerId.slice(0, 8)}`,
          name: name || handle || `User ${viewerId.slice(0, 8)}`,
          pic: pic || null
        };
        void globalCache.set(summaryCacheKey, author, 300_000);
        return author;
      }

      // Last chance: fetch viewer summary fields from Firestore (bounded + cached via adapter).
      try {
        if (this.authBootstrapAdapter.isEnabled()) {
          await this.authBootstrapAdapter.getViewerBootstrapFields(viewerId);
          const refreshed = AuthBootstrapFirestoreAdapter.getCachedViewerSummary(viewerId);
          if (refreshed) {
            return { userId: viewerId, handle: refreshed.handle, name: refreshed.name, pic: refreshed.pic };
          }
          const afterCache = await globalCache.get<{ userId: string; handle: string; name: string | null; pic: string | null }>(
            summaryCacheKey
          );
          if (afterCache) {
            return {
              userId: afterCache.userId,
              handle: afterCache.handle,
              name: afterCache.name ?? afterCache.handle ?? `User ${viewerId.slice(0, 8)}`,
              pic: afterCache.pic
            };
          }
        }
      } catch {
        // ignore and fall through to fallback author
      }
      return {
        userId: viewerId,
        handle: `user_${viewerId.slice(0, 8)}`,
        name: `User ${viewerId.slice(0, 8)}`,
        pic: null
      };
    }
    return {
      userId: viewerId,
      handle: `user_${viewerId.slice(0, 8)}`,
      name: `User ${viewerId.slice(0, 8)}`,
      pic: null
    };
  }

  private mergeCachedCommentWire(postId: string, wire: Record<string, unknown>, storage: CommentStorageMode): void {
    const commentId = String((wire as { id?: unknown; commentId?: unknown }).id ?? (wire as { id?: unknown; commentId?: unknown }).commentId ?? "").trim();
    if (!commentId) {
      return;
    }
    const existing = this.commentWiresByPost.get(postId) ?? [];
    this.commentWiresByPost.set(
      postId,
      [wire, ...existing.filter((entry) => {
        const entryId = String((entry as { id?: unknown; commentId?: unknown }).id ?? (entry as { id?: unknown; commentId?: unknown }).commentId ?? "").trim();
        return entryId !== commentId;
      })]
    );
    this.commentWireById.set(commentId, wire);
    this.commentStorageById.set(commentId, storage);
    if (storage === "embedded") {
      this.embeddedCommentWireById.set(commentId, wire);
    }
  }

  private updateCachedCommentWire(postId: string, commentId: string, wire: Record<string, unknown>, storage?: CommentStorageMode): void {
    const existing = this.commentWiresByPost.get(postId) ?? [];
    if (existing.length > 0) {
      this.commentWiresByPost.set(
        postId,
        existing.map((entry) => {
          const entryId = String((entry as { id?: unknown; commentId?: unknown }).id ?? (entry as { id?: unknown; commentId?: unknown }).commentId ?? "").trim();
          return entryId === commentId ? wire : entry;
        })
      );
    }
    this.commentWireById.set(commentId, wire);
    if (storage) {
      this.commentStorageById.set(commentId, storage);
      if (storage === "embedded") {
        this.embeddedCommentWireById.set(commentId, wire);
      }
    }
  }

  private async loadEmbeddedCommentSource(postId: string): Promise<{
    wires: Record<string, unknown>[];
    hasEmbeddedField: boolean;
  }> {
    incrementDbOps("queries", 1);
    const snap = await this.db!.collection("posts").doc(postId).get();
    incrementDbOps("reads", 1);
    if (!snap.exists) {
      return { wires: [], hasEmbeddedField: false };
    }
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    return {
      wires: Array.isArray(data.comments)
        ? data.comments.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        : [],
      hasEmbeddedField: Object.prototype.hasOwnProperty.call(data, "comments")
    };
  }

  private async loadSubcollectionCommentWires(postId: string): Promise<Record<string, unknown>[]> {
    incrementDbOps("queries", 1);
    const snap = await this.db!.collection("posts").doc(postId).collection("comments").get();
    incrementDbOps("reads", snap.size);
    return snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>)
    }));
  }

  private async persistUpdatedEmbeddedCommentWire(input: {
    viewerId: string;
    postId: string;
    commentId: string;
    mutate: (wire: Record<string, unknown>) => Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (!this.db) {
      throw new CommentRepositoryError("source_unavailable", "Comments source is unavailable.");
    }
    const cachedComments = this.commentWiresByPost.get(input.postId);
    const comments = cachedComments ? [...cachedComments] : [];
    if (comments.length === 0) {
      incrementDbOps("queries", 1);
      const postSnap = await this.db.collection("posts").doc(input.postId).get();
      incrementDbOps("reads", 1);
      if (!postSnap.exists) {
        throw new CommentRepositoryError("comment_not_found", "Comment was not found.");
      }
      const data = (postSnap.data() ?? {}) as Record<string, unknown>;
      comments.push(...(Array.isArray(data.comments) ? data.comments : []));
    }
    const index = comments.findIndex((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const row = entry as { id?: unknown; commentId?: unknown };
      return String(row.id ?? row.commentId ?? "").trim() === input.commentId;
    });
    if (index < 0) {
      throw new CommentRepositoryError("comment_not_found", "Comment was not found.");
    }
    const currentWire = comments[index] as Record<string, unknown>;
    const nextWire = input.mutate(currentWire);
    comments[index] = nextWire;
    await this.db.collection("posts").doc(input.postId).set({ comments }, { merge: true });
    incrementDbOps("writes", 1);
    this.commentWiresByPost.set(input.postId, comments.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object"));
    this.commentWireById.set(input.commentId, nextWire);
    this.commentStorageById.set(input.commentId, "embedded");
    return nextWire;
  }

  async listTopLevelComments(input: {
    viewerId: string;
    postId: string;
    cursor: string | null;
    limit: number;
  }): Promise<{
    cursorIn: string | null;
    items: CommentRecord[];
    totalCount: number;
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const all = await this.loadPostComments(input.postId, input.viewerId);

    let start = 0;
    if (input.cursor) {
      let parsed;
      try {
        parsed = decodeCursor(input.cursor);
      } catch {
        throw new CommentRepositoryError("invalid_cursor", "Comments cursor is invalid.");
      }
      start = all.findIndex(
        (comment) =>
          comment.createdAtMs < parsed.createdAtMs ||
          (comment.createdAtMs === parsed.createdAtMs && comment.commentId < parsed.id)
      );
      if (start < 0) {
        start = all.length;
      }
    }

    const items = all.slice(start, start + input.limit).map((comment) => ({
      ...comment,
      viewerState: {
        ...comment.viewerState,
        owned: comment.author.userId === input.viewerId
      }
    }));
    incrementDbOps("reads", items.length > 0 ? items.length : 0);
    const hasMore = start + items.length < all.length;
    const tail = items[items.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor({ id: tail.commentId, createdAtMs: tail.createdAtMs }) : null;
    return {
      cursorIn: input.cursor,
      items,
      totalCount: all.length,
      hasMore,
      nextCursor
    };
  }

  async createComment(input: {
    viewerId: string;
    postId: string;
    text: string;
    replyingTo: string | null;
    clientMutationKey: string | null;
    nowMs?: number;
  }): Promise<{ comment: CommentRecord; idempotent: boolean }> {
    const nowMs = input.nowMs ?? Date.now();
    const normalizedText = input.text.trim().replace(/\s+/g, " ");
    const idempotencyKey = input.clientMutationKey ?? `${input.viewerId}:${input.postId}:${normalizedText.toLowerCase()}`;
    const mapKey = `${input.viewerId}:${input.postId}:${idempotencyKey}`;

    const existingRef = this.createIdempotencyByViewerKey.get(mapKey);
    if (existingRef && nowMs - existingRef.createdAtMs <= DUPLICATE_WINDOW_MS) {
      const existing = this.commentById.get(existingRef.commentId);
      if (existing && existing.deletedAtMs == null) {
        return { comment: existing, idempotent: true };
      }
    }

    const authorStartedAt = performance.now();
    const author = await this.resolveViewerAuthor(input.viewerId);
    const authorMs = performance.now() - authorStartedAt;
    const comment: CommentRecord = {
      commentId: `c_${randomUUID().slice(0, 12)}`,
      postId: input.postId,
      author,
      text: normalizedText,
      replyingTo: input.replyingTo ?? null,
      createdAtMs: nowMs,
      likeCount: 0,
      viewerState: {
        liked: false,
        owned: true
      },
      deletedAtMs: null
    };
    const mode = this.assertOrUseFallback();
    if (mode === "firestore") {
      const persistStartedAt = performance.now();
      const wireComment = {
        id: comment.commentId,
        content: comment.text,
        text: comment.text,
        userName: comment.author.name ?? comment.author.handle,
        userPic: comment.author.pic ?? "",
        userId: comment.author.userId,
        userHandle: comment.author.handle,
        likedBy: [] as string[],
        replyingTo: comment.replyingTo,
        createdAtMs: nowMs,
        postId: input.postId
      };
      const postRef = this.db!.collection("posts").doc(input.postId);
      const batch = this.db!.batch();
      batch.set(postRef.collection("comments").doc(comment.commentId), wireComment);
      batch.set(
        postRef,
        {
          commentCount: FieldValue.increment(1),
          commentsCount: FieldValue.increment(1),
          updatedAt: new Date()
        },
        { merge: true }
      );
      await batch.commit();
      incrementDbOps("writes", 2);
      this.commentStorageByPost.set(input.postId, "subcollection");
      this.mergeCachedCommentWire(input.postId, wireComment, "subcollection");
      recordSurfaceTimings({
        comments_create_author_ms: authorMs,
        comments_create_persist_ms: performance.now() - persistStartedAt
      });
    } else {
      const list = this.commentsByPostFallback.get(input.postId) ?? [];
      list.unshift(comment);
      this.commentsByPostFallback.set(input.postId, list);
      incrementDbOps("writes", 1);
      recordSurfaceTimings({
        comments_create_author_ms: authorMs,
        comments_create_persist_ms: 0
      });
    }
    this.commentById.set(comment.commentId, comment);
    this.createIdempotencyByViewerKey.set(mapKey, { commentId: comment.commentId, createdAtMs: nowMs });
    return { comment, idempotent: false };
  }

  async deleteComment(input: {
    viewerId: string;
    commentId: string;
    nowMs?: number;
  }): Promise<{ comment: CommentRecord; deleted: boolean; idempotent: boolean }> {
    const nowMs = input.nowMs ?? Date.now();
    const comment = this.commentById.get(input.commentId);
    if (!comment) {
      throw new CommentRepositoryError("comment_not_found", "Comment was not found.");
    }
    if (comment.author.userId !== input.viewerId) {
      throw new CommentRepositoryError("comment_not_owned", "Comment is not owned by this viewer.");
    }
    if (comment.deletedAtMs != null) {
      return { comment, deleted: false, idempotent: true };
    }
    const mode = this.assertOrUseFallback();
    if (mode === "firestore") {
      const storage = this.commentStorageById.get(comment.commentId) ?? "embedded";
      const wireComment = this.commentWireById.get(comment.commentId);
      if (storage === "subcollection") {
        const postRef = this.db!.collection("posts").doc(comment.postId);
        this.commentStorageByPost.set(comment.postId, "subcollection");
        const embeddedWire = this.embeddedCommentWireById.get(comment.commentId);
        if (embeddedWire) {
          const batch = this.db!.batch();
          batch.delete(postRef.collection("comments").doc(comment.commentId));
          batch.set(
            postRef,
            {
              comments: FieldValue.arrayRemove(embeddedWire),
              commentCount: FieldValue.increment(-1),
              commentsCount: FieldValue.increment(-1)
            },
            { merge: true }
          );
          await batch.commit();
          incrementDbOps("writes", 2);
        } else {
          await postRef.collection("comments").doc(comment.commentId).delete();
          incrementDbOps("writes", 1);
        }
      } else if (wireComment) {
        await this.db!.collection("posts").doc(comment.postId).set(
          {
            comments: FieldValue.arrayRemove(wireComment),
            commentCount: FieldValue.increment(-1),
            commentsCount: FieldValue.increment(-1)
          },
          { merge: true }
        );
        incrementDbOps("writes", 1);
      } else {
        const all = await this.loadPostComments(comment.postId, input.viewerId);
        const nextWire = all
          .filter((c) => c.commentId !== comment.commentId)
          .map((c) => ({
            id: c.commentId,
            content: c.text,
            userName: c.author.name ?? c.author.handle,
            userPic: c.author.pic ?? "",
            userId: c.author.userId,
            userHandle: c.author.handle,
            likedBy: c.viewerState.liked ? [input.viewerId] : [],
            replies: [] as unknown[],
            time: {
              seconds: Math.floor(c.createdAtMs / 1000),
              _seconds: Math.floor(c.createdAtMs / 1000)
            }
          }));
        await this.db!.collection("posts").doc(comment.postId).set(
          {
            comments: nextWire,
            commentCount: Math.max(0, nextWire.length),
            commentsCount: Math.max(0, nextWire.length)
          },
          { merge: true }
        );
        incrementDbOps("writes", 1);
      }
    } else {
      const list = this.commentsByPostFallback.get(comment.postId) ?? [];
      this.commentsByPostFallback.set(
        comment.postId,
        list.filter((c) => c.commentId !== comment.commentId)
      );
      incrementDbOps("writes", 1);
    }
    comment.deletedAtMs = nowMs;
    const cachedWires = this.commentWiresByPost.get(comment.postId);
    if (cachedWires) {
      this.commentWiresByPost.set(
        comment.postId,
        cachedWires.filter((wire) => String((wire as { id?: unknown; commentId?: unknown }).id ?? (wire as { id?: unknown; commentId?: unknown }).commentId ?? "").trim() !== comment.commentId)
      );
    }
    this.commentWireById.delete(comment.commentId);
    this.embeddedCommentWireById.delete(comment.commentId);
    this.commentStorageById.delete(comment.commentId);
    return { comment, deleted: true, idempotent: false };
  }

  async likeComment(input: {
    viewerId: string;
    commentId: string;
  }): Promise<{ comment: CommentRecord; liked: boolean; idempotent: boolean; likeCount: number }> {
    const comment = this.commentById.get(input.commentId);
    if (!comment || comment.deletedAtMs != null) {
      throw new CommentRepositoryError("comment_not_found", "Comment was not found.");
    }
    const key = `${comment.commentId}:${input.viewerId}`;
    const alreadyLiked = this.likedByCommentByViewer.has(key);
    const priorLikes = comment.likeCount ?? 0;
    if (alreadyLiked) {
      return {
        comment,
        liked: true,
        idempotent: true,
        likeCount: priorLikes
      };
    }
    this.likedByCommentByViewer.set(key, new Set([input.viewerId]));
    comment.likeCount = priorLikes + 1;
    comment.viewerState.liked = true;
    if (this.db) {
      const storage = this.commentStorageById.get(comment.commentId) ?? "embedded";
      let updatedWire: Record<string, unknown>;
      if (storage === "subcollection") {
        this.commentStorageByPost.set(comment.postId, "subcollection");
        await this.db.collection("posts").doc(comment.postId).collection("comments").doc(comment.commentId).update({
          likedBy: FieldValue.arrayUnion(input.viewerId)
        });
        incrementDbOps("writes", 1);
        const currentWire = this.commentWireById.get(comment.commentId) ?? {
          id: comment.commentId,
          content: comment.text,
          text: comment.text,
          userName: comment.author.name ?? comment.author.handle,
          userPic: comment.author.pic ?? "",
          userId: comment.author.userId,
          userHandle: comment.author.handle,
          likedBy: [],
          createdAtMs: comment.createdAtMs,
          postId: comment.postId
        };
        const likedBy = Array.isArray(currentWire.likedBy) ? currentWire.likedBy.filter((id): id is string => typeof id === "string") : [];
        updatedWire = {
          ...currentWire,
          likedBy: Array.from(new Set([...likedBy, input.viewerId]))
        };
        this.updateCachedCommentWire(comment.postId, comment.commentId, updatedWire, "subcollection");
      } else {
        const currentWire = this.commentWireById.get(comment.commentId) ?? {
          id: comment.commentId,
          content: comment.text,
          text: comment.text,
          userName: comment.author.name ?? comment.author.handle,
          userPic: comment.author.pic ?? "",
          userId: comment.author.userId,
          userHandle: comment.author.handle,
          likedBy: [],
          createdAtMs: comment.createdAtMs,
          postId: comment.postId
        };
        const likedBy = Array.isArray(currentWire.likedBy) ? currentWire.likedBy.filter((id): id is string => typeof id === "string") : [];
        updatedWire = {
          ...currentWire,
          likedBy: Array.from(new Set([...likedBy, input.viewerId]))
        };
        const cachedWires = this.commentWiresByPost.get(comment.postId) ?? [];
        const nextEmbeddedWires =
          cachedWires.length > 0
            ? cachedWires.map((entry) => {
                const entryId = String(
                  (entry as { id?: unknown; commentId?: unknown }).id ??
                    (entry as { id?: unknown; commentId?: unknown }).commentId ??
                    ""
                ).trim();
                return entryId === comment.commentId ? updatedWire : entry;
              })
            : [updatedWire];
        await this.db.collection("posts").doc(comment.postId).set(
          {
            comments: nextEmbeddedWires
          },
          { merge: true }
        );
        incrementDbOps("writes", 1);
        this.updateCachedCommentWire(comment.postId, comment.commentId, updatedWire, "embedded");
      }
      const persistedLikedBy = Array.isArray(updatedWire.likedBy)
        ? updatedWire.likedBy.filter((id): id is string => typeof id === "string")
        : [];
      comment.likeCount = persistedLikedBy.length;
    } else {
      incrementDbOps("writes", 1);
    }
    return {
      comment,
      liked: true,
      idempotent: false,
      likeCount: comment.likeCount
    };
  }

  async unlikeComment(input: {
    viewerId: string;
    commentId: string;
  }): Promise<{ comment: CommentRecord; liked: boolean; idempotent: boolean; likeCount: number }> {
    const comment = this.commentById.get(input.commentId);
    if (!comment || comment.deletedAtMs != null) {
      throw new CommentRepositoryError("comment_not_found", "Comment was not found.");
    }
    const key = `${comment.commentId}:${input.viewerId}`;
    const alreadyLiked = this.likedByCommentByViewer.has(key);
    const priorLikes = comment.likeCount ?? 0;
    if (!alreadyLiked) {
      return {
        comment,
        liked: false,
        idempotent: true,
        likeCount: priorLikes
      };
    }
    this.likedByCommentByViewer.delete(key);
    comment.likeCount = Math.max(0, priorLikes - 1);
    comment.viewerState.liked = false;
    if (this.db) {
      const storage = this.commentStorageById.get(comment.commentId) ?? "embedded";
      let updatedWire: Record<string, unknown>;
      if (storage === "subcollection") {
        this.commentStorageByPost.set(comment.postId, "subcollection");
        await this.db.collection("posts").doc(comment.postId).collection("comments").doc(comment.commentId).update({
          likedBy: FieldValue.arrayRemove(input.viewerId)
        });
        incrementDbOps("writes", 1);
        const currentWire = this.commentWireById.get(comment.commentId) ?? {
          id: comment.commentId,
          content: comment.text,
          text: comment.text,
          userName: comment.author.name ?? comment.author.handle,
          userPic: comment.author.pic ?? "",
          userId: comment.author.userId,
          userHandle: comment.author.handle,
          likedBy: [],
          createdAtMs: comment.createdAtMs,
          postId: comment.postId
        };
        const likedBy = Array.isArray(currentWire.likedBy) ? currentWire.likedBy.filter((id): id is string => typeof id === "string") : [];
        updatedWire = {
          ...currentWire,
          likedBy: likedBy.filter((id) => id !== input.viewerId)
        };
        this.updateCachedCommentWire(comment.postId, comment.commentId, updatedWire, "subcollection");
      } else {
        const currentWire = this.commentWireById.get(comment.commentId) ?? {
          id: comment.commentId,
          content: comment.text,
          text: comment.text,
          userName: comment.author.name ?? comment.author.handle,
          userPic: comment.author.pic ?? "",
          userId: comment.author.userId,
          userHandle: comment.author.handle,
          likedBy: [],
          createdAtMs: comment.createdAtMs,
          postId: comment.postId
        };
        const likedBy = Array.isArray(currentWire.likedBy) ? currentWire.likedBy.filter((id): id is string => typeof id === "string") : [];
        updatedWire = {
          ...currentWire,
          likedBy: likedBy.filter((id) => id !== input.viewerId)
        };
        const cachedWires = this.commentWiresByPost.get(comment.postId) ?? [];
        const nextEmbeddedWires =
          cachedWires.length > 0
            ? cachedWires.map((entry) => {
                const entryId = String(
                  (entry as { id?: unknown; commentId?: unknown }).id ??
                    (entry as { id?: unknown; commentId?: unknown }).commentId ??
                    ""
                ).trim();
                return entryId === comment.commentId ? updatedWire : entry;
              })
            : [updatedWire];
        await this.db.collection("posts").doc(comment.postId).set(
          {
            comments: nextEmbeddedWires
          },
          { merge: true }
        );
        incrementDbOps("writes", 1);
        this.updateCachedCommentWire(comment.postId, comment.commentId, updatedWire, "embedded");
      }
      const persistedLikedBy = Array.isArray(updatedWire.likedBy)
        ? updatedWire.likedBy.filter((id): id is string => typeof id === "string")
        : [];
      comment.likeCount = persistedLikedBy.length;
    } else {
      incrementDbOps("writes", 1);
    }
    return {
      comment,
      liked: false,
      idempotent: false,
      likeCount: comment.likeCount
    };
  }

  resetForTests(): void {
    this.commentById.clear();
    this.commentWireById.clear();
    this.embeddedCommentWireById.clear();
    this.commentWiresByPost.clear();
    this.commentStorageById.clear();
    this.commentStorageByPost.clear();
    this.commentsByPostFallback.clear();
    this.likedByCommentByViewer.clear();
    this.createIdempotencyByViewerKey.clear();
  }
}

export const commentsRepository = new CommentsRepository();
