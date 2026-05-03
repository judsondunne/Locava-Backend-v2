import type { FastifyBaseLogger } from "fastify";

/** Matches `video-processing-cloud-task.service` defaults. */
export const DEFAULT_VIDEO_PROCESSING_CLOUD_TASKS_LOCATION = "us-central1";
export const DEFAULT_VIDEO_PROCESSING_CLOUD_TASKS_QUEUE = "video-processing-queue";

export type ResolvedVideoCloudTasksConfig = {
  gcpProjectId: string | null;
  gcpProjectIdEnvKey: "GCP_PROJECT_ID" | "GCLOUD_PROJECT" | "FIREBASE_PROJECT_ID" | null;
  cloudTasksLocation: string;
  queueName: string;
  workerTargetUrl: string;
  workerUrlSource: "VIDEO_PROCESSOR_FUNCTION_URL" | "default_us_central1_cloudfunctions_video_processor";
  videoProcessorTaskSecretConfigured: boolean;
};

export function resolveVideoProcessingCloudTasksConfig(): ResolvedVideoCloudTasksConfig {
  let gcpProjectId: string | null = null;
  let gcpProjectIdEnvKey: ResolvedVideoCloudTasksConfig["gcpProjectIdEnvKey"] = null;
  for (const [key, val] of [
    ["GCP_PROJECT_ID", process.env.GCP_PROJECT_ID],
    ["GCLOUD_PROJECT", process.env.GCLOUD_PROJECT],
    ["FIREBASE_PROJECT_ID", process.env.FIREBASE_PROJECT_ID]
  ] as const) {
    const t = typeof val === "string" ? val.trim() : "";
    if (t) {
      gcpProjectId = t;
      gcpProjectIdEnvKey = key;
      break;
    }
  }

  const cloudTasksLocation =
    process.env.VIDEO_PROCESSING_CLOUD_TASKS_LOCATION?.trim() || DEFAULT_VIDEO_PROCESSING_CLOUD_TASKS_LOCATION;
  const queueName =
    process.env.VIDEO_PROCESSING_CLOUD_TASKS_QUEUE?.trim() || DEFAULT_VIDEO_PROCESSING_CLOUD_TASKS_QUEUE;

  const envUrl = process.env.VIDEO_PROCESSOR_FUNCTION_URL?.trim();
  let workerTargetUrl: string;
  let workerUrlSource: ResolvedVideoCloudTasksConfig["workerUrlSource"];
  if (envUrl) {
    workerTargetUrl = envUrl;
    workerUrlSource = "VIDEO_PROCESSOR_FUNCTION_URL";
  } else if (gcpProjectId) {
    workerTargetUrl = `https://us-central1-${gcpProjectId}.cloudfunctions.net/video-processor`;
    workerUrlSource = "default_us_central1_cloudfunctions_video_processor";
  } else {
    workerTargetUrl = "";
    workerUrlSource = "default_us_central1_cloudfunctions_video_processor";
  }

  return {
    gcpProjectId,
    gcpProjectIdEnvKey,
    cloudTasksLocation,
    queueName,
    workerTargetUrl,
    workerUrlSource,
    videoProcessorTaskSecretConfigured: Boolean(process.env.VIDEO_PROCESSOR_TASK_SECRET?.trim())
  };
}

export type CloudTasksEnqueueFailureCode =
  | "missing_gcp_project_id"
  | "empty_video_assets"
  | "cloud_tasks_permission_denied"
  | "cloud_tasks_queue_not_found"
  | "cloud_tasks_invalid_argument"
  | "cloud_tasks_unavailable"
  | "cloud_tasks_unknown_error"
  | "application_default_credentials_error";

type ClassifyContext = {
  queueName: string;
  location: string;
  projectId: string | null;
};

export function classifyCloudTasksEnqueueError(
  raw: unknown,
  rawMessage: string,
  ctx: ClassifyContext
): { failureCode: CloudTasksEnqueueFailureCode; reasonForFirestore: string } {
  const msg = rawMessage.slice(0, 900);
  const lower = msg.toLowerCase();
  const code =
    raw && typeof raw === "object" && "code" in raw && typeof (raw as { code: unknown }).code === "number"
      ? (raw as { code: number }).code
      : undefined;

  if (lower.includes("could not load the default credentials") || lower.includes("default credentials")) {
    return {
      failureCode: "application_default_credentials_error",
      reasonForFirestore: `[application_default_credentials_error] ${msg.slice(0, 400)}`
    };
  }

  if (code === 7 || lower.includes("permission_denied") || lower.includes("lacks iam permission")) {
    const qPath = ctx.projectId
      ? `projects/${ctx.projectId}/locations/${ctx.location}/queues/${ctx.queueName}`
      : `locations/${ctx.location}/queues/${ctx.queueName}`;
    return {
      failureCode: "cloud_tasks_permission_denied",
      reasonForFirestore:
        `[cloud_tasks_permission_denied] Missing cloudtasks.tasks.create (roles/cloudtasks.enqueuer) for ${qPath}. ` +
        `Grant roles/cloudtasks.enqueuer to the Cloud Run service account on the project or queue. ` +
        `Probe: GET /internal/health-dashboard/cloud-tasks-video. Raw: ${msg.slice(0, 320)}`
    };
  }

  if (
    code === 5 ||
    (lower.includes("not_found") && (lower.includes("queue") || lower.includes("queues/") || lower.includes(ctx.queueName.toLowerCase())))
  ) {
    return {
      failureCode: "cloud_tasks_queue_not_found",
      reasonForFirestore:
        `[cloud_tasks_queue_not_found] Queue "${ctx.queueName}" not found in ${ctx.location}. ` +
        `Create: gcloud tasks queues create ${ctx.queueName} --location=${ctx.location}. Raw: ${msg.slice(0, 320)}`
    };
  }

  if (code === 3 || lower.includes("invalid_argument")) {
    return {
      failureCode: "cloud_tasks_invalid_argument",
      reasonForFirestore: `[cloud_tasks_invalid_argument] ${msg.slice(0, 480)}`
    };
  }

  if (code === 14 || lower.includes("unavailable") || lower.includes("econnreset")) {
    return {
      failureCode: "cloud_tasks_unavailable",
      reasonForFirestore: `[cloud_tasks_unavailable] ${msg.slice(0, 480)}`
    };
  }

  return {
    failureCode: "cloud_tasks_unknown_error",
    reasonForFirestore: `[cloud_tasks_unknown_error] ${msg.slice(0, 480)}`
  };
}

export type VideoCloudTasksProbeSnapshot = {
  config: ResolvedVideoCloudTasksConfig;
  runtime: {
    kService: string | null;
    kRevision: string | null;
    metadataDefaultServiceAccountEmail: string | null;
  };
  /** Reads queue metadata only (no task created). May return permission_denied if SA lacks queues.get. */
  queueGet: {
    attempted: boolean;
    outcome:
      | "ok"
      | "queue_not_found"
      | "permission_denied"
      | "credentials_error"
      | "other"
      | "skipped_no_project";
    grpcCode: number | null;
    detail: string | null;
    queueState: string | null;
  };
  hints: string[];
};

async function tryGetGcpRuntimeServiceAccountEmail(): Promise<string | null> {
  if (!process.env.K_SERVICE) return null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
      { headers: { "Metadata-Flavor": "Google" }, signal: ac.signal }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function probeVideoProcessingCloudTasksQueue(): Promise<VideoCloudTasksProbeSnapshot> {
  const config = resolveVideoProcessingCloudTasksConfig();
  const hints: string[] = [
    "This probe never enqueues a video task.",
    "Enqueue requires roles/cloudtasks.enqueuer (cloudtasks.tasks.create).",
    "Queue metadata read uses queues.get; if that is denied, enqueue may still work when only enqueuer is granted."
  ];

  const runtime = {
    kService: process.env.K_SERVICE?.trim() || null,
    kRevision: process.env.K_REVISION?.trim() || null,
    metadataDefaultServiceAccountEmail: await tryGetGcpRuntimeServiceAccountEmail()
  };

  if (!config.gcpProjectId) {
    hints.push("Set GCP_PROJECT_ID (or GCLOUD_PROJECT / FIREBASE_PROJECT_ID) for Cloud Tasks.");
    return {
      config,
      runtime,
      queueGet: {
        attempted: false,
        outcome: "skipped_no_project",
        grpcCode: null,
        detail: "No GCP project id resolved from env.",
        queueState: null
      },
      hints
    };
  }

  try {
    const { CloudTasksClient } = await import("@google-cloud/tasks");
    const client = new CloudTasksClient({ projectId: config.gcpProjectId });
    const name = client.queuePath(config.gcpProjectId, config.cloudTasksLocation, config.queueName);
    const [queue] = await client.getQueue({ name });
    const state = queue.state != null ? String(queue.state) : null;
    return {
      config,
      runtime,
      queueGet: {
        attempted: true,
        outcome: "ok",
        grpcCode: null,
        detail: null,
        queueState: state
      },
      hints
    };
  } catch (raw) {
    const detail = raw instanceof Error ? raw.message : String(raw);
    const grpcCode =
      raw && typeof raw === "object" && "code" in raw && typeof (raw as { code: unknown }).code === "number"
        ? (raw as { code: number }).code
        : null;
    const lower = detail.toLowerCase();
    let outcome: VideoCloudTasksProbeSnapshot["queueGet"]["outcome"] = "other";
    if (lower.includes("could not load the default credentials") || lower.includes("default credentials")) {
      outcome = "credentials_error";
    } else if (grpcCode === 5 || (lower.includes("not_found") && (lower.includes("queue") || lower.includes("queues/")))) {
      outcome = "queue_not_found";
    } else if (grpcCode === 7 || lower.includes("permission_denied")) {
      outcome = "permission_denied";
    }

    if (outcome === "queue_not_found") {
      hints.push(
        `Create queue: gcloud tasks queues create ${config.queueName} --location=${config.cloudTasksLocation} --project=${config.gcpProjectId}`
      );
    }
    if (outcome === "permission_denied") {
      hints.push(
        `Grant enqueuer: gcloud projects add-iam-policy-binding ${config.gcpProjectId} --member="serviceAccount:YOUR_RUN_SA" --role="roles/cloudtasks.enqueuer"`
      );
    }

    return {
      config,
      runtime,
      queueGet: {
        attempted: true,
        outcome,
        grpcCode,
        detail: detail.slice(0, 500),
        queueState: null
      },
      hints
    };
  }
}

export function logVideoProcessingCloudTasksStartup(log: Pick<FastifyBaseLogger, "info">): void {
  const c = resolveVideoProcessingCloudTasksConfig();
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  log.info(
    {
      videoCloudTasks: {
        gcpProjectId: c.gcpProjectId,
        gcpProjectIdEnvKey: c.gcpProjectIdEnvKey,
        location: c.cloudTasksLocation,
        queueName: c.queueName,
        workerTargetUrl: c.workerTargetUrl || null,
        workerUrlSource: c.workerUrlSource,
        taskSecretConfigured: c.videoProcessorTaskSecretConfigured,
        googleApplicationCredentialsConfigured: Boolean(gac),
        cloudTasksAuthHint:
          !gac && !process.env.K_SERVICE
            ? "No GOOGLE_APPLICATION_CREDENTIALS: @google-cloud/tasks may use gcloud user ADC (often lacks cloudtasks.tasks.create). Set a service account key path in .env or export it before npm run dev."
            : null,
        enqueueTarget:
          c.gcpProjectId && c.workerTargetUrl
            ? `Cloud Tasks → POST ${c.workerTargetUrl} (queue ${c.queueName} @ ${c.cloudTasksLocation})`
            : null
      }
    },
    "video_processing_cloud_tasks_startup"
  );
}
