import { describe, it, expect, vi } from "vitest";
import {
  spotNameToHashtags,
  parseHashtagWebInfo,
  filterReelsByCaption,
  fetchReelsForSpot,
} from "./fetchReelsByHashtag.js";

/** Minimal fixture shaped like IG's tags/web_info payload (top + recent sections). */
function makeWebInfo(medias: Array<Record<string, unknown>>) {
  return {
    data: {
      top: { sections: [{ layout_content: { medias: medias.map((media) => ({ media })) } }] },
      recent: { sections: [] },
    },
  };
}

function clip(code: string, caption: string, user: Record<string, unknown> = { username: "creator", full_name: "A Creator" }) {
  return { code, product_type: "clips", caption: { text: caption }, user };
}

describe("spotNameToHashtags", () => {
  it("strips punctuation/spaces and adds regional variants", () => {
    expect(spotNameToHashtags("Warren Falls")).toEqual(["warrenfalls", "warrenfallsvt", "warrenfallsvermont"]);
  });

  it("handles apostrophes and periods", () => {
    expect(spotNameToHashtags("Devil's Gulch")).toEqual(["devilsgulch", "devilsgulchvt", "devilsgulchvermont"]);
  });

  it("returns nothing for a too-short name", () => {
    expect(spotNameToHashtags("A")).toEqual([]);
  });
});

describe("parseHashtagWebInfo", () => {
  it("extracts clips with shortcode, caption, and owner", () => {
    const payload = makeWebInfo([clip("Cx001", "Warren Falls swimming hole")]);
    const reels = parseHashtagWebInfo(payload);
    expect(reels).toHaveLength(1);
    const reel = reels[0]!;
    expect(reel.shortcode).toBe("Cx001");
    expect(reel.caption).toBe("Warren Falls swimming hole");
    expect(reel.reelUrl).toBe("https://www.instagram.com/reel/Cx001/");
    expect(reel.ownerUsername).toBe("creator");
    // owner object is passed through for authoritative creator extraction
    expect((reel.ownerRaw as { owner: { username: string } }).owner.username).toBe("creator");
  });

  it("skips non-clip media (photos)", () => {
    const payload = makeWebInfo([
      { code: "Cp001", product_type: "feed", caption: { text: "a photo" }, user: {} },
      clip("Cx002", "a reel"),
    ]);
    const reels = parseHashtagWebInfo(payload);
    expect(reels.map((r) => r.shortcode)).toEqual(["Cx002"]);
  });

  it("dedupes repeated shortcodes across sections", () => {
    const payload = makeWebInfo([clip("Cx003", "one"), clip("Cx003", "one again")]);
    expect(parseHashtagWebInfo(payload)).toHaveLength(1);
  });

  it("returns empty for malformed payloads", () => {
    expect(parseHashtagWebInfo(null)).toEqual([]);
    expect(parseHashtagWebInfo({})).toEqual([]);
    expect(parseHashtagWebInfo({ data: {} })).toEqual([]);
  });

  it("extracts clips from fill_items and one_by_two_item.clips containers", () => {
    // Mirrors IG's real layout: a featured clip in one_by_two_item.clips.items
    // plus a grid in fill_items — neither is the plain `medias[]` array.
    const payload = {
      data: {
        top: {
          sections: [
            {
              layout_content: {
                one_by_two_item: { clips: { items: [{ media: clip("Cx100", "featured Warren Falls") }] } },
                fill_items: [{ media: clip("Cx101", "grid Warren Falls") }],
              },
            },
          ],
        },
        recent: { sections: [] },
      },
    };
    expect(parseHashtagWebInfo(payload).map((r) => r.shortcode).sort()).toEqual(["Cx100", "Cx101"]);
  });
});

describe("filterReelsByCaption", () => {
  it("keeps only reels whose caption mentions the spot", () => {
    const reels = parseHashtagWebInfo(
      makeWebInfo([clip("Cx1", "Warren Falls today 💦"), clip("Cx2", "just good vibes")]),
    );
    const kept = filterReelsByCaption(reels, "Warren Falls");
    expect(kept.map((r) => r.shortcode)).toEqual(["Cx1"]);
  });

  it("is punctuation-insensitive", () => {
    const reels = parseHashtagWebInfo(makeWebInfo([clip("Cx1", "hiked to Devils Gulch")]));
    expect(filterReelsByCaption(reels, "Devil's Gulch")).toHaveLength(1);
  });

  it("matches the collapsed hashtag form (#warrenfalls)", () => {
    const reels = parseHashtagWebInfo(
      makeWebInfo([clip("Cx1", "#warrenfalls #vermont"), clip("Cx2", "just a walk")]),
    );
    expect(filterReelsByCaption(reels, "Warren Falls").map((r) => r.shortcode)).toEqual(["Cx1"]);
  });
});

describe("fetchReelsForSpot", () => {
  it("queries each candidate hashtag, dedupes, and caption-filters", async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes("tag_name=warrenfalls&") || url.includes("tag_name=warrenfalls?") || url.endsWith("tag_name=warrenfalls")) {
        return makeWebInfo([clip("Cx1", "Warren Falls 💦"), clip("Cx2", "unrelated")]);
      }
      // regional-variant tags return the same top reel plus a new one
      return makeWebInfo([clip("Cx1", "Warren Falls again"), clip("Cx3", "Warren Falls sunset")]);
    });
    const reels = await fetchReelsForSpot("Warren Falls", { httpGetJson });
    // 3 hashtag variants queried
    expect(httpGetJson).toHaveBeenCalledTimes(3);
    // Cx2 filtered out (no mention), Cx1 deduped, Cx1 + Cx3 kept
    expect(reels.map((r) => r.shortcode).sort()).toEqual(["Cx1", "Cx3"]);
  });

  it("survives a failing hashtag request", async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes("warrenfallsvt")) throw new Error("ig_hashtag_429");
      return makeWebInfo([clip("Cx1", "Warren Falls")]);
    });
    const reels = await fetchReelsForSpot("Warren Falls", { httpGetJson });
    expect(reels.map((r) => r.shortcode)).toEqual(["Cx1"]);
  });

  it("sends the cookie header when provided", async () => {
    const httpGetJson = vi.fn(async (_url: string, _headers: Record<string, string>) => makeWebInfo([]));
    await fetchReelsForSpot("Warren Falls", { httpGetJson, cookieHeader: "sessionid=abc" });
    const headers = httpGetJson.mock.calls[0]![1];
    expect(headers.Cookie).toBe("sessionid=abc");
    expect(headers["X-IG-App-ID"]).toBe("936619743392459");
  });
});
