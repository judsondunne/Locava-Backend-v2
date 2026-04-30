import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export type SearchHomeV1UserSummary = {
  id: string;
  name: string;
  handle: string;
  profilePic: string | null;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
};

function asNonnegInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

export class SearchHomeV1UsersRepository {
  private readonly db = getFirestoreSourceClient();

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("search_home_v1_users_firestore_unavailable");
    return this.db;
  }

  /**
   * Batch-load compact user docs for search home (bounded chunks of 10 for getAll).
   */
  async loadUserSummaries(userIds: string[]): Promise<Map<string, SearchHomeV1UserSummary>> {
    const unique = [...new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))].slice(0, 48);
    const out = new Map<string, SearchHomeV1UserSummary>();
    if (unique.length === 0) return out;

    const db = this.requireDb();
    const chunkSize = 10;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const refs = chunk.map((id) => db.collection("users").doc(id));
      const snaps = await db.getAll(...refs);
      incrementDbOps("queries", 1);
      incrementDbOps("reads", snaps.length);

      for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data() as Record<string, unknown>;
        const id = snap.id;
        const name = asString(data.name ?? data.displayName ?? "");
        const handleRaw = asString(data.handle ?? data.username ?? data.searchHandle ?? "");
        const handle = handleRaw.startsWith("@") ? handleRaw : handleRaw ? `@${handleRaw}` : "";
        const profilePic = asString(data.profilePic ?? data.photoURL ?? data.photo ?? data.userPic ?? "") || null;
        const bio = asString(data.bio ?? data.bioText ?? "");
        const followerCount = asNonnegInt(
          data.followerCount ?? data.followersCount ?? data.numFollowers ?? (Array.isArray(data.followers) ? (data.followers as unknown[]).length : 0),
        );
        const followingCount = asNonnegInt(
          data.followingCount ?? data.following ?? data.numFollowing ?? (Array.isArray(data.following) ? (data.following as unknown[]).length : 0),
        );
        const postCount = asNonnegInt(data.postCount ?? data.postsCount ?? data.numPosts);
        out.set(id, {
          id,
          name: name || handle || id,
          handle: handle || `@${id.slice(0, 8)}`,
          profilePic,
          bio,
          followerCount,
          followingCount,
          postCount,
        });
      }
    }
    return out;
  }
}
