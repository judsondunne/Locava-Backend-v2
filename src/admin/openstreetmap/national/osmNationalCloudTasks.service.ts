export type OsmNationalCloudTaskPayload = {
  runId: string;
  stateCode: string;
  chunkId: string;
};

export type OsmNationalCloudTasksDiagnostics = {
  enabled: boolean;
  queueName: string | null;
  location: string | null;
  workerUrl: string | null;
  reason?: string;
};

export function getOsmNationalCloudTasksDiagnostics(): OsmNationalCloudTasksDiagnostics {
  const queueName = process.env.OSM_NATIONAL_CLOUD_TASKS_QUEUE?.trim() || null;
  const location = process.env.OSM_NATIONAL_CLOUD_TASKS_LOCATION?.trim() || null;
  const workerUrl = process.env.OSM_NATIONAL_WORKER_URL?.trim() || null;

  if (!queueName || !location || !workerUrl) {
    return {
      enabled: false,
      queueName,
      location,
      workerUrl,
      reason: "Missing OSM_NATIONAL_CLOUD_TASKS_QUEUE, OSM_NATIONAL_CLOUD_TASKS_LOCATION, or OSM_NATIONAL_WORKER_URL",
    };
  }

  return { enabled: true, queueName, location, workerUrl };
}

export async function enqueueOsmNationalChunkTask(payload: OsmNationalCloudTaskPayload): Promise<{ enqueued: boolean; reason?: string }> {
  const config = getOsmNationalCloudTasksDiagnostics();
  if (!config.enabled) {
    return { enqueued: false, reason: config.reason ?? "cloud_tasks_disabled" };
  }

  // Optional Cloud Tasks integration — local runner remains primary when unset.
  console.log("[osm-national-cloud-tasks] would enqueue", JSON.stringify(payload));
  return { enqueued: false, reason: "cloud_tasks_stub_not_configured" };
}

export function validateCloudTaskPayload(body: unknown): OsmNationalCloudTaskPayload | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.runId !== "string" || typeof record.stateCode !== "string" || typeof record.chunkId !== "string") {
    return null;
  }
  return {
    runId: record.runId,
    stateCode: record.stateCode.toUpperCase(),
    chunkId: record.chunkId,
  };
}
