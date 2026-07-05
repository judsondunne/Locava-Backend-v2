/**
 * Text embedding service for semantic search.
 *
 * Posts are embedded offline (backfill + on-write Cloud Task) and stored as a Firestore
 * `Vector` field; queries are embedded online at request time (cached in the shared cache).
 * The embed corpus for a post is `getPostSearchableText(record)` — the single source of truth.
 *
 * Default provider is Vertex AI text embeddings (GCP-native, IAM auth via google-auth-library).
 * The provider is selectable via env so a different vendor (e.g. Voyage) can be dropped in without
 * touching callers. The embedding dimension MUST match the Firestore vector index dimension.
 */
import { GoogleAuth } from "google-auth-library";
import { globalCache } from "../../cache/global-cache.js";
import { normalizeSearchText } from "../../lib/search-query-intent.js";

/** Vertex task types — documents and queries are embedded with different task types for retrieval quality. */
export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export type EmbeddingConfig = {
  provider: "vertex";
  model: string;
  dim: number;
  projectId: string;
  location: string;
};

/** Reads embedding config from env. Returns null when disabled or missing required GCP project. */
export function readEmbeddingConfigFromEnv(): EmbeddingConfig | null {
  const provider = (process.env.SEARCH_EMBEDDING_PROVIDER?.trim() || "vertex") as EmbeddingConfig["provider"];
  if (provider !== "vertex") {
    // Only Vertex is implemented today; other providers intentionally disable semantic search rather than throw.
    return null;
  }
  const projectId =
    process.env.SEARCH_EMBEDDING_PROJECT_ID?.trim() ||
    process.env.GCP_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    "";
  if (!projectId) return null;
  const model = process.env.SEARCH_EMBEDDING_MODEL?.trim() || "text-embedding-005";
  const dim = Number.parseInt(process.env.SEARCH_EMBEDDING_DIM?.trim() || "768", 10);
  const location = process.env.SEARCH_EMBEDDING_LOCATION?.trim() || "us-central1";
  return { provider, model, dim, projectId, location: location || "us-central1" };
}

interface EmbeddingProvider {
  readonly dim: number;
  embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]>;
}

/** Max instances per Vertex :predict call (well under the documented cap; keeps payloads small). */
const VERTEX_BATCH_SIZE = 25;
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

class VertexEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;
  private readonly model: string;
  private readonly projectId: string;
  private readonly location: string;
  private readonly auth: GoogleAuth;

  constructor(cfg: EmbeddingConfig) {
    this.dim = cfg.dim;
    this.model = cfg.model;
    this.projectId = cfg.projectId;
    this.location = cfg.location;
    this.auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  }

  private endpoint(): string {
    return `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.model}:predict`;
  }

  async embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
    if (texts.length === 0) return [];
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("vertex_embedding_no_access_token");
    const url = this.endpoint();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += VERTEX_BATCH_SIZE) {
      const chunk = texts.slice(i, i + VERTEX_BATCH_SIZE);
      const body = {
        instances: chunk.map((content) => ({ content, task_type: taskType })),
        parameters: { outputDimensionality: this.dim }
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`vertex_embedding_http_${res.status}: ${detail.slice(0, 500)}`);
      }
      const json = (await res.json()) as {
        predictions?: Array<{ embeddings?: { values?: number[] } }>;
      };
      const predictions = json.predictions ?? [];
      if (predictions.length !== chunk.length) {
        throw new Error(`vertex_embedding_count_mismatch: got ${predictions.length} for ${chunk.length} inputs`);
      }
      for (const prediction of predictions) {
        const values = prediction.embeddings?.values;
        if (!Array.isArray(values) || values.length !== this.dim) {
          throw new Error(`vertex_embedding_bad_dimension: expected ${this.dim}, got ${values?.length ?? "none"}`);
        }
        out.push(values);
      }
    }
    return out;
  }
}

let cachedProvider: { provider: EmbeddingProvider; config: EmbeddingConfig } | null = null;

/** Returns the configured embedding provider, or null when semantic search is disabled/unconfigured. */
function getProvider(): { provider: EmbeddingProvider; config: EmbeddingConfig } | null {
  if (cachedProvider) return cachedProvider;
  const config = readEmbeddingConfigFromEnv();
  if (!config) return null;
  cachedProvider = { provider: new VertexEmbeddingProvider(config), config };
  return cachedProvider;
}

/** True when the embedding provider is configured (used to gate semantic search paths). */
export function isEmbeddingEnabled(): boolean {
  return getProvider() !== null;
}

export function getEmbeddingConfig(): EmbeddingConfig | null {
  return getProvider()?.config ?? null;
}

/** Embed a batch of post/document texts. Throws if the provider is unconfigured. */
export async function embedBatch(
  texts: string[],
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  const p = getProvider();
  if (!p) throw new Error("embedding_provider_unconfigured");
  return p.provider.embedBatch(texts, taskType);
}

/** Embed a single document text. Throws if the provider is unconfigured. */
export async function embedText(
  text: string,
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<number[]> {
  const [vector] = await embedBatch([text], taskType);
  if (!vector) throw new Error("embedding_empty_result");
  return vector;
}

const QUERY_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — query embeddings are stable for a given model.

/**
 * Embed a search query (RETRIEVAL_QUERY), cached in the shared cache keyed by normalized query + model.
 * Returns null when the provider is unconfigured or the query is empty, so callers can fall back to lexical.
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  const p = getProvider();
  if (!p) return null;
  const normalized = normalizeSearchText(query);
  if (!normalized) return null;
  const cacheKey = `search:qembed:${p.config.model}:${p.config.dim}:${normalized}`;
  const cached = await globalCache.get<number[]>(cacheKey);
  if (cached && cached.length === p.config.dim) return cached;
  const vector = await p.provider.embedBatch([normalized], "RETRIEVAL_QUERY").then((rows) => rows[0] ?? null);
  if (vector) await globalCache.set(cacheKey, vector, QUERY_CACHE_TTL_MS);
  return vector;
}
