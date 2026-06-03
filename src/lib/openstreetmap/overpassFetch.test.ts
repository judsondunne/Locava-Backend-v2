import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOverpassJson } from "./overpassFetch.js";

describe("fetchOverpassJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OVERPASS_URL;
  });

  it("retries on fetch failed and succeeds on second attempt", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("fetch failed");
        return {
          ok: true,
          json: async () => ({ elements: [] }),
        };
      })
    );

    const json = await fetchOverpassJson({ query: "[out:json];node(1);out;", userAgent: "test" });
    expect(json).toEqual({ elements: [] });
    expect(calls).toBe(2);
  });

  it("falls back to next mirror when first returns 504", async () => {
    const hosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        hosts.push(new URL(url).hostname);
        if (hosts.length === 1) {
          return { ok: false, status: 504, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ elements: [{ id: 1 }] }) };
      })
    );

    const json = (await fetchOverpassJson({ query: "[out:json];node(1);out;", userAgent: "test" })) as {
      elements: unknown[];
    };
    expect(json.elements).toHaveLength(1);
    expect(hosts.length).toBeGreaterThanOrEqual(2);
  });
});
