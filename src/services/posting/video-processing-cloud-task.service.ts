import { CloudTasksClient } from "@google-cloud/tasks";

export type VideoProcessingAssetPayload = { id: string; original: string };

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
  const functionUrl =
    process.env.VIDEO_PROCESSOR_FUNCTION_URL?.trim() ||
    `https://us-central1-${projectId}.cloudfunctions.net/video-processor`;

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
    const task = {
      dispatchDeadline: { seconds: 1800 },
      httpRequest: {
        httpMethod: "POST" as const,
        url: functionUrl,
        headers: {
          "Content-Type": "application/json"
        },
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
