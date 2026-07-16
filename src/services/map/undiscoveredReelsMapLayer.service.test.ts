import { describe, it, expect } from "vitest";
import { buildReelMapFeatures, parseReelMapBbox } from "./undiscoveredReelsMapLayer.service.js";
import type { UndiscoveredReel } from "../../contracts/surfaces/undiscovered-reels.contract.js";

function reel(over: Partial<UndiscoveredReel> & { id: string; lat: number | null; lng: number | null }): UndiscoveredReel {
  const { lat, lng, id, ...rest } = over;
  return {
    id,
    kind: "undiscovered_reel",
    sourceCollection: "undiscoveredReels",
    region: "VT",
    shortcode: over.id,
    reelUrl: `https://instagram.com/reel/${over.id}/`,
    caption: "",
    videoUrl: null,
    thumbnailUrl: null,
    creator: { username: "c", fullName: null, profilePicUrl: null, profileUrl: null },
    location: { extractedName: null, lat, lng, source: "spot_match", matchedSpotId: "s1", matchedSpotCollection: "unexploredSpots", confidence: 1 },
    engagement: { playCount: null, likeCount: null, commentCount: null },
    qualityScore: 0,
    reviewStatus: "candidate",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...rest,
  } as UndiscoveredReel;
}

const VT = { west: -73.5, south: 42.7, east: -71.5, north: 45.1 }; // Vermont-ish

describe("parseReelMapBbox", () => {
  it("parses west,south,east,north", () => {
    expect(parseReelMapBbox("-73.5,42.7,-71.5,45.1")).toEqual(VT);
  });
  it("rejects malformed or inverted bboxes", () => {
    expect(parseReelMapBbox("1,2,3")).toBeNull();
    expect(parseReelMapBbox("a,b,c,d")).toBeNull();
    expect(parseReelMapBbox("-73,45,-71,42")).toBeNull(); // south > north
  });
});

describe("buildReelMapFeatures", () => {
  const reels = [
    reel({ id: "in-hi", lat: 44.1, lng: -72.8, qualityScore: 90 }),
    reel({ id: "in-lo", lat: 44.5, lng: -72.6, qualityScore: 10 }),
    reel({ id: "out", lat: 40.0, lng: -74.0, qualityScore: 99 }), // NYC — outside bbox
    reel({ id: "nocoord", lat: null, lng: null, qualityScore: 50 }),
    reel({ id: "rejected", lat: 44.2, lng: -72.7, qualityScore: 80, reviewStatus: "rejected" }),
    reel({ id: "playable", lat: 44.3, lng: -72.5, qualityScore: 40, videoUrl: "https://wasabi/v.mp4" }),
  ];

  it("keeps only in-bbox, non-rejected, coordinate-bearing reels, best quality first", () => {
    const { features } = buildReelMapFeatures(reels, VT, { limit: 50, playableOnly: false });
    expect(features.map((f) => f.id)).toEqual(["in-hi", "playable", "in-lo"]);
  });

  it("marks playable correctly", () => {
    const { features } = buildReelMapFeatures(reels, VT, { limit: 50, playableOnly: false });
    expect(features.find((f) => f.id === "playable")!.playable).toBe(true);
    expect(features.find((f) => f.id === "in-hi")!.playable).toBe(false);
  });

  it("playableOnly returns just ingested reels", () => {
    const { features } = buildReelMapFeatures(reels, VT, { limit: 50, playableOnly: true });
    expect(features.map((f) => f.id)).toEqual(["playable"]);
  });

  it("truncates to the limit and flags it", () => {
    const { features, truncated } = buildReelMapFeatures(reels, VT, { limit: 1, playableOnly: false });
    expect(features).toHaveLength(1);
    expect(truncated).toBe(true);
  });
});
