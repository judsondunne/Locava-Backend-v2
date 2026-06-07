import { describe, expect, it } from "vitest";
import {
  VERMONT_EVAL_REGIONS,
  VERMONT_EVAL_RADIUS_KM,
  VERMONT_EVAL_RADIUS_MILES,
  bboxForVermontEvalRegion,
  viewportBboxFromCenterRadius,
} from "./pbfVermontEvalRegions.js";

describe("pbfVermontEvalRegions", () => {
  it("defines 10 Vermont evaluation regions", () => {
    expect(VERMONT_EVAL_REGIONS).toHaveLength(10);
    const slugs = new Set(VERMONT_EVAL_REGIONS.map((r) => r.slug));
    expect(slugs.size).toBe(10);
  });

  it("computes eval radius bboxes with valid west/east/south/north", () => {
    expect(VERMONT_EVAL_RADIUS_MILES).toBeGreaterThanOrEqual(5);
    expect(VERMONT_EVAL_RADIUS_KM).toBeGreaterThanOrEqual(8);

    const region = VERMONT_EVAL_REGIONS[0]!;
    const bbox = bboxForVermontEvalRegion(region);
    expect(bbox.westLng).toBeLessThan(bbox.eastLng);
    expect(bbox.southLat).toBeLessThan(bbox.northLat);
    expect(bbox.westLng).toBeLessThan(region.center.lng);
    expect(bbox.eastLng).toBeGreaterThan(region.center.lng);
    expect(bbox.southLat).toBeLessThan(region.center.lat);
    expect(bbox.northLat).toBeGreaterThan(region.center.lat);

    const approxLatSpan = bbox.northLat - bbox.southLat;
    expect(approxLatSpan).toBeGreaterThan(0.12);
    expect(approxLatSpan).toBeLessThan(1.2);
  });

  it("viewportBboxFromCenterRadius is symmetric around center", () => {
    const center = { lat: 44.0, lng: -72.5 };
    const bbox = viewportBboxFromCenterRadius(center, 10);
    const latMid = (bbox.northLat + bbox.southLat) / 2;
    const lngMid = (bbox.eastLng + bbox.westLng) / 2;
    expect(latMid).toBeCloseTo(center.lat, 2);
    expect(lngMid).toBeCloseTo(center.lng, 2);
  });
});
