import { describe, expect, it } from "vitest";
import { defineContract, EmptySchema } from "../contracts/conventions.js";
import { buildCacheKey } from "../cache/types.js";
import { InMemoryCacheStore } from "../cache/in-memory-cache.js";
import { dedupeInFlight } from "../cache/in-flight-dedupe.js";
import { runLimited } from "../orchestration/concurrency.js";
import { runStep } from "../orchestration/partial-failure.js";
import { TimeoutError, withTimeout } from "../orchestration/timeouts.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { buildRouteName } from "./route-name.js";

describe("shared primitives", () => {
  it("validates contract route naming", () => {
    const contract = defineContract({
      routeName: "profile.bootstrap.get",
      method: "GET",
      path: "/v2/profiles/:id/bootstrap",
      query: EmptySchema,
      body: EmptySchema,
      response: EmptySchema
    });

    expect(contract.routeName).toBe("profile.bootstrap.get");
  });

  it("builds cache keys and stores values", async () => {
    const cache = new InMemoryCacheStore();
    const key = buildCacheKey("entity", ["user", "123"]);
    await cache.set(key, { name: "Ada" }, 1000);
    const value = await cache.get<{ name: string }>(key);
    expect(value?.name).toBe("Ada");
  });

  it("dedupes in-flight work", async () => {
    let calls = 0;
    const run = () =>
      dedupeInFlight("k", async () => {
        calls += 1;
        return "ok";
      });

    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(calls).toBe(1);
  });

  it("runs tasks with concurrency cap", async () => {
    const values = await runLimited(
      [
        async () => 1,
        async () => 2,
        async () => 3
      ],
      2
    );

    expect(values).toEqual([1, 2, 3]);
  });

  it("captures partial failure outcomes", async () => {
    const success = await runStep("fetch_profile", async () => "ok");
    const failure = await runStep("fetch_feed", async () => {
      throw new Error("boom");
    });

    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
  });

  it("enforces timeout helper", async () => {
    await expect(withTimeout(new Promise((resolve) => setTimeout(() => resolve("x"), 25)), 5, "test")).rejects.toBeInstanceOf(
      TimeoutError
    );
  });

  it("encodes and decodes cursors", () => {
    const payload = { id: "abc", createdAtMs: 123 };
    const cursor = encodeCursor(payload);
    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual(payload);
  });

  it("builds route names consistently", () => {
    expect(buildRouteName("search", "bootstrap", "GET")).toBe("search.bootstrap.get");
  });
});
