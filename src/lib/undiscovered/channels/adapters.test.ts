import { describe, it, expect } from "vitest";
import { redditAdapter, parseRedditListing } from "./redditAdapter.js";
import { trailAdapter } from "./trailAdapter.js";
import { webBlogAdapter, htmlToText } from "./webBlogAdapter.js";
import { instagramAdapter } from "./instagramAdapter.js";
import { getChannelAdapter, listChannelAdapters } from "./registry.js";

describe("registry", () => {
  it("exposes the four channels", () => {
    const channels = listChannelAdapters().map((a) => a.channel).sort();
    expect(channels).toEqual(["instagram", "reddit", "trail_db", "web_blog"]);
  });
  it("looks up by channel", () => {
    expect(getChannelAdapter("reddit")?.label).toBe("Reddit");
    expect(getChannelAdapter("nope")).toBeUndefined();
  });
});

describe("redditAdapter", () => {
  it("fetches via injected httpGetJson and extracts VT spots", async () => {
    const fakeJson = {
      data: {
        children: [
          { data: { id: "aaa", title: "Warren Falls near Stowe is incredible", permalink: "/r/vermont/aaa" } },
          { data: { id: "bbb", title: "Cool waterfall in Utah" } },
        ],
      },
    };
    const cands = await redditAdapter.fetchCandidates({
      region: "VT",
      httpGetJson: async () => fakeJson,
    });
    expect(cands.length).toBe(1);
    expect(cands[0]!.displayName).toBe("Warren Falls");
    expect(cands[0]!.sourceChannel).toBe("reddit");
  });

  it("parseRedditListing tolerates junk", () => {
    expect(parseRedditListing({})).toEqual([]);
    expect(parseRedditListing({ data: { children: [{}] } })).toEqual([]);
  });
});

describe("trailAdapter", () => {
  it("trusts structured named+geocoded trail items", async () => {
    const cands = await trailAdapter.fetchCandidates({
      region: "VT",
      rawItems: [
        { sourceId: "t1", text: "", lat: 44.3, lng: -72.9, extra: { name: "Camel's Hump Loop", category: "hiking_trail" } },
        { sourceId: "t2", text: "", lat: 40.0, lng: -74.0, extra: { name: "Out of state trail" } }, // dropped
      ],
    });
    expect(cands.length).toBe(1);
    expect(cands[0]!.displayName).toBe("Camel's Hump Loop");
    expect(cands[0]!.kind).toBe("route");
    expect(cands[0]!.qualityGate.reasons).toContain("trail_db_structured");
  });
});

describe("webBlogAdapter", () => {
  it("htmlToText strips tags and scripts", () => {
    const t = htmlToText("<p>Visit <b>Texas Falls</b></p><script>bad()</script> in Vermont");
    expect(t).toContain("Texas Falls");
    expect(t).not.toContain("bad()");
  });
  it("extracts from pre-fetched blog text", async () => {
    const cands = await webBlogAdapter.fetchCandidates({
      region: "VT",
      rawItems: [{ sourceId: "b1", text: "Top Vermont spots: Texas Falls and Bristol Falls", sourceUrl: "https://blog/x" }],
    });
    expect(cands.map((c) => c.displayName).sort()).toEqual(["Bristol Falls", "Texas Falls"]);
  });
});

describe("instagramAdapter", () => {
  it("is started (not live) but extracts from pasted captions", async () => {
    expect(instagramAdapter.liveFetchSupported).toBe(false);
    const cands = await instagramAdapter.fetchCandidates({
      region: "VT",
      rawItems: [{ sourceId: "ig1", text: "chasing Moss Glen Falls in Vermont 💧", sourceUrl: "https://ig/1" }],
    });
    expect(cands.length).toBe(1);
    expect(cands[0]!.displayName).toBe("Moss Glen Falls");
    expect(cands[0]!.sourceChannel).toBe("instagram");
  });
});
