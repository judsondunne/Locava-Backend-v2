import { describe, it, expect, vi } from "vitest";
import { ingestReelMedia, type ReelMediaDeps } from "./ingestReelMedia.js";

function deps(over: Partial<ReelMediaDeps> = {}): ReelMediaDeps {
  return {
    resolveMedia: async () => ({ videoUrl: "https://cdn.ig/vid.mp4", thumbnailUrl: "https://cdn.ig/thumb.jpg" }),
    downloadToTmp: async (_url, ext) => `/tmp/x.${ext}`,
    uploadFile: async (_p, key) => ({ publicUrl: `https://wasabi/${key}` }),
    cleanup: async () => undefined,
    ...over,
  };
}

describe("ingestReelMedia", () => {
  it("resolves, uploads video + poster, returns hosted URLs", async () => {
    const result = await ingestReelMedia("Cx1", deps());
    expect(result).toEqual({
      videoUrl: "https://wasabi/undiscovered-reels/Cx1/video.mp4",
      thumbnailUrl: "https://wasabi/undiscovered-reels/Cx1/poster.jpg",
    });
  });

  it("returns null when no video resolves", async () => {
    expect(await ingestReelMedia("Cx1", deps({ resolveMedia: async () => null }))).toBeNull();
    expect(await ingestReelMedia("Cx1", deps({ resolveMedia: async () => ({ videoUrl: null }) }))).toBeNull();
  });

  it("still returns the video when the poster fails (best-effort)", async () => {
    const downloadToTmp = vi.fn(async (url: string, ext: string) => {
      if (ext === "jpg") throw new Error("poster 404");
      return `/tmp/x.${ext}`;
    });
    const result = await ingestReelMedia("Cx1", deps({ downloadToTmp }));
    expect(result?.videoUrl).toBe("https://wasabi/undiscovered-reels/Cx1/video.mp4");
    expect(result?.thumbnailUrl).toBeNull();
  });

  it("cleans up temp files even on the happy path", async () => {
    const cleanup = vi.fn(async (_paths: string[]) => undefined);
    await ingestReelMedia("Cx1", deps({ cleanup }));
    expect(cleanup).toHaveBeenCalled();
    const firstCallPaths = cleanup.mock.calls[0]?.[0] ?? [];
    expect(firstCallPaths.length).toBeGreaterThan(0);
  });

  it("honors a custom key prefix", async () => {
    const result = await ingestReelMedia("Cx1", deps({ keyPrefix: "reels/vt" }));
    expect(result?.videoUrl).toBe("https://wasabi/reels/vt/Cx1/video.mp4");
  });
});
