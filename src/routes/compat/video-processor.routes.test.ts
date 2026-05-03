import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";

const hoisted = vi.hoisted(() => ({
  processVideoPostJob: vi.fn(async () => ({ ok: true as const }))
}));

vi.mock("../../services/video/video-post-processor.service.js", () => ({
  processVideoPostJob: hoisted.processVideoPostJob
}));

let createApp: (overrides?: Partial<AppEnv>) => FastifyInstance;

beforeAll(async () => {
  process.env.FIRESTORE_TEST_MODE = process.env.FIRESTORE_TEST_MODE?.trim() || "disabled";
  ({ createApp } = await import("../../app/createApp.js"));
});

describe("POST /video-processor", () => {
  beforeEach(() => {
    hoisted.processVideoPostJob.mockClear();
    delete process.env.VIDEO_PROCESSOR_TASK_SECRET;
  });

  afterEach(() => {
    delete process.env.VIDEO_PROCESSOR_TASK_SECRET;
  });

  it("invokes processor for valid body", async () => {
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      INTERNAL_DASHBOARD_TOKEN: undefined,
      ENABLE_LEGACY_COMPAT_ROUTES: true
    });
    const res = await app.inject({
      method: "POST",
      url: "/video-processor",
      payload: {
        postId: "post_test_vid",
        userId: "user_1",
        videoAssets: [{ id: "video_1", original: "https://cdn.example.com/in.mp4" }]
      }
    });
    expect(res.statusCode).toBe(200);
    expect(hoisted.processVideoPostJob).toHaveBeenCalledWith({
      postId: "post_test_vid",
      userId: "user_1",
      videoAssets: [{ id: "video_1", original: "https://cdn.example.com/in.mp4" }]
    });
  });

  it("rejects when secret header mismatches", async () => {
    process.env.VIDEO_PROCESSOR_TASK_SECRET = "expected-secret";
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      INTERNAL_DASHBOARD_TOKEN: undefined,
      ENABLE_LEGACY_COMPAT_ROUTES: true
    });
    const res = await app.inject({
      method: "POST",
      url: "/video-processor",
      headers: { "x-locava-video-processor-secret": "wrong" },
      payload: {
        postId: "post_test_vid",
        userId: "user_1",
        videoAssets: [{ id: "video_1", original: "https://cdn.example.com/in.mp4" }]
      }
    });
    expect(res.statusCode).toBe(401);
    expect(hoisted.processVideoPostJob).not.toHaveBeenCalled();
  });
});
