/**
 * Converts ISO / numeric-ms date fields on a post write payload into firebase-admin
 * `Timestamp` instances so `/posts/{id}` stores native Firestore timestamps (not strings).
 */

import { Timestamp } from "firebase-admin/firestore";

function toTimestamp(value: unknown): Timestamp | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Timestamp) return value;
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      return Timestamp.fromDate((value as { toDate: () => Date }).toDate());
    } catch {
      return undefined;
    }
  }
  const secLike = value as { seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number };
  if (typeof value === "object" && value !== null && typeof secLike.seconds === "number") {
    const nanos = typeof secLike.nanoseconds === "number" ? secLike.nanoseconds : Number(secLike._nanoseconds ?? 0);
    return new Timestamp(secLike.seconds, nanos);
  }
  if (typeof value === "object" && value !== null && typeof secLike._seconds === "number") {
    const nanos = Number(secLike._nanoseconds ?? 0);
    return new Timestamp(secLike._seconds, nanos);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return Timestamp.fromMillis(ms);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const ms = Date.parse(value.trim());
    if (Number.isFinite(ms)) return Timestamp.fromMillis(ms);
  }
  return undefined;
}

function assignTimestampField(obj: Record<string, unknown>, key: string): void {
  if (!(key in obj)) return;
  const current = obj[key];
  if (current === null || current === undefined) return;
  const ts = toTimestamp(current);
  if (ts) obj[key] = ts;
}

/**
 * Returns a JSON-cloned plain document with selected date paths replaced by Firestore Timestamps.
 * Does not mutate the input.
 */
export function encodeFirestoreTimestampsInPostWrite(doc: Record<string, unknown>): Record<string, unknown> {
  const live = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

  assignTimestampField(live, "time");
  assignTimestampField(live, "updatedAt");

  const lc = live.lifecycle;
  if (lc && typeof lc === "object" && !Array.isArray(lc)) {
    const lco = lc as Record<string, unknown>;
    for (const key of ["createdAt", "deletedAt", "updatedAt", "lastMediaUpdatedAt", "lastUserVisibleAt"]) {
      assignTimestampField(lco, key);
    }
  }

  const ep = live.engagementPreview;
  if (ep && typeof ep === "object" && !Array.isArray(ep)) {
    const epo = ep as Record<string, unknown>;
    const likers = epo.recentLikers;
    if (Array.isArray(likers)) {
      for (const row of likers) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          assignTimestampField(row as Record<string, unknown>, "likedAt");
        }
      }
    }
    const comments = epo.recentComments;
    if (Array.isArray(comments)) {
      for (const row of comments) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          assignTimestampField(row as Record<string, unknown>, "createdAt");
        }
      }
    }
  }

  return live;
}
