import { Timestamp } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

/**
 * Persists feed "seen" clear markers on the viewer user document so the operation is not a fake ack.
 * Feed ranking integration can read `feedSeenClearedAtMs` / `feedSeenClearNonce` in a future pass.
 */
export class FeedSeenRepository {
  private readonly db = getFirestoreSourceClient();

  async clearForViewer(viewerId: string): Promise<{ clearedAtMs: number; nonce: number }> {
    const clearedAtMs = Date.now();
    if (!this.db) {
      return { clearedAtMs, nonce: 1 };
    }
    const ref = this.db.collection("users").doc(viewerId);
    incrementDbOps("queries", 1);
    const snap = await ref.get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    const prev = snap.exists ? Number((snap.data() as { feedSeenClearNonce?: unknown })?.feedSeenClearNonce ?? 0) : 0;
    const nonce = prev + 1;
    incrementDbOps("writes", 1);
    await ref.set(
      {
        feedSeenClearedAt: Timestamp.fromMillis(clearedAtMs),
        feedSeenClearedAtMs: clearedAtMs,
        feedSeenClearNonce: nonce
      },
      { merge: true }
    );
    return { clearedAtMs, nonce };
  }
}

export const feedSeenRepository = new FeedSeenRepository();
