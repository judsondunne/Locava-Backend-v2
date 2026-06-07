import { describe, expect, it } from "vitest";
import { enrichPlaceImageCitation } from "./placeImageCitation.js";
import type { PlaceImageResult } from "../../types/places.js";

describe("placeImageCitation", () => {
  it("adds legal metadata without changing image URLs", () => {
    const base: PlaceImageResult = {
      id: "test-1",
      imageUrl: "https://cdn.example.com/photo.jpg",
      caption: "Quechee Gorge",
      sourceName: "Vermont Tourism",
      sourceUrl: "https://www.vermontvacation.com/quechee",
    };

    const enriched = enrichPlaceImageCitation(base, "serper");
    expect(enriched.imageUrl).toBe(base.imageUrl);
    expect(enriched.sourceDomain).toBe("vermontvacation.com");
    expect(enriched.provider).toBe("serper");
    expect(enriched.backlinkUrl).toBe(base.sourceUrl);
    expect(enriched.licenseNote).toContain("Serper");
    expect(enriched.copyrightDisclaimer).toContain("Image rights");
  });
});
