import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export class CompatUserFullRepository {
  private readonly db = getFirestoreSourceClient();

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("compat_user_full_firestore_unavailable");
    return this.db;
  }

  async loadUserSocialEdges(userId: string): Promise<{
    followers: string[];
    following: string[];
    followersCount: number;
    followingCount: number;
    lastLoginAt: number;
  }> {
    const db = this.requireDb();
    const snap = await db.collection("users").doc(userId).get();
    incrementDbOps("reads", 1);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const followersRaw = data.followers;
    const followingRaw = data.following;

    const followers = Array.isArray(followersRaw) ? followersRaw.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
    const following = Array.isArray(followingRaw) ? followingRaw.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
    const followersCount = Number(data.followersCount ?? followers.length) || followers.length;
    const followingCount = Number(data.followingCount ?? following.length) || following.length;
    const lastLoginAt = Number(data.lastLoginAt ?? data.updatedAt ?? 0) || 0;

    return {
      followers: followers.slice(0, 200),
      following: following.slice(0, 200),
      followersCount,
      followingCount,
      lastLoginAt,
    };
  }
}

