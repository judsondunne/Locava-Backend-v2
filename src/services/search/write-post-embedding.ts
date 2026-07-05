/**
 * Compute and persist the semantic-search embedding for a single post.
 *
 * Shared by the on-write embedding worker (Cloud Task) and the backfill runner. Reads the post's
 * `getPostSearchableText` corpus, embeds it, and writes the Firestore `Vector` field `embedding`
 * plus freshness metadata (`embeddingModel`/`embeddingVersion`/`embeddedAt`) and clears
 * `embeddingPending`. Idempotent: skips posts already embedded at the current model + version.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getPostSearchableText } from "../../lib/posts/postFieldSelectors.js";
import { embedText, getEmbeddingConfig } from "./post-embedding.service.js";

/** Bump when the embed corpus/model semantics change so the backfill re-embeds. */
export const POST_EMBEDDING_VERSION = 1;

export type EmbedAndStoreResult =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string };

export async function embedAndStorePost(
  db: Firestore,
  postId: string,
  opts?: { force?: boolean }
): Promise<EmbedAndStoreResult> {
  const cfg = getEmbeddingConfig();
  if (!cfg) return { ok: true, skipped: true, reason: "embedding_disabled" };

  const ref = db.collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "post_not_found" };
  const data = (snap.data() ?? {}) as Record<string, unknown>;

  if (
    !opts?.force &&
    data.embeddingVersion === POST_EMBEDDING_VERSION &&
    data.embeddingModel === cfg.model &&
    data.embedding
  ) {
    return { ok: true, skipped: true, reason: "already_embedded" };
  }

  const corpus = getPostSearchableText(data).trim();
  if (!corpus) {
    // Nothing to embed — clear the pending flag so it isn't retried forever.
    await ref.update({ embeddingPending: false });
    return { ok: true, skipped: true, reason: "empty_corpus" };
  }

  const vector = await embedText(corpus, "RETRIEVAL_DOCUMENT");
  await ref.update({
    embedding: FieldValue.vector(vector),
    embeddingModel: cfg.model,
    embeddingVersion: POST_EMBEDDING_VERSION,
    embeddedAt: new Date().toISOString(),
    embeddingPending: false
  });
  return { ok: true, skipped: false };
}
