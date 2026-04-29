import { Timestamp } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { getOrSetEntityCache } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  if (value && typeof value === "object") {
    const any = value as { toMillis?: () => number; toDate?: () => Date };
    if (typeof any.toMillis === "function") return any.toMillis();
    if (typeof any.toDate === "function") return any.toDate().getTime();
  }
  return null;
}

function extractLastActiveMsFromUserDoc(doc: Record<string, unknown>): number | null {
  const msDirect = toMillis(doc.lastSeenMs);
  if (msDirect != null) return msDirect;
  const msFromLastSeen = toMillis(doc.lastSeen);
  if (msFromLastSeen != null) return msFromLastSeen;
  const msFromLastLoginAt = toMillis(doc.lastLoginAt);
  if (msFromLastLoginAt != null) return msFromLastLoginAt;
  const msFromLastLogin = toMillis(doc.lastLogin);
  if (msFromLastLogin != null) return msFromLastLogin;
  return null;
}

export class UserActivityRepository {
  private readonly db = getFirestoreSourceClient();

  async getLastActiveMs(userId: string): Promise<number | null> {
    if (!userId.trim()) return null;

    // Fast path: if we already have the cached user doc (seeded by other surfaces), derive from it.
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId));
    if (cachedUserDoc) {
      const derived = extractLastActiveMsFromUserDoc(cachedUserDoc);
      if (derived != null) return derived;
    }

    return getOrSetEntityCache(entityCacheKeys.userLastActiveMs(userId), 10_000, async () => {
      if (!this.db) return null;
      incrementDbOps("queries", 1);
      let snap;
      try {
        snap = await this.db.collection("users").doc(userId).get();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("PERMISSION_DENIED")) throw new SourceOfTruthRequiredError("users_last_active_firestore_permission");
        if (message.includes("timeout")) throw new SourceOfTruthRequiredError("users_last_active_firestore_timeout");
        throw error;
      }
      incrementDbOps("reads", snap.exists ? 1 : 0);
      if (!snap.exists) return null;
      const data = (snap.data() ?? {}) as Record<string, unknown>;

      // Best-effort: keep the raw doc warm for other callers (e.g. chat summary hydration).
      void globalCache.set(entityCacheKeys.userFirestoreDoc(userId), data, 25_000).catch(() => undefined);

      // Normalize Firestore Timestamp fields explicitly if present.
      if (data.lastSeen instanceof Timestamp) {
        data.lastSeen = data.lastSeen.toMillis();
      }
      return extractLastActiveMsFromUserDoc(data);
    });
  }
}

export const userActivityRepository = new UserActivityRepository();

