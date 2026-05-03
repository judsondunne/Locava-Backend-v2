import { CloudTasksClient } from "@google-cloud/tasks";
import {
  classifyCloudTasksEnqueueError,
  resolveVideoProcessingCloudTasksConfig
} from "./video-processing-cloud-tasks.diagnostics.js";

export type VideoProcessingAssetPayload = { id: string; original: string };

export type EnqueueVideoProcessingCloudTaskResult =
  | { ok: true; taskName: string }
  | { ok: false; reason: string; failureCode?: string };

/**
 * Enqueues the same Cloud Task payload the classic monolith uses: HTTP POST to the
 * `video-processor` worker with `{ postId, videoAssets, userId }`.
 * Requires GCP credentials with `cloudtasks.tasks.create` on the target queue.
 */
export async function enqueueVideoProcessingCloudTask(input: {
  postId: string;
  userId: string;
  videoAssets: VideoProcessingAssetPayload[];
  correlationId?: string;
}): Promise<EnqueueVideoProcessingCloudTaskResult> {
  const cfg = resolveVideoProcessingCloudTasksConfig();
  if (!cfg.gcpProjectId) {
    return { ok: false, reason: "missing_gcp_project_id", failureCode: "missing_gcp_project_id" };
  }
  if (!input.videoAssets.length) {
    return { ok: false, reason: "empty_video_assets", failureCode: "empty_video_assets" };
  }
  if (!cfg.workerTargetUrl) {
    return {
      ok: false,
      reason: "missing_video_processor_url",
      failureCode: "cloud_tasks_unknown_error"
    };
  }

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
    const client = new CloudTasksClient({ projectId: cfg.gcpProjectId });
    const parent = client.queuePath(cfg.gcpProjectId, cfg.cloudTasksLocation, cfg.queueName);
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
        url: cfg.workerTargetUrl,
        headers,
        body: Buffer.from(JSON.stringify(taskPayload)).toString("base64")
      }
    };
    const [response] = await client.createTask({ parent, task });
    return { ok: true, taskName: response.name ?? "" };
  } catch (raw) {
    const rawMessage = raw instanceof Error ? raw.message : String(raw);
    const { failureCode, reasonForFirestore } = classifyCloudTasksEnqueueError(raw, rawMessage, {
      queueName: cfg.queueName,
      location: cfg.cloudTasksLocation,
      projectId: cfg.gcpProjectId
    });
    return { ok: false, reason: reasonForFirestore, failureCode };
  }
}

export async function triggerVideoProcessingSynchronously(input: {
  postId: string;
  userId: string;
  videoAssets: VideoProcessingAssetPayload[];
  correlationId?: string;
  timeoutMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = resolveVideoProcessingCloudTasksConfig();
  if (!cfg.gcpProjectId) return { ok: false, reason: "missing_gcp_project_id" };
  if (!input.videoAssets.length) return { ok: false, reason: "empty_video_assets" };
  if (!cfg.workerTargetUrl) return { ok: false, reason: "missing_video_processor_url" };
  const timeoutMs = input.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const taskSecret = process.env.VIDEO_PROCESSOR_TASK_SECRET?.trim();
    if (taskSecret) {
      headers["x-locava-video-processor-secret"] = taskSecret;
    }
    const response = await fetch(cfg.workerTargetUrl, {
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
