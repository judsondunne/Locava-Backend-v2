import { describe, expect, it } from "vitest";
import { buildCommonsTextHaystack, evaluateCommonsPhotoQuality } from "./commonsPhotoQualityGate.js";

describe("evaluateCommonsPhotoQuality", () => {
  it("accepts a strong landscape JPEG", () => {
    const r = evaluateCommonsPhotoQuality({
      title: "File:Summit view Mount Washington.jpg",
      mime: "image/jpeg",
      width: 2400,
      height: 1600,
      byteSize: 1_200_000,
      textHaystack: buildCommonsTextHaystack({
        extCategoriesPipe: "Mount Washington (New Hampshire)|Summits in New Hampshire",
        objectName: "Summit view",
        imageDescriptionHtml: "Afternoon view from the summit.",
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it("rejects black & white signals in metadata", () => {
    const r = evaluateCommonsPhotoQuality({
      title: "File:Old trail photo.jpg",
      mime: "image/jpeg",
      width: 2000,
      height: 1500,
      byteSize: 900_000,
      textHaystack: buildCommonsTextHaystack({
        extCategoriesPipe: "Black and white photographs of Vermont",
        objectName: "Trail",
        imageDescriptionHtml: "",
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("black"))).toBe(true);
  });

  it("rejects poster-like titles", () => {
    const r = evaluateCommonsPhotoQuality({
      title: "File:Mount Washington vintage travel poster 1920.jpg",
      mime: "image/jpeg",
      width: 3000,
      height: 4000,
      byteSize: 2_000_000,
      textHaystack: "mount washington",
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.toLowerCase().includes("poster"))).toBe(true);
  });

  it("rejects tiny files", () => {
    const r = evaluateCommonsPhotoQuality({
      title: "File:Some summit.jpg",
      mime: "image/jpeg",
      width: 4000,
      height: 3000,
      byteSize: 12_000,
      textHaystack: "ok",
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("KB"))).toBe(true);
  });

  it("rejects ultra-wide panorama aspect ratios", () => {
    const r = evaluateCommonsPhotoQuality({
      title: "File:Summit wide.jpg",
      mime: "image/jpeg",
      width: 9000,
      height: 2000,
      byteSize: 4_000_000,
      textHaystack: "",
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.toLowerCase().includes("aspect"))).toBe(true);
  });

  it("rejects generic Lastname house.jpg style filenames", () => {
    const r = evaluateCommonsPhotoQuality({
      title: "File:Lloyd house.jpg",
      mime: "image/jpeg",
      width: 3000,
      height: 2000,
      byteSize: 2_000_000,
      textHaystack: "historic district",
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.toLowerCase().includes("house"))).toBe(true);
  });

  it("allows borderline Commons sizes (680px short edge, ~0.7 MP)", () => {
    const r = evaluateCommonsPhotoQuality({
      title: "File:Forest trail Vermont.jpg",
      mime: "image/jpeg",
      width: 1100,
      height: 680,
      byteSize: 400_000,
      textHaystack: "autumn foliage",
    });
    expect(r.ok).toBe(true);
  });
});
