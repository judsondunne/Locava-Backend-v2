import { describe, expect, it } from "vitest";
import {
  attachExistingMediaFields,
  extractExistingMediaRefsFromInventoryItem,
  extractExistingMediaRefsFromTags,
  type ExistingMediaRef,
} from "./inventoryExistingMediaRefs.js";

function ref0(refs: ExistingMediaRef[]): ExistingMediaRef {
  expect(refs.length).toBeGreaterThan(0);
  return refs[0]!;
}

describe("inventoryExistingMediaRefs", () => {
  it("image=https://example.com/photo.jpg becomes direct_image canPreview true", () => {
    const refs = extractExistingMediaRefsFromTags({ image: "https://example.com/photo.jpg" }, { sourceKey: "n/1" });
    expect(refs).toHaveLength(1);
    const r = ref0(refs);
    expect(r.mediaKind).toBe("direct_image");
    expect(r.canPreview).toBe(true);
    expect(r.previewUrl).toBe("https://example.com/photo.jpg");
  });

  it("image=https://example.com/page.html becomes generic_media_url canPreview false", () => {
    const refs = extractExistingMediaRefsFromTags({ image: "https://example.com/page.html" }, { sourceKey: "n/1" });
    expect(refs).toHaveLength(1);
    const r = ref0(refs);
    expect(r.mediaKind).toBe("generic_media_url");
    expect(r.canPreview).toBe(false);
  });

  it("wikimedia_commons=File:Example.jpg becomes commons_file with Special:FilePath preview", () => {
    const refs = extractExistingMediaRefsFromTags({ wikimedia_commons: "File:Example.jpg" }, { sourceKey: "n/1" });
    expect(refs).toHaveLength(1);
    const r = ref0(refs);
    expect(r.mediaKind).toBe("commons_file");
    expect(r.canPreview).toBe(true);
    expect(r.previewUrl).toContain("Special:FilePath");
    expect(r.previewUrl).toContain("Example.jpg");
  });

  it("wikimedia_commons=Category:Example becomes commons_category canPreview false", () => {
    const refs = extractExistingMediaRefsFromTags({ wikimedia_commons: "Category:Example" }, { sourceKey: "n/1" });
    expect(refs).toHaveLength(1);
    const r = ref0(refs);
    expect(r.mediaKind).toBe("commons_category");
    expect(r.canPreview).toBe(false);
    expect(r.requiresLaterResolution).toBe(true);
  });

  it("wikimedia_commons URL normalizes correctly", () => {
    const refs = extractExistingMediaRefsFromTags(
      { wikimedia_commons: "https://commons.wikimedia.org/wiki/File:Example.jpg" },
      { sourceKey: "n/1" }
    );
    const r = ref0(refs);
    expect(r.mediaKind).toBe("commons_file");
    expect(r.sourceUrl).toContain("/wiki/File:Example.jpg");
  });

  it("wikidata=Q123 becomes wikidata source URL", () => {
    const refs = extractExistingMediaRefsFromTags({ wikidata: "Q123" }, { sourceKey: "n/1" });
    const r = ref0(refs);
    expect(r.mediaKind).toBe("wikidata");
    expect(r.sourceUrl).toBe("https://www.wikidata.org/wiki/Q123");
  });

  it("wikipedia=en:French's Ledges becomes wikipedia source URL", () => {
    const refs = extractExistingMediaRefsFromTags({ wikipedia: "en:French's Ledges" }, { sourceKey: "n/1" });
    const r = ref0(refs);
    expect(r.mediaKind).toBe("wikipedia");
    expect(r.sourceUrl).toBe("https://en.wikipedia.org/wiki/French's_Ledges");
  });

  it("mapillary key becomes mapillary media ref", () => {
    const refs = extractExistingMediaRefsFromTags({ mapillary: "abc123" }, { sourceKey: "n/1" });
    const r = ref0(refs);
    expect(r.mediaKind).toBe("mapillary");
    expect(r.sourceUrl).toContain("mapillary.com");
  });

  it("website is website clue but not previewable unless direct image", () => {
    const site = extractExistingMediaRefsFromTags({ website: "https://example.org" }, { sourceKey: "n/1" });
    const siteRef = ref0(site);
    expect(siteRef.mediaKind).toBe("website");
    expect(siteRef.canPreview).toBe(false);

    const img = extractExistingMediaRefsFromTags(
      { website: "https://example.org/logo.png" },
      { sourceKey: "n/1" }
    );
    const imgRef = ref0(img);
    expect(imgRef.mediaKind).toBe("direct_image");
    expect(imgRef.canPreview).toBe(true);
  });

  it("unknown image-ish tag is captured", () => {
    const refs = extractExistingMediaRefsFromTags({ "image:custom": "some-local-ref" }, { sourceKey: "n/1" });
    expect(refs.length).toBeGreaterThan(0);
    expect(ref0(refs).tagKey).toBe("image:custom");
  });

  it("extractor scans all tags not just exact keys", () => {
    const refs = extractExistingMediaRefsFromTags(
      { "custom:photo_url": "https://cdn.example.com/a.webp" },
      { sourceKey: "n/1" }
    );
    expect(refs.some((r) => r.mediaKind === "direct_image")).toBe(true);
  });

  it("item with no media tags returns empty array", () => {
    const refs = extractExistingMediaRefsFromInventoryItem({
      sourceKey: "n/1",
      name: "Plain Spot",
      tags: { name: "Plain Spot", amenity: "cafe" },
    });
    expect(refs).toEqual([]);
  });

  it("attachExistingMediaFields adds summary counts", () => {
    const item = attachExistingMediaFields({
      id: "spot/1",
      sourceKey: "n/1",
      name: "Test",
      tags: {
        image: "https://example.com/a.jpg",
        wikimedia_commons: "Category:Waterfalls",
      },
    });
    expect(item.existingMediaRefCount).toBe(2);
    expect(item.previewableMediaCount).toBe(1);
    expect(item.commonsCategoryCount).toBe(1);
  });
});
