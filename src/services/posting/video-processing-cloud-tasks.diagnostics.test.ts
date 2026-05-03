import { describe, expect, it } from "vitest";
import {
  classifyCloudTasksEnqueueError,
  DEFAULT_VIDEO_PROCESSING_CLOUD_TASKS_QUEUE,
  resolveVideoProcessingCloudTasksConfig
} from "./video-processing-cloud-tasks.diagnostics.js";

describe("resolveVideoProcessingCloudTasksConfig", () => {
  it("defaults queue and location when env unset", () => {
    const prevQ = process.env.VIDEO_PROCESSING_CLOUD_TASKS_QUEUE;
    const prevL = process.env.VIDEO_PROCESSING_CLOUD_TASKS_LOCATION;
    delete process.env.VIDEO_PROCESSING_CLOUD_TASKS_QUEUE;
    delete process.env.VIDEO_PROCESSING_CLOUD_TASKS_LOCATION;
    try {
      const c = resolveVideoProcessingCloudTasksConfig();
      expect(c.queueName).toBe(DEFAULT_VIDEO_PROCESSING_CLOUD_TASKS_QUEUE);
      expect(c.cloudTasksLocation).toBe("us-central1");
    } finally {
      if (prevQ !== undefined) process.env.VIDEO_PROCESSING_CLOUD_TASKS_QUEUE = prevQ;
      else delete process.env.VIDEO_PROCESSING_CLOUD_TASKS_QUEUE;
      if (prevL !== undefined) process.env.VIDEO_PROCESSING_CLOUD_TASKS_LOCATION = prevL;
      else delete process.env.VIDEO_PROCESSING_CLOUD_TASKS_LOCATION;
    }
  });
});

describe("classifyCloudTasksEnqueueError", () => {
  const ctx = { queueName: "video-processing-queue", location: "us-central1", projectId: "learn-32d72" };

  it("classifies permission denied", () => {
    const raw = { code: 7, message: "PERMISSION_DENIED" };
    const r = classifyCloudTasksEnqueueError(raw, "7 PERMISSION_DENIED: lacks cloudtasks.tasks.create", ctx);
    expect(r.failureCode).toBe("cloud_tasks_permission_denied");
    expect(r.reasonForFirestore).toContain("[cloud_tasks_permission_denied]");
    expect(r.reasonForFirestore).toContain("roles/cloudtasks.enqueuer");
  });

  it("classifies not found queue", () => {
    const r = classifyCloudTasksEnqueueError({ code: 5 }, "NOT_FOUND: Queue does not exist", ctx);
    expect(r.failureCode).toBe("cloud_tasks_queue_not_found");
    expect(r.reasonForFirestore).toContain("[cloud_tasks_queue_not_found]");
  });
});
