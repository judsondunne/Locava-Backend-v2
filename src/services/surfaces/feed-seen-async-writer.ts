import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

type Queued = {
  viewerId: string;
  postIds: string[];
  surface: string;
};

const queue: Queued[] = [];
let scheduled = false;
let processing = false;

const stats = {
  queuedTotal: 0,
  flushAttempts: 0,
  succeeded: 0,
  failed: 0,
  lastError: null as string | null
};

function scheduleDrain(): void {
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    void drainQueue();
  });
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  const next = queue.shift();
  if (!next) return;
  processing = true;
  stats.flushAttempts += 1;
  try {
    const db = getFirestoreSourceClient();
    if (!db) {
      stats.failed += 1;
      stats.lastError = "firestore_unavailable";
      return;
    }
    const viewerId = next.viewerId.trim();
    const surface = next.surface.trim();
    const uniquePostIds = [...new Set(next.postIds.map((value) => value.trim()).filter(Boolean))].slice(0, 5);
    if (!viewerId || !surface || uniquePostIds.length === 0) {
      stats.succeeded += 1;
      return;
    }
    const batch = db.batch();
    for (const postId of uniquePostIds) {
      batch.set(
        db.collection("feedSeen").doc(`${viewerId}_${postId}`),
        {
          viewerId,
          postId,
          surface,
          firstServedAt: FieldValue.serverTimestamp(),
          lastServedAt: FieldValue.serverTimestamp(),
          servedCount: FieldValue.increment(1)
        },
        { merge: true }
      );
    }
    await batch.commit();
    stats.succeeded += 1;
    stats.lastError = null;
  } catch (error) {
    stats.failed += 1;
    stats.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    processing = false;
    if (queue.length > 0) scheduleDrain();
  }
}

/**
 * Durable feedSeen writes must never block P1 feed responses. Queue + flush on the macro-task queue.
 */
export function enqueueFeedSeenServedMarks(input: { viewerId: string; postIds: string[]; surface: string }): {
  queued: number;
} {
  const viewerId = input.viewerId.trim();
  const surface = input.surface.trim();
  const uniquePostIds = [...new Set(input.postIds.map((value) => value.trim()).filter(Boolean))].slice(0, 5);
  if (!viewerId || !surface || uniquePostIds.length === 0) return { queued: 0 };
  queue.push({ viewerId, postIds: uniquePostIds, surface });
  stats.queuedTotal += uniquePostIds.length;
  scheduleDrain();
  return { queued: uniquePostIds.length };
}

export function getFeedSeenAsyncWriterStats(): typeof stats {
  return { ...stats };
}

/** Test helper: wait until the writer finishes its current queue. */
export async function drainFeedSeenAsyncWriterForTests(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (!processing && queue.length === 0) return;
    await new Promise<void>((r) => setImmediate(r));
  }
}

export function resetFeedSeenAsyncWriterForTests(): void {
  queue.length = 0;
  stats.queuedTotal = 0;
  stats.flushAttempts = 0;
  stats.succeeded = 0;
  stats.failed = 0;
  stats.lastError = null;
  processing = false;
  scheduled = false;
}
