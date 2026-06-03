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

function resolveLikeCreatedAtMs(data: Record<string, unknown>): number | null {
  for (const key of ["createdAt", "likedAt", "updatedAt"]) {
    const ts = data[key] as { toMillis?: () => number } | undefined;
    if (typeof ts?.toMillis === "function") {
      return ts.toMillis();
    }
  }
  return null;
}

export class PostLikesRepository {
  async listLikesByPostId(input: { postId: string; limit: number }): Promise<{ likes: LikeRow[]; hasMore: boolean }> {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new SourceOfTruthRequiredError("post_likes_requires_source_of_truth");
    }

    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
    /**
     * Do not orderBy("createdAt") — Firestore excludes docs missing that field while aggregate
     * count() includes them, which yields count>0 but an empty likers list.
     */
    const snap = await db.collection("posts").doc(input.postId).collection("likes").get();
    incrementDbOps("reads", snap.size);
    incrementDbOps("queries", 1);

    const sorted = snap.docs
      .map((doc) => {
        const data = (doc.data() ?? {}) as Record<string, unknown>;
        return {
          doc,
          data,
          sortMs: resolveLikeCreatedAtMs(data) ?? 0,
        };
      })
      .sort((a, b) => b.sortMs - a.sortMs);

    const hasMore = sorted.length > limit;
    const slice = sorted.slice(0, limit);
    const likes: LikeRow[] = slice.map(({ doc, data }) => {
      const createdAtMs = resolveLikeCreatedAtMs(data);
      const userId = typeof data.userId === "string" ? data.userId : doc.id;
      const userHandle = typeof data.userHandle === "string" ? data.userHandle : null;
      const userName = typeof data.userName === "string" ? data.userName : null;
      const userPic = typeof data.userPic === "string" ? data.userPic : null;
      return { userId, userHandle, userName, userPic, createdAtMs };
    });

    return { likes, hasMore };
  }
}

