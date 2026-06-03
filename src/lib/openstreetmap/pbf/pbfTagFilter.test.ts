import { describe, expect, it } from "vitest";
import { createPbfTagFilter, DEFAULT_PBF_TAG_FILTER_POLICY, BBOX_EXHAUSTIVE_PBF_TAG_FILTER_POLICY } from "./pbfTagFilter.js";

describe("pbfTagFilter", () => {
  const filter = createPbfTagFilter();

  it("accepts amenity-tagged objects", () => {
    expect(filter.isCandidate({ amenity: "cafe", name: "Cafe X" })).toBe(true);
  });

  it("accepts tourism viewpoints", () => {
    expect(filter.isCandidate({ tourism: "viewpoint" })).toBe(true);
  });

  it("accepts trails (highway=path)", () => {
    expect(filter.isCandidate({ highway: "path", name: "Trail" })).toBe(true);
  });

  it("accepts atv=yes truthy keys", () => {
    expect(filter.isCandidate({ atv: "yes" })).toBe(true);
  });

  it("keeps objects tagged with offroad keys (atv=no still indicates offroad-relevant metadata)", () => {
    // atv is a Locava-relevant key by default — even a "no" value tells us
    // the way is offroad-aware. The candidate filter only decides whether
    // the classifier should see the object; the classifier itself decides
    // whether it's actually worth surfacing.
    expect(filter.isCandidate({ atv: "no" })).toBe(true);
  });

  it("rejects highway=motorway (not in candidate values)", () => {
    expect(filter.isCandidate({ highway: "motorway" })).toBe(false);
  });

  it("rejects empty / undefined tags", () => {
    expect(filter.isCandidate(undefined)).toBe(false);
    expect(filter.isCandidate(null)).toBe(false);
    expect(filter.isCandidate({})).toBe(false);
  });

  it("default policy exposes core Locava keys", () => {
    const keys = new Set(DEFAULT_PBF_TAG_FILTER_POLICY.keys);
    expect(keys.has("amenity")).toBe(true);
    expect(keys.has("natural")).toBe(true);
    expect(keys.has("leisure")).toBe(true);
    expect(keys.has("route")).toBe(true);
    expect(keys.has("sac_scale")).toBe(true);
    expect(keys.has("trail_visibility")).toBe(true);
    expect(keys.has("wikidata")).toBe(true);
    expect(keys.has("mapillary")).toBe(true);
  });

  it("bbox exhaustive policy accepts highway=tertiary and bridge=yes (road bridges)", () => {
    const filter = createPbfTagFilter(BBOX_EXHAUSTIVE_PBF_TAG_FILTER_POLICY);
    expect(filter.isCandidate({ highway: "tertiary", bridge: "yes", name: "Quechee Bridge" })).toBe(true);
    expect(filter.isCandidate({ highway: "secondary", bridge: "yes" })).toBe(true);
  });

  it("default policy rejects highway=tertiary without other Locava keys", () => {
    expect(filter.isCandidate({ highway: "tertiary", bridge: "yes" })).toBe(false);
  });

  it("bbox exhaustive policy accepts any highway tag", () => {
    const exhaustive = createPbfTagFilter(BBOX_EXHAUSTIVE_PBF_TAG_FILTER_POLICY);
    expect(exhaustive.isCandidate({ highway: "steps" })).toBe(true);
    expect(exhaustive.isCandidate({ highway: "pedestrian", foot: "designated" })).toBe(true);
  });
});
