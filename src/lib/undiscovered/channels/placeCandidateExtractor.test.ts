import { describe, it, expect } from "vitest";
import {
  extractPlaceCandidatesFromText,
  isRegionRelevant,
  itemsToChannelCandidates,
  VERMONT_BBOX,
} from "./placeCandidateExtractor.js";
import { DiscoveryCandidateSchema } from "../../../contracts/surfaces/undiscovered-candidate.contract.js";

describe("extractPlaceCandidatesFromText", () => {
  it("pulls named nature spots and classifies them", () => {
    const out = extractPlaceCandidatesFromText(
      "Spent the day at Warren Falls then hiked the Quechee Gorge Trail near Emerald Lake.",
    );
    const names = out.map((o) => o.name);
    expect(names).toContain("Warren Falls");
    expect(names).toContain("Quechee Gorge Trail");
    expect(names).toContain("Emerald Lake");
    const falls = out.find((o) => o.name === "Warren Falls");
    expect(falls?.category).toBe("waterfall");
    expect(falls?.kind).toBe("spot");
    const trail = out.find((o) => o.name === "Quechee Gorge Trail");
    expect(trail?.kind).toBe("route");
  });

  it("dedupes repeated names and ignores lowercase noise", () => {
    const out = extractPlaceCandidatesFromText("warren falls warren falls, some random text");
    expect(out.length).toBe(0); // needs capitalized names
  });
});

describe("isRegionRelevant", () => {
  it("passes items with coords inside the Vermont bbox", () => {
    expect(isRegionRelevant({ sourceId: "a", text: "x", lat: 44.1, lng: -72.8 }, "VT")).toBe(true);
    expect(isRegionRelevant({ sourceId: "a", text: "x", lat: 40.0, lng: -74.0 }, "VT")).toBe(false);
  });

  it("passes text-only items only with a Vermont keyword", () => {
    expect(isRegionRelevant({ sourceId: "a", text: "Best swimming holes in Vermont" }, "VT")).toBe(true);
    expect(isRegionRelevant({ sourceId: "a", text: "Best swimming holes in Colorado" }, "VT")).toBe(false);
  });

  it("bbox constants are sane", () => {
    expect(VERMONT_BBOX.minLat).toBeLessThan(VERMONT_BBOX.maxLat);
    expect(VERMONT_BBOX.minLng).toBeLessThan(VERMONT_BBOX.maxLng);
  });
});

describe("itemsToChannelCandidates", () => {
  it("produces valid, region-gated candidates", () => {
    const items = [
      { sourceId: "p1", text: "Hidden Warren Falls in Vermont is amazing", sourceUrl: "https://r/x" },
      { sourceId: "p2", text: "Great waterfall in Oregon" }, // dropped: not VT
    ];
    const cands = itemsToChannelCandidates(items, {
      channel: "reddit",
      region: "VT",
      sourceProvider: "reddit-search",
      nowIso: "2026-06-26T00:00:00.000Z",
    });
    expect(cands.length).toBe(1);
    expect(cands[0]!.sourceChannel).toBe("reddit");
    expect(cands[0]!.displayName).toBe("Warren Falls");
    expect(cands[0]!.provenance.sourceUrl).toBe("https://r/x");
    expect(() => DiscoveryCandidateSchema.parse(cands[0])).not.toThrow();
  });
});
