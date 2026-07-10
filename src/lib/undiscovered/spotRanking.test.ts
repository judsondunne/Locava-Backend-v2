import { describe, it, expect, beforeEach } from "vitest";
import {
  combineRanking,
  computeLocalRankSignals,
  rankCandidate,
  resetWebSearchCache,
  scoreWebSearchResponse,
  type WebSearchResponse,
} from "./spotRanking.js";
import type { DiscoveryCandidate } from "../../contracts/surfaces/undiscovered-candidate.contract.js";

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    id: "osm_pbf:node:1",
    region: "VT",
    sourceChannel: "osm_pbf",
    kind: "spot",
    targetCollection: "unexploredSpots",
    displayName: "Moss Glen Falls",
    primaryCategory: "waterfall",
    categories: ["waterfall"],
    primaryActivity: null,
    activities: [],
    lat: 44.5,
    lng: -72.7,
    reviewStatus: "candidate",
    qualityGate: { passed: true, reasons: [] },
    provenance: { sourceProvider: "osm-pbf", sourceIds: [], sourceKeys: ["natural=waterfall", "name=Moss Glen Falls"] },
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  } as DiscoveryCandidate;
}

// Modeled on the live probe: famous spot → outdoor/authority domains.
const FAMOUS_RESPONSE: WebSearchResponse = {
  organic: [
    { title: "Moss Glen Falls - Stowe", link: "https://www.gostowe.com/things/moss-glen-falls", snippet: "Moss Glen Falls is a stunning..." },
    { title: "Moss Glen Falls (Stowe) - Tripadvisor", link: "https://www.tripadvisor.com/x", snippet: "Moss Glen Falls review" },
    { title: "Moss Glen Falls Trail - AllTrails", link: "https://www.alltrails.com/trail/x", snippet: "Moss Glen Falls trail" },
    { title: "Moss Glen Falls - World of Waterfalls", link: "https://www.world-of-waterfalls.com/x", snippet: "Moss Glen Falls hike" },
    { title: "Moss Glen Falls video", link: "https://www.youtube.com/watch?v=1", snippet: "Moss Glen Falls drone" },
  ],
};

// Modeled on the live probe: obscure spot → scraper-only domains.
const SCRAPER_RESPONSE: WebSearchResponse = {
  organic: [
    { title: "Laird Pond Dam Topo Map", link: "https://www.mytopo.com/x", snippet: "Laird Pond Dam topo" },
    { title: "Laird Pond Dam, VT", link: "https://www.anyplaceamerica.com/x", snippet: "Laird Pond Dam location" },
    { title: "Weather Laird Pond Dam", link: "https://no.viewweather.com/x", snippet: "Laird Pond Dam weather" },
    { title: "Laird Pond Dam GPS", link: "https://www.expertgps.com/x", snippet: "Laird Pond Dam coordinates" },
  ],
};

describe("computeLocalRankSignals", () => {
  it("waterfall with wikipedia tag beats generic other", () => {
    const wiki = computeLocalRankSignals(
      candidate({ provenance: { sourceProvider: "osm-pbf", sourceIds: [], sourceKeys: ["natural=waterfall", "wikipedia=en:Moss Glen Falls"] } }),
    );
    const generic = computeLocalRankSignals(candidate({ primaryCategory: "other", displayName: "Thing", provenance: { sourceProvider: "x", sourceIds: [], sourceKeys: [] } }));
    expect(wiki.score).toBeGreaterThan(generic.score);
    expect(wiki.signals).toContain("osm_wikipedia_tag");
  });

  it("caps at 30", () => {
    const s = computeLocalRankSignals(
      candidate({ provenance: { sourceProvider: "x", sourceIds: [], sourceKeys: ["a=1","b=2","c=3","d=4","e=5","f=6","g=7","wikipedia=x","website=y"] } }),
    );
    expect(s.score).toBeLessThanOrEqual(30);
  });
});

describe("scoreWebSearchResponse", () => {
  it("famous spot scores far above scraper-only obscure spot", () => {
    const famous = scoreWebSearchResponse("Moss Glen Falls", FAMOUS_RESPONSE);
    const obscure = scoreWebSearchResponse("Laird Pond Dam", SCRAPER_RESPONSE);
    expect(famous.webAuthority).toBeGreaterThan(10);
    expect(obscure.webAuthority).toBe(0);
    expect(famous.signals.some((s) => s.startsWith("authority:"))).toBe(true);
  });

  it("ignores hits that never mention the place name", () => {
    const r = scoreWebSearchResponse("Moss Glen Falls", {
      organic: [{ title: "Best Vermont hikes", link: "https://www.alltrails.com/y", snippet: "great trails" }],
    });
    expect(r.webAuthority).toBe(0);
  });

  it("knowledge graph adds authority", () => {
    const r = scoreWebSearchResponse("Moss Glen Falls", { organic: [], knowledgeGraph: { title: "Moss Glen Falls" } });
    expect(r.webAuthority).toBe(3);
  });
});

describe("combineRanking", () => {
  it("high local + high web → S tier; scraper-only quality spot → hidden gem", () => {
    const local = computeLocalRankSignals(candidate());
    const famous = combineRanking(local, scoreWebSearchResponse("Moss Glen Falls", FAMOUS_RESPONSE));
    expect(famous.tier).toBe("S");
    const obscure = combineRanking(local, scoreWebSearchResponse("Laird Pond Dam", SCRAPER_RESPONSE));
    expect(["B", "C"]).toContain(obscure.tier);
    expect(obscure.hiddenGem).toBe(true);
    expect(obscure.signals).toContain("hidden_gem");
  });

  it("local-only ranking has no webAuthority", () => {
    const r = combineRanking(computeLocalRankSignals(candidate()), null);
    expect(r.webAuthority).toBeUndefined();
    expect(r.score).toBeLessThanOrEqual(30);
  });
});

describe("isWebRankableName", () => {
  it("rejects generic and numeric names, accepts distinctive ones", async () => {
    const { isWebRankableName } = await import("./spotRanking.js");
    for (const bad of ["Beach", "Baseball Field", "1792", "Old Trail", "North Pond"]) {
      expect(isWebRankableName(bad), bad).toBe(false);
    }
    for (const good of ["Moss Glen Falls", "Quechee Gorge Trail", "Advent Hill"]) {
      expect(isWebRankableName(good), good).toBe(true);
    }
  });

  it("generic names never spend web credits", async () => {
    resetWebSearchCache();
    let calls = 0;
    const fetcher = async () => { calls += 1; return FAMOUS_RESPONSE; };
    const r = await rankCandidate(candidate({ displayName: "Beach", primaryCategory: "beach" }), { fetcher });
    expect(calls).toBe(0);
    expect(r.usedWeb).toBe(false);
    expect(r.ranking.webAuthority).toBeUndefined();
  });
});

describe("rankCandidate cache", () => {
  beforeEach(() => resetWebSearchCache());

  it("spends one credit per unique name only", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return FAMOUS_RESPONSE;
    };
    const c = candidate();
    const first = await rankCandidate(c, { fetcher });
    const second = await rankCandidate(c, { fetcher });
    expect(calls).toBe(1);
    expect(first.spentCredit).toBe(true);
    expect(second.spentCredit).toBe(false);
    expect(second.ranking.score).toBe(first.ranking.score);
  });
});
