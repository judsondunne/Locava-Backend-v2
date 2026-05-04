import { describe, expect, it } from "vitest";
import { mergeImageAssetPendingVariantPatch } from "./merge-asset-presentation-for-media-patch.js";

describe("mergeImageAssetPendingVariantPatch", () => {
  it("preserves presentation when patch only updates variants and pending flags", () => {
    const existing = {
      id: "a1",
      type: "image",
      presentation: {
        letterboxGradient: { top: "#23569a", bottom: "#5b3320" },
        carouselFitWidth: true,
        resizeMode: "contain"
      },
      variants: { lg: { webp: "https://old/lg.webp", w: 1, h: 2 } },
      imageVariantsPending: true
    };
    const patch = {
      variants: { lg: { webp: "https://new/lg.webp", w: 1080, h: 1920 } },
      imageVariantsPending: false,
      imageProcessingStatus: "completed"
    };
    const merged = mergeImageAssetPendingVariantPatch(existing, patch);
    expect((merged.presentation as { letterboxGradient?: { top: string } }).letterboxGradient?.top).toBe("#23569a");
    expect((merged as { imageVariantsPending?: boolean }).imageVariantsPending).toBe(false);
    expect((merged.variants as { lg?: { webp?: string } }).lg?.webp).toBe("https://new/lg.webp");
  });
});
