import { FieldPath } from "firebase-admin/firestore";
import { incrementDbOps } from "../observability/request-context.js";
import { getFirestoreSourceClient } from "./source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "./source-of-truth/strict-mode.js";

export class MixesRepository {
  private readonly db = getFirestoreSourceClient();

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("mixes_firestore_unavailable");
    return this.db;
  }

  async loadViewerActivityProfile(viewerId: string): Promise<string[]> {
    const db = this.requireDb();
    const snap = await db.collection("users").doc(viewerId).select("activityProfile").get();
    incrementDbOps("reads", 1);
    const data = snap.data() as Record<string, unknown> | undefined;
    const profile = Array.isArray(data?.activityProfile) ? (data?.activityProfile as unknown[]) : [];
    return profile.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean).slice(0, 8);
  }

  async loadViewerFollowingUserIds(viewerId: string, limit = 120): Promise<string[]> {
    const db = this.requireDb();
    const snap = await db.collection("users").doc(viewerId).select("following").get();
    incrementDbOps("reads", 1);
    const data = snap.data() as Record<string, unknown> | undefined;
    const raw = data?.following;
    const ids: string[] = [];
    if (Array.isArray(raw)) {
      for (const v of raw) ids.push(String(v ?? ""));
    } else if (raw && typeof raw === "object") {
      for (const v of Object.values(raw as Record<string, unknown>)) ids.push(String(v ?? ""));
    }
    return ids.map((v) => v.trim()).filter(Boolean).slice(0, Math.max(1, limit));
  }

  async loadRecentPostsByUserIds(input: { userIds: string[]; limit: number }): Promise<Array<Record<string, unknown>>> {
    const db = this.requireDb();
    const unique = [...new Set(input.userIds.map((id) => String(id).trim()).filter(Boolean))].slice(0, 60);
    if (unique.length === 0) return [];

    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < unique.length; i += 10) {
      const chunk = unique.slice(i, i + 10);
      const snap = await db
        .collection("posts")
        .where("userId", "in", chunk)
        .orderBy("time", "desc")
        .select(
          FieldPath.documentId(),
          "userId",
          "title",
          "caption",
          "description",
          "activities",
          "thumbUrl",
          "displayPhotoLink",
          "photoLink",
          "mediaType",
          "likesCount",
          "likeCount",
          "commentsCount",
          "commentCount",
          "updatedAtMs",
          "createdAtMs",
          "time",
          "lat",
          "lng",
          "long",
          "stateRegionId",
          "cityRegionId"
        )
        .limit(Math.max(6, Math.min(40, input.limit)))
        .get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", snap.docs.length);
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        out.push({ id: doc.id, postId: doc.id, ...data });
      }
    }
    return out.slice(0, Math.max(1, input.limit));
  }
}

