import {
  buildPostAlgorithmFieldSource,
  postActivitiesCanonicalLegacyMismatch,
  type PostAlgorithmFieldSource,
  type PostRecord,
} from "../lib/posts/postFieldSelectors.js";

/** Structured log line for mix/search/feed algorithm audits (enable in targeted routes). */
export function formatPostAlgorithmFieldSource(record: PostRecord, meta?: { route?: string; algorithm?: string }): PostAlgorithmFieldSource | null {
  return buildPostAlgorithmFieldSource(record, meta);
}

export function shouldLogCanonicalLegacyActivityMismatch(record: PostRecord): boolean {
  return postActivitiesCanonicalLegacyMismatch(record);
}
