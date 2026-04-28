import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("enqueueVideoProcessingCloudTask", () => {
  const originalProject = process.env.GCP_PROJECT_ID;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIREBASE_PROJECT_ID;
  });

  afterEach(() => {
    if (originalProject === undefined) delete process.env.GCP_PROJECT_ID;
    else process.env.GCP_PROJECT_ID = originalProject;
  });

  it("returns missing_gcp_project_id when no project is configured", async () => {
    const { enqueueVideoProcessingCloudTask } = await import("./video-processing-cloud-task.service.js");
    const result = await enqueueVideoProcessingCloudTask({
      postId: "post_x",
      userId: "user_x",
      videoAssets: [{ id: "v1", original: "https://cdn.example.com/a.mp4" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_gcp_project_id");
  });
});
