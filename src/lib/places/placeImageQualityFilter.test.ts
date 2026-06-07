import { describe, expect, it } from "vitest";
import {
  classifyPlaceImageQuality,
  filterAcceptablePlaceImages,
} from "./placeImageQualityFilter.js";
import type { PlaceImageResult } from "../../types/places.js";

function mkResult(partial: Partial<PlaceImageResult>): PlaceImageResult {
  return {
    id: "test-1",
    imageUrl: "https://example.com/photo.jpg",
    caption: "Sample",
    sourceName: "Example",
    sourceUrl: "https://example.com/page",
    ...partial,
  };
}

describe("placeImageQualityFilter", () => {
  it("rejects overview / trail maps", () => {
    const map = classifyPlaceImageQuality(
      mkResult({ caption: "Ascutney Outdoors Overview Map" }),
    );
    expect(map.acceptable).toBe(false);
    expect(map.reason).toBe("map_like");
  });

  it("keeps real hang glider photos", () => {
    const photo = classifyPlaceImageQuality(
      mkResult({
        caption: "Launching and landing a hang glider at Mt. Ascutney, Vermont.",
        sourceName: "YouTube",
      }),
    );
    expect(photo.acceptable).toBe(true);
  });

  it("rejects svg and logo url patterns", () => {
    expect(
      classifyPlaceImageQuality(
        mkResult({ imageUrl: "https://example.com/assets/logo.svg" }),
      ).acceptable,
    ).toBe(false);
    expect(
      classifyPlaceImageQuality(
        mkResult({ caption: "Mount Ascutney park logo" }),
      ).acceptable,
    ).toBe(false);
  });

  it("filters mixed result lists while preserving order", () => {
    const results = filterAcceptablePlaceImages([
      mkResult({ id: "1", caption: "Hang glider launch at Mt Ascutney" }),
      mkResult({ id: "2", caption: "Ascutney Outdoors Overview Map" }),
      mkResult({ id: "3", caption: "Mount Ascutney summit view" }),
    ]);
    expect(results.map((r) => r.id)).toEqual(["1", "3"]);
  });
});
