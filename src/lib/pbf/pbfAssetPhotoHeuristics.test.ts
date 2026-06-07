import { describe, expect, it } from "vitest";
import { classifyPbfAssetPhotoHeuristic } from "./pbfAssetPhotoHeuristics.js";

describe("pbfAssetPhotoHeuristics", () => {
  it("rejects event page URLs", () => {
    const result = classifyPbfAssetPhotoHeuristic({
      id: "x",
      imageUrl: "https://marthacanfieldlibrary.org/wp-content/uploads/2024/event.png",
      caption: "Martha Canfield Library",
      sourceName: "marthacanfieldlibrary.org",
      sourceUrl: "https://marthacanfieldlibrary.org/events/summer",
    });
    expect(result.acceptable).toBe(false);
  });

  it("rejects promo flyer metadata", () => {
    const result = classifyPbfAssetPhotoHeuristic({
      id: "x",
      imageUrl: "https://example.com/flyer.jpg",
      caption: "Deadlines & Decaf — Martha Canfield Library summer program",
      sourceName: "marthacanfieldlibrary.org",
      sourceUrl: "https://marthacanfieldlibrary.org/events",
    });
    expect(result.acceptable).toBe(false);
    expect(result.reason).toBe("promo_graphic_metadata");
  });

  it("accepts building photo metadata", () => {
    const result = classifyPbfAssetPhotoHeuristic({
      id: "x",
      imageUrl: "https://example.com/building.jpg",
      caption: "Martha Canfield Library exterior Arlington Vermont",
      sourceName: "benningtonbanner.com",
      sourceUrl: "https://benningtonbanner.com/article",
    });
    expect(result.acceptable).toBe(true);
  });
});
