import { FieldPath, FieldValue, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import { getPostSearchableText } from "../../lib/posts/postFieldSelectors.js";
import { embedBatch, getEmbeddingConfig } from "../search/post-embedding.service.js";
import { POST_EMBEDDING_VERSION } from "../search/write-post-embedding.js";

export type PostEmbeddingsBackfillSummary = {
  totalScanned: number;
  totalEmbedded: number;
  totalSkippedAlready: number;
  totalSkippedEmptyCorpus: number;
  totalErrors: number;
};

export type PostEmbeddingsBackfillOptions = {
  dryRun: boolean;
  /** Max posts to scan; null = no cap. */
  limit: number | null;
  startAfterDocId: string | null;
  progressEvery: number;
  /** Posts read + embedded per page (also the embed batch size). */
  pageSize: number;
  /** Re-embed even if already embedded at the current model + version. */
  force: boolean;
};

const DEFAULT_OPTIONS: PostEmbeddingsBackfillOptions = {
  dryRun: false,
  limit: null,
  startAfterDocId: null,
  progressEvery: 200,
  pageSize: 100,
  force: false
};

export function mergePostEmbeddingsBackfillOptions(
  partial?: Partial<PostEmbeddingsBackfillOptions>
): PostEmbeddingsBackfillOptions {
  return { ...DEFAULT_OPTIONS, ...partial };
}

/** Pages through `posts` by document id, embedding those missing a current-version embedding. */
export async function runPostEmbeddingsBackfill(
  db: Firestore,
  opts?: Partial<PostEmbeddingsBackfillOptions>
): Promise<PostEmbeddingsBackfillSummary> {
  const options = mergePostEmbeddingsBackfillOptions(opts);
  const cfg = getEmbeddingConfig();
  const summary: PostEmbeddingsBackfillSummary = {
    totalScanned: 0,
    totalEmbedded: 0,
    totalSkippedAlready: 0,
    totalSkippedEmptyCorpus: 0,
    totalErrors: 0
  };
  if (!cfg) {
    throw new Error("embedding_provider_unconfigured");
  }

  let resumeSnapshot = await resolveStartCursor(db, options.startAfterDocId);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const remaining =
      options.limit !== null ? Math.max(0, options.limit - summary.totalScanned) : options.pageSize;
    if (options.limit !== null && remaining === 0) break;
    const pageLimit = Math.min(options.pageSize, options.limit !== null ? remaining : options.pageSize);

    let pageQuery = db.collection("posts").orderBy(FieldPath.documentId()).limit(pageLimit);
    if (resumeSnapshot) pageQuery = pageQuery.startAfter(resumeSnapshot);

    let snap;
    try {
      snap = await pageQuery.get();
    } catch {
      summary.totalErrors += 1;
      break;
    }
    if (snap.empty) break;

    const toEmbed: Array<{ ref: FirebaseFirestore.DocumentReference; corpus: string }> = [];
    for (const doc of snap.docs) {
      summary.totalScanned += 1;
      resumeSnapshot = doc;
      const data = (doc.data() ?? {}) as Record<string, unknown>;

      const alreadyEmbedded =
        data.embeddingVersion === POST_EMBEDDING_VERSION && data.embeddingModel === cfg.model && Boolean(data.embedding);
      if (!options.force && alreadyEmbedded) {
        summary.totalSkippedAlready += 1;
        continue;
      }
      const corpus = getPostSearchableText(data).trim();
      if (!corpus) {
        summary.totalSkippedEmptyCorpus += 1;
        if (!options.dryRun) {
          try {
            await doc.ref.update({ embeddingPending: false });
          } catch {
            summary.totalErrors += 1;
          }
        }
        continue;
      }
      toEmbed.push({ ref: doc.ref, corpus });
    }

    if (toEmbed.length > 0 && !options.dryRun) {
      try {
        const vectors = await embedBatch(
          toEmbed.map((row) => row.corpus),
          "RETRIEVAL_DOCUMENT"
        );
        const nowIso = new Date().toISOString();
        let batch: WriteBatch = db.batch();
        let inBatch = 0;
        for (let i = 0; i < toEmbed.length; i += 1) {
          const vector = vectors[i];
          const row = toEmbed[i];
          if (!vector || !row) continue;
          batch.update(row.ref, {
            embedding: FieldValue.vector(vector),
            embeddingModel: cfg.model,
            embeddingVersion: POST_EMBEDDING_VERSION,
            embeddedAt: nowIso,
            embeddingPending: false
          });
          inBatch += 1;
          if (inBatch >= 400) {
            await batch.commit();
            summary.totalEmbedded += inBatch;
            batch = db.batch();
            inBatch = 0;
          }
        }
        if (inBatch > 0) {
          await batch.commit();
          summary.totalEmbedded += inBatch;
        }
      } catch (err) {
        summary.totalErrors += 1;
        // eslint-disable-next-line no-console
        console.error(`[post-embeddings-backfill] embed/write page failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (toEmbed.length > 0 && options.dryRun) {
      summary.totalEmbedded += toEmbed.length;
    }

    if (options.progressEvery > 0 && summary.totalScanned % options.progressEvery < pageLimit) {
      // eslint-disable-next-line no-console
      console.error(
        `[post-embeddings-backfill] progress scanned=${summary.totalScanned} embedded=${summary.totalEmbedded} skipped=${summary.totalSkippedAlready} empty=${summary.totalSkippedEmptyCorpus} errors=${summary.totalErrors}`
      );
    }

    if (snap.size < pageLimit) break;
  }

  return summary;
}

async function resolveStartCursor(db: Firestore, startAfterDocId: string | null) {
  if (!startAfterDocId) return undefined;
  const snap = await db.collection("posts").doc(startAfterDocId).get();
  if (!snap.exists) throw new Error(`start_after_not_found:${startAfterDocId}`);
  return snap;
}
