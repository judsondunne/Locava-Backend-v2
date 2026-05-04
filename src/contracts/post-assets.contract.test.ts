import { describe, expect, it } from "vitest";
import {
  normalizePostAssets,
  resolveImageDisplayUri,
  type NormalizedPostAsset,
} from "./post-assets.contract.js";

function displayUris(assets: NormalizedPostAsset[]): string[] {
  return assets.map((a) => a.displayUri);
}

describe("normalizePostAssets", () => {
  it("modern multi-image keeps order and three unique URIs", () => {
    const raw = {
      postId: "p1",
      mediaType: "image",
      assets: [
        {
          id: "a0",
          type: "image",
          original: "https://cdn.example/img0-full.jpg",
          variants: {
            lg: { webp: "https://cdn.example/img0-lg.webp" },
            md: { webp: "https://cdn.example/img0-md.webp" },
          },
        },
        {
          id: "a1",
          type: "image",
          variants: {
            lg: { webp: "https://cdn.example/img1-lg.webp" },
          },
        },
        {
          id: "a2",
          type: "image",
          variants: {
            fallbackJpg: { jpg: "https://cdn.example/img2-fallback.jpg" },
          },
        },
      ],
    };
    const r = normalizePostAssets(raw, { postId: "p1" });
    expect(r.assets).toHaveLength(3);
    expect(r.assetCount).toBe(3);
    expect(r.hasMultipleAssets).toBe(true);
    expect(displayUris(r.assets)).toEqual([
      "https://cdn.example/img0-lg.webp",
      "https://cdn.example/img1-lg.webp",
      "https://cdn.example/img2-fallback.jpg",
    ]);
    expect(r.displayPhotoLink?.length).toBeGreaterThan(0);
    expect(r.photoLink).toContain("webp");
  });

  it("video uses playable URI separate from poster", () => {
    const raw = {
      postId: "v1",
      mediaType: "video",
      displayPhotoLink: "https://cdn.example/poster.jpg",
      assets: [
        {
          id: "v0",
          type: "video",
          poster: "https://cdn.example/poster.jpg",
          variants: {
            hls: "https://cdn.example/video.m3u8",
            main720Avc: "https://cdn.example/720.mp4",
            preview360: "https://cdn.example/360.mp4",
            poster: "https://cdn.example/poster.jpg",
          },
        },
      ],
    };
    const r = normalizePostAssets(raw);
    expect(r.assets).toHaveLength(1);
    const asset0 = r.assets[0];
    if (!asset0) throw new Error("expected one asset");
    expect(asset0.type).toBe("video");
    expect(asset0.displayUri).toBe("https://cdn.example/video.m3u8");
    expect(asset0.playback?.hls).toBe("https://cdn.example/video.m3u8");
    expect(asset0.posterUri ?? asset0.playback?.poster).toContain("poster");
    expect(asset0.displayUri).not.toBe(asset0.posterUri);
  });

  it("legacy photoLinks2/photoLinks3 comma lists merge and dedupe", () => {
    const raw = {
      postId: "leg1",
      mediaType: "image",
      photoLinks2: "https://a.jpg,https://b.jpg",
      photoLinks3: "https://a.jpg,,https://c.jpg",
    };
    const r = normalizePostAssets(raw);
    expect(r.assets.map((x) => x.displayUri)).toEqual([
      "https://a.jpg",
      "https://b.jpg",
      "https://c.jpg",
    ]);
    expect(r.assetCount).toBe(3);
  });

  it("legacy single photoLink with empty photoLinks2/3 yields one asset", () => {
    const r = normalizePostAssets({
      postId: "l2",
      photoLink: "https://one.jpg",
      photoLinks2: "",
      photoLinks3: "",
      legacy: { photoLinks2: "", photoLinks3: "" },
    });
    expect(r.assets).toHaveLength(1);
    expect(r.hasMultipleAssets).toBe(false);
  });

  it("duplicate modern asset ids are deduped", () => {
    const raw = {
      postId: "d1",
      mediaType: "image",
      assets: [
        { id: "same", type: "image", original: "https://x/a.jpg", variants: { md: { webp: "https://x/a.webp" } } },
        { id: "same", type: "image", original: "https://x/b.jpg", variants: { md: { webp: "https://x/b.webp" } } },
      ],
    };
    const r = normalizePostAssets(raw);
    expect(r.assets).toHaveLength(1);
  });

  it("empty assets with metadata falls back gracefully", () => {
    const r = normalizePostAssets({
      postId: "e1",
      assets: [],
      displayPhotoLink: "https://cover.jpg",
    });
    expect(r.assets.length >= 1).toBe(true);
  });
});

describe("resolveImageDisplayUri", () => {
  it("respects lg/md/sm/fallbackJpg/original/url order", () => {
    const uri = resolveImageDisplayUri(
      {
        lg: { webp: "https://lg.webp" },
        md: { webp: "https://md.webp" },
      },
      { url: "https://url/" },
      null,
    );
    expect(uri).toBe("https://lg.webp");
  });
});
