import { describe, expect, it, vi } from "vitest";

const { stagePostMock } = vi.hoisted(() => ({
  stagePostMock: vi.fn(async () => ({
    stageId: "legstage_test",
    derivedScopes: ["cell:geohash6:dr5reg"],
    previewCards: [],
  })),
}));

vi.mock("../../domains/legends/legend.service.js", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    legendService: {
      stagePost: stagePostMock,
    },
  };
});

import { createApp } from "../../app/createApp.js";

describe("v2 legends stage-post route", () => {
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("derives geohash from lat/lng when client does not send geohash", async () => {
    stagePostMock.mockClear();
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "POST",
      url: "/v2/legends/stage-post",
      headers,
      payload: {
        userId: "internal-viewer",
        lat: 42.66509289237006,
        lng: -77.14640687056068,
        activityIds: [],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(stagePostMock).toHaveBeenCalledTimes(1);
    const firstCall = stagePostMock.mock.calls[0];
    if (!firstCall) throw new Error("stagePost not called");
    const input = (firstCall as unknown as [unknown])[0] as { geohash?: unknown };
    expect(typeof input.geohash).toBe("string");
    expect(String(input.geohash).length).toBeGreaterThanOrEqual(6);
  });
});
