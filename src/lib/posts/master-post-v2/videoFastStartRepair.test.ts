import { describe, expect, it, vi } from "vitest";
import {
  analyzeVideoFastStartNeeds,
  generateMissingFastStartVariantsForPost,
  mergePlaybackLabResultsIntoRawPost,
  rebuildPostAfterFastStartRepair,
  type VerifyOutput
} from "./videoFastStartRepair.js";

function okVerify(label: string, url: string): VerifyOutput {
  return {
    label,
    url,
    ok: true,
    probe: {
      head: { ok: true, status: 200, contentType: "video/mp4", acceptRanges: "bytes" },
      moovHint: "moov_before_mdat_in_prefix"
    }
  };
}

describe("videoFastStartRepair", () => {
  it("image-only post returns no_video_assets and skips generation", async () => {
    const raw = { id: "p-image", assets: [{ id: "i1", type: "image", original: "https://img/1.jpg" }] };
    const analyze = analyzeVideoFastStartNeeds(raw, { postId: "p-image" });
    expect(analyze.videoAssetCount).toBe(0);
    expect(analyze.skipReasons).toContain("no_video_assets");
    const generated = await generateMissingFastStartVariantsForPost("p-image", raw, {});
    expect(generated.generationResults.length).toBe(0);
    const rebuilt = rebuildPostAfterFastStartRepair(raw, { postId: "p-image" });
    expect(rebuilt.canonical.classification.mediaKind).toBe("image");
  });

  it("single video already optimized skips generation and keeps startup selection", async () => {
    const raw = {
      id: "p-ready",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [
        {
          id: "v1",
          type: "video",
          original: "https://cdn/original.mp4",
          startup720FaststartAvc: "https://cdn/startup720.mp4",
          startup540FaststartAvc: "https://cdn/startup540.mp4",
          preview360Avc: "https://cdn/preview360.mp4",
          main720Avc: "https://cdn/main720.mp4",
          width: 1280,
          height: 720
        }
      ],
      playbackLab: {
        lastVerifyResults: [
          okVerify("startup720FaststartAvc", "https://cdn/startup720.mp4"),
          okVerify("startup540FaststartAvc", "https://cdn/startup540.mp4"),
          okVerify("preview360Avc", "https://cdn/preview360.mp4"),
          okVerify("main720Avc", "https://cdn/main720.mp4")
        ]
      }
    };
    const generate = vi.fn();
    const result = await generateMissingFastStartVariantsForPost("p-ready", raw, { generateMissingForAsset: generate });
    expect(result.analyze.alreadyOptimizedCount).toBe(1);
    expect(generate).not.toHaveBeenCalled();
    const rebuilt = rebuildPostAfterFastStartRepair(raw, { postId: "p-ready" });
    expect(rebuilt.canonical.media.assets[0]?.video?.playback.startupUrl).toBe("https://cdn/startup720.mp4");
  });

  it("merge preserves existing verify rows when generation is skipped", async () => {
    const raw = {
      id: "p-skip-preserve",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [
        {
          id: "v1",
          type: "video",
          original: "https://cdn/original.mp4",
          startup720FaststartAvc: "https://cdn/startup720.mp4",
          startup540FaststartAvc: "https://cdn/startup540.mp4",
          preview360Avc: "https://cdn/preview360.mp4",
          main720Avc: "https://cdn/main720.mp4",
          width: 1280,
          height: 720
        }
      ],
      playbackLab: {
        lastVerifyResults: [
          okVerify("startup720FaststartAvc", "https://cdn/startup720.mp4"),
          okVerify("startup540FaststartAvc", "https://cdn/startup540.mp4"),
          okVerify("preview360Avc", "https://cdn/preview360.mp4"),
          okVerify("main720Avc", "https://cdn/main720.mp4")
        ],
        assets: {
          v1: {
            lastVerifyResults: [
              okVerify("startup720FaststartAvc", "https://cdn/startup720.mp4"),
              okVerify("startup540FaststartAvc", "https://cdn/startup540.mp4"),
              okVerify("preview360Avc", "https://cdn/preview360.mp4"),
              okVerify("main720Avc", "https://cdn/main720.mp4")
            ]
          }
        }
      }
    };

    const merged = mergePlaybackLabResultsIntoRawPost(raw, [
      { assetId: "v1", generated: {}, verifyResults: [], errors: [], skipped: true }
    ]);
    const rebuilt = rebuildPostAfterFastStartRepair(merged, { postId: "p-skip-preserve" });

    expect(rebuilt.canonical.media.assets[0]?.video?.playback.startupUrl).toBe("https://cdn/startup720.mp4");
    expect(rebuilt.canonical.media.assets[0]?.video?.readiness.faststartVerified).toBe(true);
    expect(analyzeVideoFastStartNeeds(merged, { postId: "p-skip-preserve" }).needsGenerationCount).toBe(0);
  });

  it("old main720+preview no startup generates startup variants and selects startup", async () => {
    const raw = {
      id: "p-old-720",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [{ id: "v1", type: "video", original: "https://cdn/original.mp4", main720Avc: "https://cdn/main720.mp4", preview360Avc: "https://cdn/preview360.mp4", width: 1280, height: 720 }],
      playbackLab: {
        lastVerifyResults: [okVerify("main720Avc", "https://cdn/main720.mp4"), okVerify("preview360Avc", "https://cdn/preview360.mp4")]
      }
    };
    const generated = await generateMissingFastStartVariantsForPost("p-old-720", raw, {
      generateMissingForAsset: async () => ({
        generated: {
          startup540FaststartAvc: "https://cdn/startup540.mp4",
          startup720FaststartAvc: "https://cdn/startup720.mp4"
        }
      }),
      verifyGeneratedUrl: async ({ label, url }) => okVerify(label, url)
    });
    const merged = mergePlaybackLabResultsIntoRawPost(raw, generated.generationResults);
    const rebuilt = rebuildPostAfterFastStartRepair(merged, { postId: "p-old-720" });
    expect(rebuilt.canonical.media.assets[0]?.video?.playback.startupUrl).toBe("https://cdn/startup720.mp4");
    expect(rebuilt.canonical.media.assets[0]?.video?.playback.fallbackUrl).toBe("https://cdn/original.mp4");
  });

  it("old original-only video can generate full set and become instant playback ready", async () => {
    const raw = {
      id: "p-original-only",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [{ id: "v1", type: "video", original: "https://cdn/original.mp4", width: 1280, height: 720 }]
    };
    const generated = await generateMissingFastStartVariantsForPost("p-original-only", raw, {
      generateMissingForAsset: async () => ({
        generated: {
          preview360Avc: "https://cdn/preview360.mp4",
          main720Avc: "https://cdn/main720.mp4",
          startup540FaststartAvc: "https://cdn/startup540.mp4",
          startup720FaststartAvc: "https://cdn/startup720.mp4"
        }
      }),
      verifyGeneratedUrl: async ({ label, url }) => okVerify(label, url)
    });
    const merged = mergePlaybackLabResultsIntoRawPost(raw, generated.generationResults);
    const rebuilt = rebuildPostAfterFastStartRepair(merged, { postId: "p-original-only" });
    expect(rebuilt.canonical.media.instantPlaybackReady).toBe(true);
    expect(rebuilt.canonical.media.assets[0]?.video?.playback.defaultUrl).toBe("https://cdn/startup720.mp4");
  });

  it("multi-video only generates missing asset", async () => {
    const raw = {
      id: "p-multi-video",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [
        { id: "a", type: "video", original: "https://cdn/a-original.mp4", startup720FaststartAvc: "https://cdn/a-startup720.mp4", startup540FaststartAvc: "https://cdn/a-startup540.mp4", preview360Avc: "https://cdn/a-preview360.mp4", main720Avc: "https://cdn/a-main720.mp4", width: 1280, height: 720 },
        { id: "b", type: "video", original: "https://cdn/b-original.mp4", preview360Avc: "https://cdn/b-preview360.mp4", main720Avc: "https://cdn/b-main720.mp4", width: 1280, height: 720 }
      ],
      playbackLab: {
        lastVerifyResults: [
          okVerify("startup720FaststartAvc", "https://cdn/a-startup720.mp4"),
          okVerify("startup540FaststartAvc", "https://cdn/a-startup540.mp4"),
          okVerify("preview360Avc", "https://cdn/a-preview360.mp4"),
          okVerify("main720Avc", "https://cdn/a-main720.mp4"),
          okVerify("preview360Avc", "https://cdn/b-preview360.mp4"),
          okVerify("main720Avc", "https://cdn/b-main720.mp4")
        ]
      }
    };
    const generate = vi.fn(async ({ asset }: any) => ({
      generated:
        asset.id === "b"
          ? { startup540FaststartAvc: "https://cdn/b-startup540.mp4", startup720FaststartAvc: "https://cdn/b-startup720.mp4" }
          : ({} as Record<string, string>)
    }));
    const result = await generateMissingFastStartVariantsForPost("p-multi-video", raw, {
      generateMissingForAsset: generate,
      verifyGeneratedUrl: async ({ label, url }) => okVerify(label, url)
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.generationResults.find((row) => row.assetId === "a")?.skipped).toBe(true);
    const merged = mergePlaybackLabResultsIntoRawPost(raw, result.generationResults);
    const rebuilt = rebuildPostAfterFastStartRepair(merged, { postId: "p-multi-video" });
    expect(rebuilt.canonical.media.assets.filter((asset) => asset.type === "video").length).toBe(2);
    expect(rebuilt.canonical.media.assets[1]?.video?.playback.startupUrl).toBe("https://cdn/b-startup720.mp4");
  });

  it("mixed carousel skips images and preserves indexes", async () => {
    const raw = {
      id: "p-mixed",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [
        { id: "img-1", type: "image", original: "https://img/1.jpg" },
        { id: "vid-1", type: "video", original: "https://cdn/original.mp4", width: 1280, height: 720 }
      ]
    };
    const generated = await generateMissingFastStartVariantsForPost("p-mixed", raw, {
      generateMissingForAsset: async () => ({ generated: { preview360Avc: "https://cdn/preview360.mp4", main720Avc: "https://cdn/main720.mp4", startup540FaststartAvc: "https://cdn/startup540.mp4", startup720FaststartAvc: "https://cdn/startup720.mp4" } }),
      verifyGeneratedUrl: async ({ label, url }) => okVerify(label, url)
    });
    const merged = mergePlaybackLabResultsIntoRawPost(raw, generated.generationResults);
    const rebuilt = rebuildPostAfterFastStartRepair(merged, { postId: "p-mixed" });
    expect(rebuilt.canonical.media.assets[0]?.id).toBe("img-1");
    expect(rebuilt.canonical.media.assets[1]?.id).toBe("vid-1");
  });

  it("generation failure keeps post previewable with fallback", async () => {
    const raw = {
      id: "p-gen-fail",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [{ id: "v1", type: "video", original: "https://cdn/original.mp4", main720Avc: "https://cdn/main720.mp4", preview360Avc: "https://cdn/preview360.mp4" }],
      playbackLab: { lastVerifyResults: [okVerify("main720Avc", "https://cdn/main720.mp4"), okVerify("preview360Avc", "https://cdn/preview360.mp4")] }
    };
    const result = await generateMissingFastStartVariantsForPost("p-gen-fail", raw, {
      generateMissingForAsset: async () => {
        throw new Error("ffmpeg_failed");
      },
      verifyGeneratedUrl: async ({ label, url }) => okVerify(label, url)
    });
    const merged = mergePlaybackLabResultsIntoRawPost(raw, result.generationResults);
    const rebuilt = rebuildPostAfterFastStartRepair(merged, { postId: "p-gen-fail" });
    expect(rebuilt.canonical.media.assets[0]?.video?.playback.defaultUrl).toBe("https://cdn/main720.mp4");
  });

  it("verification failure does not promote generated startup url", async () => {
    const raw = {
      id: "p-verify-fail",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [{ id: "v1", type: "video", original: "https://cdn/original.mp4", main720Avc: "https://cdn/main720.mp4", preview360Avc: "https://cdn/preview360.mp4", width: 1280, height: 720 }],
      playbackLab: { lastVerifyResults: [okVerify("main720Avc", "https://cdn/main720.mp4"), okVerify("preview360Avc", "https://cdn/preview360.mp4")] }
    };
    const result = await generateMissingFastStartVariantsForPost("p-verify-fail", raw, {
      generateMissingForAsset: async () => ({ generated: { startup720FaststartAvc: "https://cdn/startup720.mp4", startup540FaststartAvc: "https://cdn/startup540.mp4" } }),
      verifyGeneratedUrl: async ({ label, url }) => ({ ...okVerify(label, url), ok: false })
    });
    const merged = mergePlaybackLabResultsIntoRawPost(raw, result.generationResults);
    const rebuilt = rebuildPostAfterFastStartRepair(merged, { postId: "p-verify-fail" });
    expect(rebuilt.canonical.media.assets[0]?.video?.playback.defaultUrl).toBe("https://cdn/main720.mp4");
  });
});
