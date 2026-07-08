import { describe, it, expect } from "vitest";
import { assessPhotoVisualQualityFromMetadata } from "./scorePhotoResultMetadata.js";
import type { PlaceImageResult } from "../../types/places.js";

function result(overrides: Partial<PlaceImageResult> = {}): PlaceImageResult {
  return {
    id: "r1",
    imageUrl: "https://cdn.example.com/photo.jpg",
    caption: "Warren Falls swimming hole in Vermont",
    sourceName: "New England Waterfalls",
    sourceUrl: "https://newenglandwaterfalls.com/warren-falls",
    ...overrides,
  } as PlaceImageResult;
}

describe("assessPhotoVisualQualityFromMetadata", () => {
  it("rates higher-resolution photos higher", () => {
    const hi = assessPhotoVisualQualityFromMetadata(result({ imageWidth: 2400, imageHeight: 1600 }));
    const mid = assessPhotoVisualQualityFromMetadata(result({ imageWidth: 1200, imageHeight: 900 }));
    const low = assessPhotoVisualQualityFromMetadata(result({ imageWidth: 800, imageHeight: 600 }));
    expect(hi.bonus).toBeGreaterThan(mid.bonus);
    expect(mid.bonus).toBeGreaterThan(low.bonus);
    expect(hi.positiveReasons).toContain("high_resolution");
    expect(hi.rejectReasons).toEqual([]);
  });

  it("rejects tiny thumbnails as low_resolution", () => {
    const tiny = assessPhotoVisualQualityFromMetadata(result({ imageWidth: 240, imageHeight: 180 }));
    expect(tiny.rejectReasons).toContain("low_resolution");
  });

  it("rejects banner-shaped extreme aspect ratios", () => {
    const banner = assessPhotoVisualQualityFromMetadata(result({ imageWidth: 2000, imageHeight: 400 }));
    expect(banner.rejectReasons).toContain("extreme_aspect_ratio");
  });

  it("tolerates missing dimensions (no bonus, no reject)", () => {
    const none = assessPhotoVisualQualityFromMetadata(result());
    expect(none.bonus).toBe(0);
    expect(none.rejectReasons).toEqual([]);
  });

  it("rejects black-and-white / vintage photos from metadata wording", () => {
    for (const caption of [
      "Warren Falls in black and white",
      "B&W study of the gorge",
      "Sepia postcard of the falls, vintage postcard collection",
      "Monochrome fine art print of the river",
    ]) {
      const r = assessPhotoVisualQualityFromMetadata(result({ caption }));
      expect(r.rejectReasons).toContain("monochrome_or_vintage");
    }
  });

  it("rejects images likely to carry text (memes, printables, print shops)", () => {
    const meme = assessPhotoVisualQualityFromMetadata(result({ caption: "Funny hiking meme about Vermont falls" }));
    expect(meme.rejectReasons).toContain("likely_text_overlay");

    const printable = assessPhotoVisualQualityFromMetadata(result({ caption: "Printable wall art of Warren Falls" }));
    expect(printable.rejectReasons).toContain("likely_text_overlay");

    const shop = assessPhotoVisualQualityFromMetadata(
      result({ sourceUrl: "https://www.redbubble.com/i/poster/warren-falls" }),
    );
    expect(shop.rejectReasons).toContain("likely_text_overlay");
  });

  it("accepts a normal color landscape photo untouched", () => {
    const ok = assessPhotoVisualQualityFromMetadata(
      result({ imageWidth: 1600, imageHeight: 1200, caption: "Autumn view of Warren Falls, Vermont" }),
    );
    expect(ok.rejectReasons).toEqual([]);
    expect(ok.bonus).toBeGreaterThan(0);
  });
});
