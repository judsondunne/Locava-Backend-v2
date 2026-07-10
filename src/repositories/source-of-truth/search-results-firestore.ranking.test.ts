import { describe, expect, it } from "vitest";
import { blendedSemanticScore, distanceMiles, geoDecay } from "./search-ranking-math.js";
import type { SearchablePost } from "./search-results-firestore.adapter.js";

function makePost(overrides: Partial<SearchablePost> = {}): SearchablePost {
  return {
    postId: "p1",
    userId: "u1",
    userHandle: "h",
    userName: "n",
    userPic: null,
    updatedAtMs: 0,
    activities: [],
    title: "",
    caption: "",
    description: "",
    thumbUrl: "https://cdn/x.jpg",
    displayPhotoLink: "https://cdn/x.jpg",
    mediaType: "image",
    stateRegionId: null,
    cityRegionId: null,
    lat: null,
    lng: null,
    geohash: null,
    address: null,
    assets: null,
    likeCount: 0,
    commentCount: 0,
    ...overrides
  };
}

describe("distanceMiles (haversine)", () => {
  it("computes a known city pair within tolerance (NYC → Philadelphia ≈ 80mi)", () => {
    const nyc = { lat: 40.7128, lng: -74.006 };
    const philly = { lat: 39.9526, lng: -75.1652 };
    const d = distanceMiles(nyc, philly);
    expect(d).toBeGreaterThan(75);
    expect(d).toBeLessThan(85);
  });

  it("does not overstate east–west distance the way Euclidean*69 did", () => {
    // 1° of longitude at 40°N is ~53mi, not 69mi. Euclidean*69 would report ~69.
    const a = { lat: 40, lng: -75 };
    const b = { lat: 40, lng: -74 };
    const d = distanceMiles(a, b);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(56);
  });
});

describe("geoDecay", () => {
  it("is 1 at the viewer and monotonically decreasing", () => {
    expect(geoDecay(0)).toBe(1);
    expect(geoDecay(25)).toBeCloseTo(0.5, 5);
    expect(geoDecay(10)).toBeGreaterThan(geoDecay(100));
  });

  it("clamps invalid input to 0", () => {
    expect(geoDecay(Number.NaN)).toBe(0);
    expect(geoDecay(-5)).toBe(0);
  });
});

describe("blendedSemanticScore", () => {
  it("ranks a strong semantic match (low cosine distance) above a weak one", () => {
    const strong = blendedSemanticScore(makePost(), {
      query: "swimming hole",
      activity: null,
      semanticDistance: 0.05,
      viewerCoords: null
    });
    const weak = blendedSemanticScore(makePost(), {
      query: "swimming hole",
      activity: null,
      semanticDistance: 0.9,
      viewerCoords: null
    });
    expect(strong).toBeGreaterThan(weak);
  });

  it("treats a missing embedding (non-ANN candidate) as zero semantic similarity", () => {
    const noEmbedding = blendedSemanticScore(makePost(), {
      query: "anything",
      activity: null,
      semanticDistance: undefined,
      viewerCoords: null
    });
    expect(noEmbedding).toBe(0);
  });

  it("nearby beats distant at equal semantic similarity (geo decay, not a cutoff)", () => {
    const viewer = { lat: 40, lng: -75 };
    const near = blendedSemanticScore(makePost({ lat: 40.05, lng: -75.05 }), {
      query: "q",
      activity: null,
      semanticDistance: 0.2,
      viewerCoords: viewer
    });
    const far = blendedSemanticScore(makePost({ lat: 45, lng: -80 }), {
      query: "q",
      activity: null,
      semanticDistance: 0.2,
      viewerCoords: viewer
    });
    expect(near).toBeGreaterThan(far);
    // Distant result is still scored (> 0), i.e. not filtered out.
    expect(far).toBeGreaterThan(0);
  });
});
