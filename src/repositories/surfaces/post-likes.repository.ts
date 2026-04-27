import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

type LikeRow = {
  userId: string;
  userHandle: string | null;
  userName: string | null;
  userPic: string | null;
  createdAtMs: number | null;
};

export class PostLikesRepository {
  async listLikesByPostId(input: { postId: string; limit: number }): Promise<{ likes: LikeRow[]; hasMore: boolean }> {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new SourceOfTruthRequiredError("post_likes_requires_source_of_truth");
    }

    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
    const snap = await db
      .collection("posts")
      .doc(input.postId)
      .collection("likes")
      .orderBy("createdAt", "desc")
      .limit(limit + 1)
      .get();
    incrementDbOps("reads", snap.size);
    incrementDbOps("queries", 1);

    const docs = snap.docs;
    const hasMore = docs.length > limit;
    const slice = docs.slice(0, limit);
    const likes: LikeRow[] = slice.map((doc) => {
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
      const createdAtMs = typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : null;
      const userId = typeof data.userId === "string" ? data.userId : doc.id;
      const userHandle = typeof data.userHandle === "string" ? data.userHandle : null;
      const userName = typeof data.userName === "string" ? data.userName : null;
      const userPic = typeof data.userPic === "string" ? data.userPic : null;
      return { userId, userHandle, userName, userPic, createdAtMs };
    });

    return { likes, hasMore };
  }
}

