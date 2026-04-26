import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 canonical posts publish routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("rejects non-internal posting requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v2/posts/stage",
      payload: {
        clientMutationId: "cmid-12345678",
        assets: [{ assetIndex: 0, assetType: "photo" }]
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns source_of_truth_required in test mode for stage/publish routes", async () => {
    const stage = await app.inject({
      method: "POST",
      url: "/v2/posts/stage",
      headers: viewerHeaders,
      payload: {
        clientMutationId: "cmid-stage-test-123456",
        title: "Test title",
        assets: [{ assetIndex: 0, assetType: "photo" }]
      }
    });
    expect(stage.statusCode).toBe(503);
    expect(stage.json().error.code).toBe("source_of_truth_required");

    const publish = await app.inject({
      method: "POST",
      url: "/v2/posts/publish",
      headers: viewerHeaders,
      payload: {
        stageId: "stg_missing",
        clientMutationId: "cmid-publish-test-123456",
        activities: [],
        tags: []
      }
    });
    expect(publish.statusCode).toBe(503);
    expect(publish.json().error.code).toBe("source_of_truth_required");
  });
});
