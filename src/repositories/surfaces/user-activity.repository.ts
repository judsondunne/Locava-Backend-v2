import { Timestamp } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
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

function objectField(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object") return null;
  return (input as Record<string, unknown>)[key];
}

function extractLastActiveMsFromUserDoc(doc: Record<string, unknown>): number | null {
  const presence = objectField(doc, "presence");
  const activity = objectField(doc, "activity");

  const candidates = [
    doc.lastActiveMs,
    doc.lastActiveAt,
    doc.lastActive,
    doc.last_active_ms,
    doc.last_active_at,
    doc.lastSeenMs,
    doc.lastSeenAt,
    doc.lastSeen,
    doc.last_seen_ms,
    doc.last_seen_at,
    doc.last_seen,
    doc.lastOnlineAt,
    doc.last_online_at,
    doc.lastLoginAt,
    doc.lastLogin,
    doc.last_login_at,
    doc.presenceUpdatedAt,
    doc.updatedAt,
    doc.updated_at,
    objectField(presence, "lastActiveMs"),
    objectField(presence, "lastActiveAt"),
    objectField(presence, "lastSeenMs"),
    objectField(presence, "lastSeenAt"),
    objectField(presence, "updatedAt"),
    objectField(presence, "updated_at"),
    objectField(activity, "lastActiveMs"),
    objectField(activity, "lastActiveAt"),
    objectField(activity, "lastSeenMs"),
    objectField(activity, "lastSeenAt"),
    objectField(activity, "updatedAt"),
    objectField(activity, "updated_at")
  ]
    .map((value) => toMillis(value))
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

export class UserActivityRepository {
  private readonly db = getFirestoreSourceClient();

  // Only the presence/last-active candidate fields (top-level + the `presence`/`activity` maps).
  // Keeps the Firestore read small and fast even for large user docs.
  private static readonly LAST_ACTIVE_FIELD_MASK = [
    "lastActiveMs",
    "lastActiveAt",
    "lastActive",
    "last_active_ms",
    "last_active_at",
    "lastSeenMs",
    "lastSeenAt",
    "lastSeen",
    "last_seen_ms",
    "last_seen_at",
    "last_seen",
    "lastOnlineAt",
    "last_online_at",
    "lastLoginAt",
    "lastLogin",
    "last_login_at",
    "presenceUpdatedAt",
    "updatedAt",
    "updated_at",
    "presence",
    "activity"
  ];

  async getLastActiveMs(userId: string): Promise<number | null> {
    if (!userId.trim()) return null;

    // Fast path: if we already have the cached user doc (seeded by other surfaces), derive from it.
    const cachedUserDoc = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId));
    if (cachedUserDoc) {
      const derived = extractLastActiveMsFromUserDoc(cachedUserDoc);
      if (derived != null) return derived;
    }

    // Manual cache management: a *positive* result is cached for 10s (fast + cheap on refresh), but a
    // null is NEVER cached — otherwise a single transient/empty read would make presence blank for the
    // whole TTL while the client only retries every 30s, which is exactly the "takes ~30s" symptom.
    const cacheKey = entityCacheKeys.userLastActiveMs(userId);
    const cached = await globalCache.get<number | null>(cacheKey);
    if (typeof cached === "number" && Number.isFinite(cached)) {
      return cached;
    }

    const result = await this.readLastActiveMsFromFirestore(userId);
    if (result != null) {
      await globalCache.set(cacheKey, result, 10_000);
    }
    return result;
  }

  /**
   * Reads presence via a small field-masked read first; if that yields nothing (field-mask quirks,
   * or a doc whose presence/updatedAt fields are nested unexpectedly), falls back to a full-doc read
   * once and seeds the shared full-doc cache so future surfaces stay fast. Returning a value reliably
   * is what keeps "last seen" instant instead of intermittently blank.
   */
  private async readLastActiveMsFromFirestore(userId: string): Promise<number | null> {
    if (!this.db) return null;
    const docRef = this.db.collection("users").doc(userId);

    incrementDbOps("queries", 1);
    let maskedSnap;
    try {
      const docs = await this.db.getAll(docRef, {
        fieldMask: UserActivityRepository.LAST_ACTIVE_FIELD_MASK,
      });
      maskedSnap = docs[0];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PERMISSION_DENIED")) throw new SourceOfTruthRequiredError("users_last_active_firestore_permission");
      if (message.includes("timeout")) throw new SourceOfTruthRequiredError("users_last_active_firestore_timeout");
      throw error;
    }
    incrementDbOps("reads", maskedSnap?.exists ? 1 : 0);

    if (maskedSnap?.exists) {
      const data = (maskedSnap.data() ?? {}) as Record<string, unknown>;
      if (data.lastSeen instanceof Timestamp) {
        data.lastSeen = data.lastSeen.toMillis();
      }
      const derived = extractLastActiveMsFromUserDoc(data);
      if (derived != null) return derived;
    }

    // Fallback: the masked read found no usable timestamp. Read the full doc once so we don't return
    // a spurious null when the data actually exists, and seed the shared full-doc cache.
    incrementDbOps("queries", 1);
    let fullSnap;
    try {
      fullSnap = await docRef.get();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PERMISSION_DENIED")) throw new SourceOfTruthRequiredError("users_last_active_firestore_permission");
      if (message.includes("timeout")) throw new SourceOfTruthRequiredError("users_last_active_firestore_timeout");
      throw error;
    }
    incrementDbOps("reads", fullSnap.exists ? 1 : 0);
    if (!fullSnap.exists) return null;
    const fullData = (fullSnap.data() ?? {}) as Record<string, unknown>;
    if (fullData.lastSeen instanceof Timestamp) {
      fullData.lastSeen = fullData.lastSeen.toMillis();
    }
    await globalCache.set(entityCacheKeys.userFirestoreDoc(userId), fullData, 30_000);
    return extractLastActiveMsFromUserDoc(fullData);
  }
}

export const userActivityRepository = new UserActivityRepository();

