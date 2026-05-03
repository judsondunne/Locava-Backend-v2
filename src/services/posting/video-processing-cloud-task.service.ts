import { CloudTasksClient } from "@google-cloud/tasks";

export type VideoProcessingAssetPayload = { id: string; original: string };

function resolveVideoProcessorFunctionUrl(projectId: string): string {
  return (
    process.env.VIDEO_PROCESSOR_FUNCTION_URL?.trim() ||
    `https://us-central1-${projectId}.cloudfunctions.net/video-processor`
  );
}

/**
 * Enqueues the same Cloud Task payload the classic monolith uses: HTTP POST to the
 * `video-processor` Cloud Function with `{ postId, videoAssets, userId }`.
 * Requires GCP credentials with `cloudtasks.tasks.create` on the target queue.
 */
export async function enqueueVideoProcessingCloudTask(input: {
  postId: string;
  userId: string;
  videoAssets: VideoProcessingAssetPayload[];
  correlationId?: string;
}): Promise<{ ok: true; taskName: string } | { ok: false; reason: string }> {
  const projectId =
    process.env.GCP_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    "";
  if (!projectId) {
    return { ok: false, reason: "missing_gcp_project_id" };
  }
  if (!input.videoAssets.length) {
    return { ok: false, reason: "empty_video_assets" };
  }

  const location = process.env.VIDEO_PROCESSING_CLOUD_TASKS_LOCATION?.trim() || "us-central1";
  const queueName = process.env.VIDEO_PROCESSING_CLOUD_TASKS_QUEUE?.trim() || "video-processing-queue";
  const functionUrl = resolveVideoProcessorFunctionUrl(projectId);

  const taskPayload = {
    postId: input.postId,
    userId: input.userId,
    videoAssets: input.videoAssets.map((a) => ({
      id: a.id,
      original: a.original.trim()
    })),
    ...(input.correlationId ? { correlationId: input.correlationId } : {})
  };

  try {
    const client = new CloudTasksClient({ projectId });
    const parent = client.queuePath(projectId, location, queueName);
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    const taskSecret = process.env.VIDEO_PROCESSOR_TASK_SECRET?.trim();
    if (taskSecret) {
      headers["x-locava-video-processor-secret"] = taskSecret;
    }
    const task = {
      dispatchDeadline: { seconds: 1800 },
      httpRequest: {
        httpMethod: "POST" as const,
        url: functionUrl,
        headers,
        body: Buffer.from(JSON.stringify(taskPayload)).toString("base64")
      }
    };
    const [response] = await client.createTask({ parent, task });
    return { ok: true, taskName: response.name ?? "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message.slice(0, 500) };
  }
}

export async function triggerVideoProcessingSynchronously(input: {
  postId: string;
  userId: string;
  videoAssets: VideoProcessingAssetPayload[];
  correlationId?: string;
  timeoutMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const projectId =
    process.env.GCP_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    "";
  if (!projectId) return { ok: false, reason: "missing_gcp_project_id" };
  if (!input.videoAssets.length) return { ok: false, reason: "empty_video_assets" };
  const url = resolveVideoProcessorFunctionUrl(projectId);
  const timeoutMs = input.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const taskSecret = process.env.VIDEO_PROCESSOR_TASK_SECRET?.trim();
    if (taskSecret) {
      headers["x-locava-video-processor-secret"] = taskSecret;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        postId: input.postId,
        userId: input.userId,
        videoAssets: input.videoAssets,
        ...(input.correlationId ? { correlationId: input.correlationId } : {})
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, reason: `sync_processor_http_${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.slice(0, 240) : "sync_processor_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
