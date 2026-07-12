import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export type CompatPostCard = Record<string, unknown> & {
  id: string;
  postId: string;
};

const COMPAT_POST_FIELD_MASK = [
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
  "hidden",
] as const;

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

    const chunkSize = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += chunkSize) {
      chunks.push(unique.slice(i, i + chunkSize));
    }

    const chunkSnaps = await Promise.all(
      chunks.map(async (chunk) => {
        const refs = chunk.map((id) => db.collection("posts").doc(id));
        incrementDbOps("queries", 1);
        const snaps = await db.getAll(...refs, {
          fieldMask: [...COMPAT_POST_FIELD_MASK],
        });
        incrementDbOps("reads", snaps.length);
        return snaps;
      }),
    );

    const rows: CompatPostCard[] = [];
    for (const snaps of chunkSnaps) {
      for (const doc of snaps) {
        if (!doc.exists) continue;
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
