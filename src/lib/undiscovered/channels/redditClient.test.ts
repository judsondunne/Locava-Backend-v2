import { describe, it, expect, beforeEach } from "vitest";
import {
  parseTokenResponse,
  parseSearchListing,
  getRedditAppToken,
  hasRedditCreds,
  fetchRedditSearchItems,
  resetRedditTokenCache,
} from "./redditClient.js";
import { redditAdapter } from "./redditAdapter.js";

beforeEach(() => resetRedditTokenCache());

describe("reddit oauth helpers", () => {
  it("hasRedditCreds requires id + secret", () => {
    expect(hasRedditCreds({ clientId: "a", clientSecret: "b" })).toBe(true);
    expect(hasRedditCreds({ clientId: "a" })).toBe(false);
    expect(hasRedditCreds(undefined)).toBe(false);
  });

  it("parseTokenResponse reads token + expiry", () => {
    expect(parseTokenResponse({ access_token: "tok", expires_in: 100 })).toEqual({ token: "tok", expiresIn: 100 });
    expect(parseTokenResponse({})).toBeNull();
  });

  it("parseSearchListing pulls post titles", () => {
    const items = parseSearchListing({
      data: { children: [{ data: { id: "x", title: "Warren Falls", permalink: "/r/vermont/x" } }, {}] },
    });
    expect(items.length).toBe(1);
    expect(items[0]!.text).toBe("Warren Falls");
    expect(items[0]!.sourceUrl).toContain("reddit.com/r/vermont/x");
  });

  it("getRedditAppToken exchanges creds for a bearer token (injected fetch)", async () => {
    let calledUrl = "";
    const fakeFetch = (async (url: string) => {
      calledUrl = String(url);
      return { ok: true, json: async () => ({ access_token: "BEARER", expires_in: 3600 }) };
    }) as unknown as typeof fetch;
    const token = await getRedditAppToken({ clientId: "id", clientSecret: "sec" }, fakeFetch);
    expect(token).toBe("BEARER");
    expect(calledUrl).toContain("access_token");
  });

  it("caches the token across calls", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return { ok: true, json: async () => ({ access_token: "T", expires_in: 3600 }) };
    }) as unknown as typeof fetch;
    await getRedditAppToken({ clientId: "id", clientSecret: "sec" }, fakeFetch);
    await getRedditAppToken({ clientId: "id", clientSecret: "sec" }, fakeFetch);
    expect(calls).toBe(1);
  });

  it("returns null token without creds", async () => {
    expect(await getRedditAppToken({})).toBeNull();
  });
});

describe("reddit adapter authed path", () => {
  it("uses OAuth search when creds present and extracts VT spots", async () => {
    let sawAuthHeader = false;
    const fakeFetch = (async (url: string, opts?: RequestInit) => {
      if (String(url).includes("access_token")) {
        return { ok: true, json: async () => ({ access_token: "BEARER", expires_in: 3600 }) };
      }
      if ((opts?.headers as Record<string, string>)?.Authorization === "Bearer BEARER") sawAuthHeader = true;
      return {
        ok: true,
        json: async () => ({
          data: { children: [{ data: { id: "p1", title: "Texas Falls in Vermont is stunning", permalink: "/r/vermont/p1" } }] },
        }),
      };
    }) as unknown as typeof fetch;

    const items = await fetchRedditSearchItems({
      creds: { clientId: "id", clientSecret: "sec" },
      subreddits: ["vermont"],
      query: "waterfall",
      limit: 10,
      fetchImpl: fakeFetch,
    });
    expect(sawAuthHeader).toBe(true);
    expect(items[0]!.text).toContain("Texas Falls");
  });

  it("adapter falls back to rawItems without creds", async () => {
    const cands = await redditAdapter.fetchCandidates({
      region: "VT",
      rawItems: [{ sourceId: "r1", text: "Moss Glen Falls, Vermont", sourceUrl: "https://x" }],
    });
    expect(cands[0]!.displayName).toBe("Moss Glen Falls");
  });
});
