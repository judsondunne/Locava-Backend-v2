import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

const ROUTE = "/debug/notifications/send-test";

describe("debug notifications send-test route", () => {
  beforeEach(() => {
    delete process.env.ENABLE_NOTIFICATION_TEST_ROUTES;
    delete process.env.NOTIFICATION_TEST_SECRET;
  });
  afterEach(() => {
    delete process.env.ENABLE_NOTIFICATION_TEST_ROUTES;
    delete process.env.NOTIFICATION_TEST_SECRET;
  });

  it("returns 404 in production when ENABLE_NOTIFICATION_TEST_ROUTES is unset", async () => {
    const app = createApp({ NODE_ENV: "production" });
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      headers: { "x-locava-debug-secret": "s" },
      payload: { recipientId: "r1", type: "like", postId: "p1" }
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 when secret header mismatches NOTIFICATION_TEST_SECRET", async () => {
    const app = createApp({
      NODE_ENV: "development",
      NOTIFICATION_TEST_SECRET: "correct",
    });
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      headers: { "x-locava-debug-secret": "wrong" },
      payload: { recipientId: "r1", type: "like", postId: "p1", createInApp: false, sendPush: false }
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 400 for invalid JSON body", async () => {
    const app = createApp({
      NODE_ENV: "development",
      NOTIFICATION_TEST_SECRET: "s",
    });
    const res = await app.inject({
      method: "POST",
      url: ROUTE,
      headers: { "x-locava-debug-secret": "s" },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
