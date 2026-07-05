/**
 * Enqueues a Cloud Task to (re)compute a post's semantic-search embedding asynchronously, so posting
 * finalize is never blocked on the embedding provider. Mirrors `enqueueVideoProcessingCloudTask`:
 * HTTP POST to an internal worker route with `{ postId, userId? }` + a shared secret header.
 *
 * Config is env-driven and degrades gracefully — when the worker URL / project is unconfigured the
 * enqueue is a no-op (`ok:false`), and the backfill job remains the source of embedding coverage.
 */
import { CloudTasksClient } from "@google-cloud/tasks";

export const POST_EMBEDDING_TASK_SECRET_HEADER = "x-locava-post-embedding-secret";

const DEFAULT_LOCATION = "us-central1";
const DEFAULT_QUEUE = "post-embedding";

type ResolvedConfig = {
  gcpProjectId: string;
  location: string;
  queueName: string;
  workerTargetUrl: string;
};

function resolveConfig(): ResolvedConfig | { error: string } {
  const gcpProjectId =
    process.env.GCP_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    "";
  if (!gcpProjectId) return { error: "missing_gcp_project_id" };
  const workerTargetUrl = process.env.POST_EMBEDDING_WORKER_URL?.trim() || "";
  if (!workerTargetUrl) return { error: "missing_post_embedding_worker_url" };
  return {
    gcpProjectId,
    location: process.env.POST_EMBEDDING_CLOUD_TASKS_LOCATION?.trim() || DEFAULT_LOCATION,
    queueName: process.env.POST_EMBEDDING_CLOUD_TASKS_QUEUE?.trim() || DEFAULT_QUEUE,
    workerTargetUrl
  };
}

export type EnqueuePostEmbeddingResult =
  | { ok: true; taskName: string }
  | { ok: false; reason: string };

export async function enqueuePostEmbeddingCloudTask(input: {
  postId: string;
  userId?: string;
  correlationId?: string;
}): Promise<EnqueuePostEmbeddingResult> {
  if (!input.postId?.trim()) return { ok: false, reason: "missing_post_id" };
  const cfg = resolveConfig();
  if ("error" in cfg) return { ok: false, reason: cfg.error };

  const payload = {
    postId: input.postId,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {})
  };

  try {
    const client = new CloudTasksClient({ projectId: cfg.gcpProjectId });
    const parent = client.queuePath(cfg.gcpProjectId, cfg.location, cfg.queueName);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = process.env.POST_EMBEDDING_TASK_SECRET?.trim();
    if (secret) headers[POST_EMBEDDING_TASK_SECRET_HEADER] = secret;
    const task = {
      dispatchDeadline: { seconds: 300 },
      httpRequest: {
        httpMethod: "POST" as const,
        url: cfg.workerTargetUrl,
        headers,
        body: Buffer.from(JSON.stringify(payload)).toString("base64")
      }
    };
    const [response] = await client.createTask({ parent, task });
    return { ok: true, taskName: response.name ?? "" };
  } catch (raw) {
    return { ok: false, reason: raw instanceof Error ? raw.message : String(raw) };
  }
}
