import { FieldPath, type DocumentReference, type Firestore, type WriteBatch } from "firebase-admin/firestore";

import {
  computeSearchFieldPatch,
  deriveExpectedSearchFields,
  type SearchFieldPatch
} from "../../lib/user-search-fields.js";

export type UserSearchFieldsBackfillSummary = {
  totalUsersScanned: number;
  totalUsersUpdated: number;
  totalUsersSkipped: number;
  totalUsersMissingHandle: number;
  totalUsersMissingName: number;
  totalErrors: number;
};

export type UserSearchFieldsBackfillRunnerOptions = {
  dryRun: boolean;
  /** Maximum users to scan; null means no cap. */
  limit: number | null;
  /** Exclusive document ID cursor; first page begins after this user doc (must exist). */
  startAfterDocId: string | null;
  progressEvery: number;
  /** Max users per Firestore query page. */
  pageSize: number;
  /** Max writes per Firestore batch (≤ 500). */
  batchSize: number;
};

const DEFAULT_RUNNER_OPTIONS: UserSearchFieldsBackfillRunnerOptions = {
  dryRun: false,
  limit: null,
  startAfterDocId: null,
  progressEvery: 500,
  pageSize: 400,
  batchSize: 400
};

export function mergeUserSearchFieldsBackfillOptions(
  partial?: Partial<UserSearchFieldsBackfillRunnerOptions>
): UserSearchFieldsBackfillRunnerOptions {
  return { ...DEFAULT_RUNNER_OPTIONS, ...partial };
}

/**
 * Pages through `users` by document id, updating `searchHandle` / `searchName` when derived values differ.
 */
export async function runUserSearchFieldsBackfill(
  db: Firestore,
  opts?: Partial<UserSearchFieldsBackfillRunnerOptions>
): Promise<UserSearchFieldsBackfillSummary> {
  const options = mergeUserSearchFieldsBackfillOptions(opts);
  const summary: UserSearchFieldsBackfillSummary = {
    totalUsersScanned: 0,
    totalUsersUpdated: 0,
    totalUsersSkipped: 0,
    totalUsersMissingHandle: 0,
    totalUsersMissingName: 0,
    totalErrors: 0
  };

  let resumeSnapshot = await resolveStartCursor(db, options.startAfterDocId);
  let batch: WriteBatch = db.batch();
  let updatesInCurrentBatch = 0;

  const flushBatch = async (): Promise<void> => {
    if (options.dryRun || updatesInCurrentBatch === 0) {
      updatesInCurrentBatch = 0;
      return;
    }
    const count = updatesInCurrentBatch;
    try {
      await batch.commit();
      summary.totalUsersUpdated += count;
    } catch {
      summary.totalErrors += 1;
    } finally {
      batch = db.batch();
      updatesInCurrentBatch = 0;
    }
  };

  const enqueueUpdate = async (ref: DocumentReference, patch: SearchFieldPatch): Promise<void> => {
    if (options.dryRun) {
      summary.totalUsersUpdated += 1;
      return;
    }
    batch.update(ref, patch);
    updatesInCurrentBatch += 1;
    if (updatesInCurrentBatch >= options.batchSize) {
      await flushBatch();
    }
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const remaining =
        options.limit !== null ? Math.max(0, options.limit - summary.totalUsersScanned) : options.pageSize;
      if (options.limit !== null && remaining === 0) {
        break;
      }
      const pageLimit = Math.min(options.pageSize, options.limit !== null ? remaining : options.pageSize);

      let pageQuery = db.collection("users").orderBy(FieldPath.documentId()).limit(pageLimit);
      if (resumeSnapshot) {
        pageQuery = pageQuery.startAfter(resumeSnapshot);
      }

      let snap;
      try {
        snap = await pageQuery.get();
      } catch {
        summary.totalErrors += 1;
        break;
      }

      if (snap.empty) {
        break;
      }

      let hitScanLimitDuringPage = false;

      for (const doc of snap.docs) {
        if (options.limit !== null && summary.totalUsersScanned >= options.limit) {
          break;
        }

        summary.totalUsersScanned += 1;
        const data = doc.data() as Record<string, unknown>;
        const expected = deriveExpectedSearchFields(data);
        if (expected.missingHandle) {
          summary.totalUsersMissingHandle += 1;
        }
        if (expected.missingName) {
          summary.totalUsersMissingName += 1;
        }

        const patch = computeSearchFieldPatch(data, expected);
        if (!patch) {
          summary.totalUsersSkipped += 1;
        } else {
          await enqueueUpdate(doc.ref, patch);
        }

        resumeSnapshot = doc;

        const n = summary.totalUsersScanned;
        if (options.progressEvery > 0 && n % options.progressEvery === 0) {
          // eslint-disable-next-line no-console
          console.error(
            `[user-search-fields-backfill] progress scanned=${n} updated=${summary.totalUsersUpdated} skipped=${summary.totalUsersSkipped} errors=${summary.totalErrors}`
          );
        }

        if (options.limit !== null && summary.totalUsersScanned >= options.limit) {
          hitScanLimitDuringPage = true;
          break;
        }
      }

      if (hitScanLimitDuringPage) {
        break;
      }

      if (snap.size < pageLimit) {
        break;
      }
    }
  } finally {
    await flushBatch();
  }

  return summary;
}

async function resolveStartCursor(db: Firestore, startAfterDocId: string | null) {
  if (!startAfterDocId || startAfterDocId.length === 0) {
    return undefined;
  }
  const snap = await db.collection("users").doc(startAfterDocId).get();
  if (!snap.exists) {
    throw new Error(`start_after_not_found:${startAfterDocId}`);
  }
  return snap;
}
