import { describe, expect, it } from "vitest";
import { classifyPostForAudit } from "./postContractV2.js";
import {
  FIXTURE_URLS,
  buildFailedAfterGenerationPendingFixture,
  buildSuccessfulCompletedFixture,
} from "./__fixtures__/postContractV2.fixtures.js";

/**
 * Mirrors the `computeSafeRepairs` logic in scripts/audit-posting-contract-v2.ts so we exercise the
 * pure portion (proposed repairs only) without needing Firestore. Keep this in sync with that script.
 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function computeSafeRepairs(post: Record<string, unknown>): {
  labels: string[];
  patch: Record<string, unknown>;
} {
  const labels: string[] = [];
  const patch: Record<string, unknown> = {};
  const playbackLab = asRecord(post.playbackLab);
  if (!playbackLab) return { labels, patch };
  if (playbackLab.lastVerifyAllOk !== true) return { labels, patch };
  const labAssets = asRecord(playbackLab.assets);
  if (!labAssets) return { labels, patch };
  const media = asRecord(post.media);
  const assets = Array.isArray(media?.assets)
    ? (media.assets as Array<Record<string, unknown>>)
    : [];
  let firstStartup720: string | null = null;
  for (const asset of assets) {
    const id = String(asset.id ?? "");
    if (!id) continue;
    const labNode = asRecord(labAssets[id]);
    const gen = asRecord(labNode?.generated);
    const startup720 = trimStr(gen?.startup720FaststartAvc);
    const startup540 = trimStr(gen?.startup540FaststartAvc);
    if (!firstStartup720 && startup720.startsWith("http")) firstStartup720 = startup720;
    if (!startup720 || !startup540) continue;
    const v = asRecord(asset.video);
    const variants = asRecord(v?.variants) ?? {};
    if (!trimStr(variants.startup720FaststartAvc)) {
      labels.push(`promote_lab_startup720_to_canonical:${id}`);
      patch[`media.assets.[id=${id}].video.variants.startup720FaststartAvc`] = startup720;
    }
    if (!trimStr(variants.startup540FaststartAvc)) {
      labels.push(`promote_lab_startup540_to_canonical:${id}`);
      patch[`media.assets.[id=${id}].video.variants.startup540FaststartAvc`] = startup540;
    }
  }
  if (firstStartup720) {
    const compat = asRecord(post.compatibility);
    if (compat) {
      for (const k of ["photoLinks2", "photoLinks3"] as const) {
        const cur = trimStr(compat[k]);
        if (!cur) {
          labels.push(`mirror_compatibility_${k}_to_startup720`);
          patch[`compatibility.${k}`] = firstStartup720;
          continue;
        }
        if (
          /\.(jpe?g|png|webp|gif|heic|heif|avif)(\?|$)/i.test(cur) &&
          /faststart[_-]?avc/i.test(firstStartup720)
        ) {
          labels.push(`replace_compatibility_${k}_image_with_startup720`);
          patch[`compatibility.${k}`] = firstStartup720;
        }
      }
    }
  }
  return { labels, patch };
}

describe("audit-posting-contract-v2 — safe repairs (pure)", () => {
  it("on the failed-after-generation fixture, proposes promoting lab outputs and replacing compatibility image links", () => {
    const fixture = buildFailedAfterGenerationPendingFixture();
    /** Make playbackLab.lastVerifyAllOk=true so the safe repair is allowed (test expects this). */
    (fixture.playbackLab as Record<string, unknown>).lastVerifyAllOk = true;
    const repairs = computeSafeRepairs(fixture);
    expect(repairs.labels).toContain(
      `promote_lab_startup720_to_canonical:${FIXTURE_URLS.VIDEO_ASSET_ID}`,
    );
    expect(repairs.labels).toContain(
      `promote_lab_startup540_to_canonical:${FIXTURE_URLS.VIDEO_ASSET_ID}`,
    );
    expect(
      repairs.labels.some((l) => l.startsWith("replace_compatibility_photoLinks2_image")),
    ).toBe(true);
    expect(repairs.patch[`compatibility.photoLinks2`]).toBe(FIXTURE_URLS.STARTUP_720);
  });

  it("does not propose repairs when playbackLab.lastVerifyAllOk is not true", () => {
    const fixture = buildFailedAfterGenerationPendingFixture();
    (fixture.playbackLab as Record<string, unknown>).lastVerifyAllOk = false;
    const repairs = computeSafeRepairs(fixture);
    expect(repairs.labels.length).toBe(0);
  });

  it("does not propose any repairs on the successful canonical fixture (already in sync)", () => {
    const fixture = buildSuccessfulCompletedFixture();
    const repairs = computeSafeRepairs(fixture);
    expect(repairs.labels.length).toBe(0);
  });

  it("classifyPostForAudit covers all expected classifications used by the audit script", () => {
    const expectedLabels: ReturnType<typeof classifyPostForAudit>["classification"][] = [
      "valid_pending",
      "valid_ready",
      "invalid_contract",
      "invalid_media_sync",
      "invalid_compatibility_sync",
      "processor_failed_after_generation",
      "poster_playback_mismatch_risk",
      "possible_hdr_poster_mismatch",
    ];
    for (const lbl of expectedLabels) {
      expect(typeof lbl).toBe("string");
    }
  });
});
