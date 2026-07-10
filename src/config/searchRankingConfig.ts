/**
 * Search ranking-version switch. Selects which post-ranking pipeline `/v2/search/results` uses,
 * so the semantic pipeline can roll out shadow → A/B → default without a client release (the client
 * tolerates the `rankingVersion` value). Env-driven for now; can later be backed by remote config.
 *
 * - "lexical_v1"  (default): the existing lexical/structured ranker (`searchResultsPage`).
 * - "semantic_v1": hybrid embeddings + ANN ranker (`semanticSearchResultsPage`), with automatic
 *   fallback to lexical when embeddings are unconfigured or a query can't be embedded.
 */
export type SearchRankingVersion = "lexical_v1" | "semantic_v1";

export function getSearchRankingVersion(): SearchRankingVersion {
  return process.env.SEARCH_RANKING_VERSION?.trim() === "semantic_v1" ? "semantic_v1" : "lexical_v1";
}

export function isSemanticRankingEnabled(): boolean {
  return getSearchRankingVersion() === "semantic_v1";
}
