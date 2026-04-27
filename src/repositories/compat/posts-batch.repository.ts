import { FieldPath } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export type CompatPostCard = Record<string, unknown> & {
  id: string;
  postId: string;
};

export class CompatPostsBatchRepository {
  private readonly db = getFirestoreSourceClient();

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("compat_posts_batch_firestore_unavailable");
    return this.db;
  }

  async loadPostsByIds(input: { postIds: string[]; limit?: number }): Promise<CompatPostCard[]> {
    const db = this.requireDb();
    const unique = [...new Set(input.postIds.map((v) => String(v ?? "").trim()).filter(Boolean))].slice(
      0,
      Math.max(1, Math.min(60, input.limit ?? 60))
    );
    if (unique.length === 0) return [];

    const rows: CompatPostCard[] = [];
    for (let i = 0; i < unique.length; i += 10) {
      const chunk = unique.slice(i, i + 10);
      const snap = await db
        .collection("posts")
        .where(FieldPath.documentId(), "in", chunk)
        .select(
          FieldPath.documentId(),
          "userId",
          "ownerId",
          "userHandle",
          "userName",
          "userPic",
          "title",
          "caption",
          "description",
          "activities",
          "thumbUrl",
          "displayPhotoLink",
          "photoLink",
          "mediaType",
          "likeCount",
          "likesCount",
          "commentCount",
          "commentsCount",
          "updatedAtMs",
          "createdAtMs",
          "time",
          "lat",
          "lng",
          "long",
          "stateRegionId",
          "cityRegionId",
          "privacy",
          "deleted",
          "isDeleted",
          "archived",
          "hidden"
        )
        .get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", snap.docs.length);
      for (const doc of snap.docs) {
        const data = (doc.data() ?? {}) as Record<string, unknown>;
        const privacy = String(data.privacy ?? "public").toLowerCase();
        if (
          Boolean(data.deleted) ||
          Boolean(data.isDeleted) ||
          Boolean(data.archived) ||
          Boolean(data.hidden) ||
          privacy === "private"
        ) {
          continue;
        }
        rows.push({ id: doc.id, postId: doc.id, ...data });
      }
    }

    const byId = new Map(rows.map((r) => [r.postId, r]));
    return unique.map((id) => byId.get(id)).filter(Boolean) as CompatPostCard[];
  }
}

