import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

/**
 * Lightweight engagement signals for collections (opened, accent ensure).
 * Stored under `users/{viewerId}/collectionTelemetry/{collectionId}`.
 */
export class CollectionTelemetryRepository {
  private readonly db = getFirestoreSourceClient();

  async recordOpened(viewerId: string, collectionId: string): Promise<{ openCount: number; lastOpenedAtMs: number }> {
    const now = Date.now();
    if (!this.db) {
      return { openCount: 1, lastOpenedAtMs: now };
    }
    const ref = this.db.collection("users").doc(viewerId).collection("collectionTelemetry").doc(collectionId);
    incrementDbOps("writes", 1);
    await ref.set(
      {
        lastOpenedAt: Timestamp.fromMillis(now),
        lastOpenedAtMs: now,
        openCount: FieldValue.increment(1)
      },
      { merge: true }
    );
    incrementDbOps("queries", 1);
    const snap = await ref.get();
    incrementDbOps("reads", 1);
    const data = (snap.data() ?? {}) as { openCount?: unknown; lastOpenedAtMs?: unknown };
    const openCount = typeof data.openCount === "number" ? data.openCount : 1;
    const lastOpenedAtMs = typeof data.lastOpenedAtMs === "number" ? data.lastOpenedAtMs : now;
    return { openCount, lastOpenedAtMs };
  }

  async recordAccentEnsured(viewerId: string, collectionId: string): Promise<{ accentEnsuredAtMs: number }> {
    const now = Date.now();
    if (!this.db) {
      return { accentEnsuredAtMs: now };
    }
    const ref = this.db.collection("users").doc(viewerId).collection("collectionTelemetry").doc(collectionId);
    incrementDbOps("writes", 1);
    await ref.set(
      {
        accentEnsuredAt: Timestamp.fromMillis(now),
        accentEnsuredAtMs: now
      },
      { merge: true }
    );
    return { accentEnsuredAtMs: now };
  }
}

export const collectionTelemetryRepository = new CollectionTelemetryRepository();
