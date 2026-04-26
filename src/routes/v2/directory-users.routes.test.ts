import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 directory users route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("returns lean users-only payload for first render", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/directory/users?q=creator&limit=8",
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("directory.users.get");
    expect(body.page.sort).toBe("directory_users_relevance_v1");
    expect(body.items.length).toBeLessThanOrEqual(8);
    if (body.items.length > 0) {
      const row = body.items[0];
      expect(row.userId).toBeDefined();
      expect(row.handle).toBeDefined();
      expect(row.displayName !== undefined).toBe(true);
      expect(row.profilePic !== undefined).toBe(true);
      expect(row.posts).toBeUndefined();
      expect(row.collections).toBeUndefined();
    }
  });

  it("collapses repeated identical requests toward near-zero reads", async () => {
    const url = "/v2/directory/users?q=creator&limit=8";
    const cold = await app.inject({ method: "GET", url, headers });
    expect(cold.statusCode).toBe(200);
    const warm = await app.inject({ method: "GET", url, headers });
    expect(warm.statusCode).toBe(200);
    expect(warm.json().meta.db.reads).toBe(0);
    expect(warm.json().meta.db.queries).toBe(0);
  });

  it("handles rapid query churn with bounded behavior", async () => {
    const [a, b, c] = await Promise.all([
      app.inject({ method: "GET", url: "/v2/directory/users?q=crea&limit=8", headers }),
      app.inject({ method: "GET", url: "/v2/directory/users?q=creator&limit=8", headers }),
      app.inject({ method: "GET", url: "/v2/directory/users?q=creators&limit=8", headers })
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(c.statusCode).toBe(200);
    expect(a.json().data.queryEcho).toBe("crea");
    expect(b.json().data.queryEcho).toBe("creator");
    expect(c.json().data.queryEcho).toBe("creators");
  });

  it("supports users-only directory baseline when q is empty", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/directory/users?limit=6",
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.queryEcho).toBe("");
    expect(body.page.limit).toBe(6);
    expect(body.items.length).toBeLessThanOrEqual(6);
  });

  it("emits route policy and diagnostics metadata", async () => {
    await app.inject({ method: "GET", url: "/v2/directory/users?q=creator&limit=8", headers });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=80" });
    const row = diagnostics
      .json()
      .data.recentRequests.find((r: { routeName?: string }) => r.routeName === "directory.users.get");
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("directory.users.get");
    expect(typeof row.payloadBytes).toBe("number");
    expect(typeof row.dbOps.reads).toBe("number");
    expect(typeof row.cache.hits).toBe("number");
    expect(typeof row.dedupe.hits).toBe("number");
    expect(typeof row.concurrency.waits).toBe("number");
    expect(Array.isArray(row.fallbacks)).toBe(true);
    expect(Array.isArray(row.timeouts)).toBe(true);
    expect(Array.isArray(row.budgetViolations)).toBe(true);
  });
});
