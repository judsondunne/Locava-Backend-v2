import { describe, expect, it } from "vitest";
import {
  REQUIRED_TOP_LEVEL_BLOCKS,
  checkPostContractV2,
  classifyPostForAudit,
} from "./postContractV2.js";
import {
  FIXTURE_URLS,
  buildFailedAfterGenerationPendingFixture,
  buildSuccessfulCompletedFixture,
} from "./__fixtures__/postContractV2.fixtures.js";

describe("checkPostContractV2 — pending vs completed contract", () => {
  it("the failed-but-pending fixture passes the instantPending contract", () => {
    const fixture = buildFailedAfterGenerationPendingFixture();
    const result = checkPostContractV2(fixture, "instantPending");
    if (!result.ok) {
      // Surface the failures in the assertion message so regressions are easy to debug.
      // eslint-disable-next-line no-console
      console.error("pending failures", result.errors);
    }
    expect(result.ok).toBe(true);
    expect(result.summary.requiredBlocksMissing).toBe(0);
  });

  it("the failed-but-pending fixture fails the completedReady contract because faststart is unverified", () => {
    const fixture = buildFailedAfterGenerationPendingFixture();
    const result = checkPostContractV2(fixture, "completedReady");
    expect(result.ok).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("completed_media_status_not_ready");
    expect(codes).toContain("completed_faststart_not_verified");
    expect(codes).toContain("completed_instant_playback_not_ready_video");
  });

  it("the successful completed fixture passes both pending and completed contracts", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const pending = checkPostContractV2(fixture, "instantPending");
    const completed = checkPostContractV2(fixture, "completedReady");
    if (!completed.ok) {
      // eslint-disable-next-line no-console
      console.error("completed failures", completed.errors);
    }
    expect(pending.ok).toBe(true);
    expect(completed.ok).toBe(true);
    expect(completed.summary.posterPlaybackMixupErrors).toBe(0);
  });

  it("missing top-level blocks fail with one error per block", () => {
    const result = checkPostContractV2({}, "instantPending");
    expect(result.ok).toBe(false);
    const missingCodes = result.errors
      .filter((e) => e.code === "missing_required_block")
      .map((e) => e.path)
      .filter((p): p is string => Boolean(p));
    for (const block of REQUIRED_TOP_LEVEL_BLOCKS) {
      expect(missingCodes).toContain(block);
    }
  });

  it("rejects a poster URL that points to a video on the asset.video.playback.posterUrl path", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const media = fixture.media as Record<string, unknown>;
    const asset = (media.assets as Array<Record<string, unknown>>)[0]!;
    const video = asset.video as Record<string, unknown>;
    const playback = video.playback as Record<string, unknown>;
    playback.posterUrl = FIXTURE_URLS.STARTUP_720;
    const result = checkPostContractV2(fixture, "completedReady");
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("playback_poster_is_video");
  });

  it("rejects compatibility.photoLinks2 pointing at the poster image when post is completed", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const compat = fixture.compatibility as Record<string, unknown>;
    compat.photoLinks2 = FIXTURE_URLS.POSTER_JPG;
    const result = checkPostContractV2(fixture, "completedReady");
    expect(result.ok).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("compatibility_photo_links_points_to_image");
  });

  it("rejects a compatibility.fallbackVideoUrl that resolves to an image", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const compat = fixture.compatibility as Record<string, unknown>;
    compat.fallbackVideoUrl = FIXTURE_URLS.POSTER_JPG;
    const result = checkPostContractV2(fixture, "completedReady");
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("compatibility_fallback_is_image");
  });

  it("rejects a media.cover.url that is a video URL", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const media = fixture.media as Record<string, unknown>;
    const cover = media.cover as Record<string, unknown>;
    cover.url = FIXTURE_URLS.STARTUP_720;
    const result = checkPostContractV2(fixture, "completedReady");
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("cover_url_is_video");
  });

  it("requires verified_startup_avc_faststart_* selectedReason on completed posts", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const media = fixture.media as Record<string, unknown>;
    const asset = (media.assets as Array<Record<string, unknown>>)[0]!;
    const video = asset.video as Record<string, unknown>;
    const playback = video.playback as Record<string, unknown>;
    playback.selectedReason = "original_unverified_fallback";
    const result = checkPostContractV2(fixture, "completedReady");
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain(
      "completed_selected_reason_not_verified",
    );
  });
});

describe("classifyPostForAudit", () => {
  it("classifies the failed-after-generation fixture correctly", () => {
    const fixture = buildFailedAfterGenerationPendingFixture();
    const out = classifyPostForAudit(fixture);
    expect(out.classification).toBe("processor_failed_after_generation");
    expect(out.hints).toContain("processor_failed_after_generation");
  });

  it("classifies the successful canonical fixture as valid_ready", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const out = classifyPostForAudit(fixture);
    expect(out.classification).toBe("valid_ready");
  });

  it("classifies a missing-block post as invalid_contract", () => {
    const out = classifyPostForAudit({});
    expect(out.classification).toBe("invalid_contract");
  });

  it("classifies an HDR-source completed post with no tone mapping as possible_hdr_poster_mismatch", () => {
    const fixture = buildSuccessfulCompletedFixture();
    fixture.mediaProcessingDiagnostics = {
      sourceHdrDetected: true,
      posterToneMappingApplied: false,
      sourceColorPrimaries: "bt2020",
      sourceColorTransfer: "smpte2084",
    };
    const out = classifyPostForAudit(fixture);
    expect(out.classification).toBe("possible_hdr_poster_mismatch");
    expect(out.hints).toContain("possible_hdr_poster_mismatch");
  });
});
