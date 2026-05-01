import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { readMaybeMillis } from "./post-firestore-projection.js";
import { withTimeout } from "../../orchestration/timeouts.js";

export type FirestoreProfileCollectionPreviewItem = {
  collectionId: string;
  ownerId: string;
  name: string;
  description?: string | null;
  privacy: "friends" | "public";
  itemCount: number;
  coverUri: string | null;
  coverPostId?: string | null;
  coverMediaType?: "image" | "video" | null;
  coverThumbnailUrl?: string | null;
  updatedAtMs: number;
};

export type FirestoreProfileCollectionPreviewPage = {
  items: FirestoreProfileCollectionPreviewItem[];
  nextCursor: string | null;
  queryCount: number;
  readCount: number;
  emptyReason: string | null;
};

type CursorPayload = {
  updatedAtMs: number;
  collectionId: string;
};

const FIRESTORE_TIMEOUT_MS = 1200;
const MAX_SCAN_PADDING = 18;

function normalizePrivacy(value: unknown): "private" | "friends" | "public" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "public") return "public";
  if (normalized === "friends") return "friends";
  return "private";
}

function isVisibleToViewer(
  privacy: "private" | "friends" | "public",
  input: { viewerId: string; ownerId: string; viewerFollowsOwner: boolean }
): boolean {
  if (input.viewerId === input.ownerId) return true;
  if (privacy === "public") return true;
  if (privacy === "friends") return input.viewerFollowsOwner;
  return false;
}

function isSystemCollection(data: Record<string, unknown>): boolean {
  if (data.systemManaged === true) return true;
  if (typeof data.kind === "string" && data.kind === "system_mix") return true;
  if (data.systemMix && typeof data.systemMix === "object") return true;
  if (data.generatedBy && typeof data.generatedBy === "object") return true;
  return false;
}

function encodeCursor(input: CursorPayload): string {
  return `pcollections:v1:${Buffer.from(JSON.stringify(input), "utf8").toString("base64url")}`;
}

function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw?.trim()) return null;
  const match = /^pcollections:v1:(.+)$/.exec(raw.trim());
  if (!match?.[1]) throw new Error("invalid_cursor");
  const parsed = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as Partial<CursorPayload>;
  if (
    typeof parsed.updatedAtMs !== "number" ||
    !Number.isFinite(parsed.updatedAtMs) ||
    typeof parsed.collectionId !== "string" ||
    parsed.collectionId.trim().length === 0
  ) {
    throw new Error("invalid_cursor");
  }
  return {
    updatedAtMs: Math.max(0, Math.floor(parsed.updatedAtMs)),
    collectionId: parsed.collectionId.trim(),
  };
}

function toNonEmptyUrl(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export class ProfileCollectionsFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();

  isEnabled(): boolean {
    return Boolean(this.db);
  }

  async listCollections(input: {
    viewerId: string;
    userId: string;
    cursor: string | null;
    limit: number;
  }): Promise<FirestoreProfileCollectionPreviewPage> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const safeLimit = Math.max(1, Math.min(Math.floor(input.limit || 6), 12));
    const queryLimit = Math.min(36, safeLimit + 1 + MAX_SCAN_PADDING);
    const cursor = decodeCursor(input.cursor);
    const viewerFollowsOwner =
      input.viewerId === input.userId
        ? true
        : (
            await withTimeout(
              this.db.collection("users").doc(input.viewerId).collection("following").doc(input.userId).get(),
              FIRESTORE_TIMEOUT_MS,
              "profile-collections-relationship"
            )
          ).exists;

    let query = this.db
      .collection("collections")
      .where("ownerId", "==", input.userId)
      .orderBy("updatedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .select("ownerId", "userId", "name", "description", "privacy", "isPublic", "itemsCount", "coverUri", "displayPhotoUrl", "updatedAt")
      .limit(queryLimit);
    if (cursor) {
      query = query.startAfter(Timestamp.fromMillis(cursor.updatedAtMs), cursor.collectionId);
    }

    const snapshot = await withTimeout(query.get(), FIRESTORE_TIMEOUT_MS, "profile-collections-page");
    const visibleDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let lastScannedDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (const doc of snapshot.docs) {
      lastScannedDoc = doc;
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      if (isSystemCollection(data)) continue;
      const privacy = normalizePrivacy(data.privacy ?? (data.isPublic === true ? "public" : "private"));
      if (!isVisibleToViewer(privacy, { viewerId: input.viewerId, ownerId: input.userId, viewerFollowsOwner })) {
        continue;
      }
      visibleDocs.push(doc);
      if (visibleDocs.length >= safeLimit) break;
    }

    const items = visibleDocs.map((doc) => {
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const privacy = normalizePrivacy(data.privacy ?? (data.isPublic === true ? "public" : "private"));
      return {
        collectionId: doc.id,
        ownerId: String(data.ownerId ?? data.userId ?? input.userId),
        name: String(data.name ?? "Untitled collection"),
        description: typeof data.description === "string" ? data.description : null,
        privacy: privacy === "friends" ? "friends" : "public",
        itemCount: Math.max(0, Number(data.itemsCount ?? 0) || 0),
        coverUri: toNonEmptyUrl(data.coverUri) ?? toNonEmptyUrl(data.displayPhotoUrl) ?? null,
        coverPostId: null,
        coverMediaType: null,
        coverThumbnailUrl: null,
        updatedAtMs: readMaybeMillis(data.updatedAt) ?? 0,
      } satisfies FirestoreProfileCollectionPreviewItem;
    });

    const hasMore = snapshot.docs.length === queryLimit;
    const nextCursor = hasMore && lastScannedDoc
      ? encodeCursor({
          updatedAtMs: readMaybeMillis(lastScannedDoc.get("updatedAt")) ?? 0,
          collectionId: lastScannedDoc.id,
        })
      : null;
    return {
      items,
      nextCursor,
      queryCount: input.viewerId === input.userId ? 1 : 2,
      readCount: snapshot.docs.length + (input.viewerId === input.userId ? 0 : 1),
      emptyReason:
        items.length > 0
          ? null
          : viewerFollowsOwner || input.viewerId === input.userId
            ? "no_visible_collections_found"
            : "viewer_not_allowed_to_see_friends_only_collections",
    };
  }
}
