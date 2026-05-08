import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 admin check route", () => {
  const previousAdminUids = process.env.ADMIN_UIDS;
  const previousAnalyticsAdminUids = process.env.ANALYTICS_ADMIN_UIDS;

  afterEach(() => {
    process.env.ADMIN_UIDS = previousAdminUids;
    process.env.ANALYTICS_ADMIN_UIDS = previousAnalyticsAdminUids;
  });

  it("returns isAdmin true when viewer uid is in configured admin uid list", async () => {
    process.env.ADMIN_UIDS = "admin-user-1";
    process.env.ANALYTICS_ADMIN_UIDS = "admin-user-1";
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/admin/check",
      headers: {
        "x-viewer-id": "admin-user-1",
        "x-viewer-roles": "internal",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      routeName: "admin.check.get",
      viewerId: "admin-user-1",
      isAdmin: true,
    });
  });

  it("returns isAdmin false for a non-admin viewer", async () => {
    process.env.ADMIN_UIDS = "admin-user-1";
    process.env.ANALYTICS_ADMIN_UIDS = "admin-user-1";
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/admin/check",
      headers: {
        "x-viewer-id": "regular-user-1",
        "x-viewer-roles": "internal",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      routeName: "admin.check.get",
      viewerId: "regular-user-1",
      isAdmin: false,
    });
  });
});
