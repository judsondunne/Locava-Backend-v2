import { afterEach, describe, expect, it } from "vitest";
import { classifyPostRebuildFailure } from "./postRebuildFailureClassification.js";

const activeVideoRaw = {
  id: "p_vid",
  classification: { mediaKind: "video" },
  lifecycle: { status: "active", isDeleted: false },
  media: {
    status: "ready",
    assets: [
      {
        id: "a1",
        type: "video",
        video: {
          originalUrl: "https://s3.wasabisys.com/bucket/orig.mp4",
          playback: {
            defaultUrl: "https://s3.wasabisys.com/bucket/orig.mp4",
            primaryUrl: "https://s3.wasabisys.com/bucket/orig.mp4",
            startupUrl: "https://s3.wasabisys.com/bucket/orig.mp4",
            selectedReason: "fallback_original_or_main"
          },
          variants: {},
          readiness: {
            assetsReady: false,
            instantPlaybackReady: false,
            faststartVerified: false,
            processingStatus: "ready"
          }
        }
      }
    ]
  }
} as Record<string, unknown>;

afterEach(() => {
  delete process.env.POST_REBUILDER_DURABLE_SOURCE_COPY;
  delete process.env.POST_REBUILDER_ALLOW_EXTERNAL_SOURCE_REPAIR;
});

describe("classifyPostRebuildFailure", () => {
  it("B: strict generation with durable source — flags contradiction when precheck missed repair", () => {
    const r = classifyPostRebuildFailure({
      rawPost: activeVideoRaw,
      validation: { blockingErrors: [] },
      compactCheck: {
        compactOk: true,
        mediaNeedsRepair: false,
        videoNeedsFaststart: false,
        canSkipWrite: true
      },
      context: {
        status: "generation_failed",
        lastStep: "strict_unresolved_after_repair",
        generationFailureDetail: {
          reason: "strict_mode_blocked_unresolved_video_variants_after_repair",
          perAsset: [
            {
              assetId: "a1",
              sourceUrl: "https://s3.wasabisys.com/bucket/orig.mp4",
              sourceUrlState: "present_http",
              needs: { startup540FaststartAvc: true, startup720FaststartAvc: true }
            }
          ]
        },
        analyze: { missingSourceCount: 0, needsGenerationCount: 1 }
      }
    });
    expect(r.failureClass).toBe("unresolved_video_variants");
    expect(r.isRepairable).toBe(true);
    expect(r.shouldAttemptFaststartRepair).toBe(true);
    expect(r.precheckValidationContradiction).toBe(true);
    expect(r.reasons.some((x) => x.includes("precheck_validation_contradiction"))).toBe(true);
  });

  it("C: missing source video — no repair", () => {
    const r = classifyPostRebuildFailure({
      rawPost: activeVideoRaw,
      validation: { blockingErrors: [] },
      compactCheck: { compactOk: true, mediaNeedsRepair: true, videoNeedsFaststart: true, canSkipWrite: false },
      context: {
        status: "generation_failed",
        generationFailureDetail: {
          reason: "strict_mode_blocked_unresolved_video_variants_after_repair",
          perAsset: [
            {
              assetId: "a1",
              sourceUrl: "",
              sourceUrlState: "missing",
              needs: { startup540FaststartAvc: true }
            }
          ]
        },
        analyze: { missingSourceCount: 1, needsGenerationCount: 0 }
      }
    });
    expect(r.failureClass).toBe("missing_source_video");
    expect(r.isRepairable).toBe(false);
    expect(r.shouldAttemptFaststartRepair).toBe(false);
    expect(r.shouldQuarantine).toBe(true);
  });

  it("D: external Instagram / fbcdn source — quarantine unless durable copy flag", () => {
    const r = classifyPostRebuildFailure({
      rawPost: activeVideoRaw,
      validation: { blockingErrors: [] },
      compactCheck: { compactOk: true, mediaNeedsRepair: true, videoNeedsFaststart: true, canSkipWrite: false },
      context: {
        status: "generation_failed",
        generationFailureDetail: {
          reason: "strict_mode_blocked_unresolved_video_variants_after_repair",
          perAsset: [
            {
              assetId: "a1",
              sourceUrl: "https://scontent.cdninstagram.com/v/foo.mp4",
              sourceUrlState: "present_http",
              needs: { startup720FaststartAvc: true }
            }
          ]
        },
        analyze: { missingSourceCount: 0, needsGenerationCount: 1 }
      }
    });
    expect(r.failureClass).toBe("external_or_expiring_source_url");
    expect(r.shouldQuarantine).toBe(true);
    process.env.POST_REBUILDER_DURABLE_SOURCE_COPY = "1";
    const r2 = classifyPostRebuildFailure({
      rawPost: activeVideoRaw,
      validation: { blockingErrors: [] },
      compactCheck: { compactOk: true, mediaNeedsRepair: true, videoNeedsFaststart: true, canSkipWrite: false },
      context: {
        status: "generation_failed",
        generationFailureDetail: {
          reason: "strict_mode_blocked_unresolved_video_variants_after_repair",
          perAsset: [
            {
              assetId: "a1",
              sourceUrl: "https://scontent.cdninstagram.com/v/foo.mp4",
              sourceUrlState: "present_http",
              needs: { startup720FaststartAvc: true }
            }
          ]
        },
        analyze: { missingSourceCount: 0, needsGenerationCount: 1 }
      }
    });
    expect(r2.failureClass).not.toBe("external_or_expiring_source_url");
  });

  it("E: no blocking / no strict video context — unknown", () => {
    const r = classifyPostRebuildFailure({
      rawPost: { id: "p_img", classification: { mediaKind: "photo" } },
      validation: { blockingErrors: [] },
      compactCheck: { compactOk: true, mediaNeedsRepair: false, videoNeedsFaststart: false, canSkipWrite: true },
      context: { status: "complete" }
    });
    expect(r.failureClass).toBe("unknown");
  });

  it("F: deleted post — preserve deleted, no video repair", () => {
    const r = classifyPostRebuildFailure({
      rawPost: {
        id: "p_del",
        deleted: true,
        classification: { mediaKind: "video" },
        lifecycle: { status: "deleted", isDeleted: true }
      },
      validation: { blockingErrors: [{ code: "video_x", message: "strict" }] },
      compactCheck: { compactOk: true, mediaNeedsRepair: false, videoNeedsFaststart: false, canSkipWrite: true },
      context: { status: "validation_failed" }
    });
    expect(r.failureClass).toBe("deleted_or_unsupported_media");
    expect(r.isRepairable).toBe(false);
    expect(r.shouldAttemptFaststartRepair).toBe(false);
  });

  it("validation-only strict video gap still pairs with contradiction when precheck silent", () => {
    const r = classifyPostRebuildFailure({
      rawPost: activeVideoRaw,
      validation: {
        blockingErrors: [{ code: "unresolved_video_variants_after_repair", message: "needs startup720" }]
      },
      compactCheck: {
        compactOk: true,
        mediaNeedsRepair: false,
        videoNeedsFaststart: false,
        canSkipWrite: true
      },
      context: { status: "validation_failed" }
    });
    expect(r.precheckValidationContradiction).toBe(true);
    expect(r.failureClass).toBe("unresolved_video_variants");
  });
});
