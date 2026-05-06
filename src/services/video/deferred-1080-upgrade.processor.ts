import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { readWasabiConfigFromEnv } from "../storage/wasabi-config.js";
import { writeCompactLivePostAfterNativeVideoProcessing } from "../posting/native-async-video-post-complete.js";
import {
  downloadVideoSourceToFile,
  encodeAndUploadVideoAsset,
  LAB_ARTIFACT_KEYS,
  type VideoAssetJob
} from "./video-post-encoding.pipeline.js";
import { parseDurationSeconds, pickPrimaryStreams, runFfprobeJson } from "./ffprobe.js";
import { verifyRemoteMp4Faststart } from "./remote-url-verify.js";
import { verifyS3ObjectMp4Faststart } from "./s3-mp4-verify.js";
import { normalizeVideoLabPostFolder } from "./normalizeVideoLabPostFolder.js";
import {
  buildDeferred1080UpgradeEncodeOnly,
  evaluateDeferred1080UpgradeEligibility,
  strip1080AliasKeysFromEncodedResult
} from "./post-ready-variant-plan.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bitrateKbpsFromFile(sizeBytes: number, durationSec: number): number {
  if (!(durationSec > 0.05) || !(sizeBytes > 0)) return 0;
  return Math.round((sizeBytes * 8) / durationSec / 1000);
}

function cloneWritablePostAssets(post: Record<string, unknown>): {
  workingPost: Record<string, unknown>;
  assetsMut: Record<string, unknown>[];
} {
  const wp = { ...post } as Record<string, unknown>;
  if (Array.isArray(post.assets) && (post.assets as unknown[]).length > 0) {
    const assetsMut = [...(post.assets as Record<string, unknown>[])];
    wp.assets = assetsMut;
    return { workingPost: wp, assetsMut };
  }
  const media = { ...(asRecord(post.media) ?? {}) };
  const assetsMut = [...(Array.isArray(media.assets) ? (media.assets as Record<string, unknown>[]) : [])];
  wp.media = { ...media, assets: assetsMut };
  delete wp.assets;
  return { workingPost: wp, assetsMut };
}

function videoVariantsFromAssetRow(row: Record<string, unknown>): Record<string, unknown> {
  const vid = asRecord(row.video);
  if (vid && String(row.type ?? "").toLowerCase() === "video") {
    return { ...(asRecord(vid.variants) ?? {}) };
  }
  return { ...(asRecord(row.variants) ?? {}) };
}

function setVideoVariantsOnAssetRow(row: Record<string, unknown>, variants: Record<string, unknown>): void {
  const vid = asRecord(row.video);
  if (vid && String(row.type ?? "").toLowerCase() === "video") {
    row.video = { ...vid, variants: { ...variants } };
  } else {
    row.variants = { ...variants };
  }
}

export type Deferred1080Payload = {
  postId: string;
  userId: string;
  videoAssets: VideoAssetJob[];
};

/**
 * Second-stage worker: encodes **only** `upgrade1080FaststartAvc` when eligible, then re-compacts live doc.
 * Does not change defaultUrl / primaryUrl / startupUrl (still driven by startup720 in compact pass).
 */
export async function processDeferred1080UpgradeJob(
  payload: Deferred1080Payload
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getFirestoreSourceClient();
  const cfg = readWasabiConfigFromEnv();
  if (!db) return { ok: false, error: "firestore_unavailable" };
  if (!cfg) return { ok: false, error: "wasabi_unavailable" };

  const postRef = db.collection("posts").doc(payload.postId);
  const snap = await postRef.get();
  if (!snap.exists) return { ok: false, error: "post_not_found" };
  const snapshotRaw = { ...(snap.data() ?? {}) } as Record<string, unknown>;
  const post = (snap.data() ?? {}) as Record<string, unknown>;
  const job = payload.videoAssets[0];
  if (!job?.id?.trim() || !job.original?.trim()) return { ok: false, error: "invalid_video_assets" };

  const { workingPost, assetsMut } = cloneWritablePostAssets(post);
  const idx = assetsMut.findIndex((a) => String(a.id ?? "") === job.id.trim());
  if (idx < 0) return { ok: false, error: "asset_not_found" };
  const assetRow = { ...assetsMut[idx] } as Record<string, unknown>;
  if (String(assetRow.type ?? "").toLowerCase() !== "video") return { ok: false, error: "asset_not_video" };

  const variants = { ...videoVariantsFromAssetRow(assetRow) };
  const existingUpgrade = trimStr(variants.upgrade1080FaststartAvc);
  if (existingUpgrade.startsWith("http")) {
    return { ok: true };
  }

  const enableRemoteUploadVerify = process.env.VIDEO_ENABLE_REMOTE_UPLOAD_VERIFY === "1";
  const workRoot = path.join(os.tmpdir(), `locava-v2-1080-${payload.postId}-${job.id}`);
  await fs.mkdir(workRoot, { recursive: true });
  const workDir = path.join(workRoot, "enc");
  const ffprobe = process.env.FFPROBE_BIN?.trim() || "ffprobe";

  try {
    await fs.mkdir(workDir, { recursive: true });
    const localIn = path.join(workDir, "source_in.mp4");
    await downloadVideoSourceToFile(job.original.trim(), localIn);
    const stIn = await fs.stat(localIn);
    const probe = await runFfprobeJson(localIn, ffprobe);
    const { video } = pickPrimaryStreams(probe.streams);
    if (!video || typeof video.index !== "number") throw new Error("ffprobe_missing_video_stream");
    const w = Number(video.width ?? 0);
    const h = Number(video.height ?? 0);
    if (!(w > 0) || !(h > 0)) throw new Error("ffprobe_invalid_dimensions");
    const durationSec = parseDurationSeconds(probe.format, probe.streams);
    const sizeBytes = stIn.size;
    const brFmt = Number(probe.format?.bit_rate ?? 0);
    const sourceBitrateKbps =
      Number.isFinite(brFmt) && brFmt > 0 ? brFmt / 1000 : bitrateKbpsFromFile(sizeBytes, durationSec);

    const elig = evaluateDeferred1080UpgradeEligibility({
      width: w,
      height: h,
      durationSec,
      sizeBytes,
      sourceBitrateKbps: sourceBitrateKbps > 0 ? sourceBitrateKbps : null
    });
    if (!elig.eligible) {
      await postRef.set(
        {
          deferred1080Upgrade: {
            phase: "skipped",
            uiStatus: "1080_upgrade_skipped_source_too_low",
            skippedReason: elig.skippedReason ?? "source_below_1080_quality",
            checkedAt: new Date().toISOString()
          },
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
      return { ok: true };
    }

    await postRef.set(
      {
        deferred1080Upgrade: {
          phase: "encoding",
          uiStatus: "1080_upgrade_pending",
          startedAt: new Date().toISOString()
        },
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );

    let encoded = await encodeAndUploadVideoAsset({
      cfg,
      postId: payload.postId,
      asset: job,
      workDir,
      enableMain720Hevc: false,
      encodeOnly: buildDeferred1080UpgradeEncodeOnly(),
      preDownloadedSourcePath: localIn
    });
    encoded = strip1080AliasKeysFromEncodedResult(encoded);

    const upgradeUrl = trimStr(encoded.playbackLabGenerated.upgrade1080FaststartAvc);
    if (!upgradeUrl.startsWith("http")) {
      throw new Error("deferred_1080_missing_upgrade_url");
    }

    const prefix = String(encoded.videosLabKeyPrefix ?? "").trim();
    const original = String(
      asRecord(assetRow.video)?.originalUrl ?? assetRow.original ?? job.original
    ).trim();
    const remoteChecks: Array<Record<string, unknown>> = [];
    if (enableRemoteUploadVerify) {
      const suffix = LAB_ARTIFACT_KEYS.upgrade1080FaststartAvc;
      const hint =
        upgradeUrl ||
        `https://videos-lab.internal/${encodeURIComponent(normalizeVideoLabPostFolder(payload.postId))}/${suffix}`;
      const moovOpts = { requireMoovBeforeMdat: true as const };
      let r = await verifyS3ObjectMp4Faststart(cfg, `${prefix}/${suffix}`, original, hint, moovOpts);
      if (!r.ok && /^https?:\/\//i.test(upgradeUrl)) {
        r = await verifyRemoteMp4Faststart(upgradeUrl, original, moovOpts);
      }
      remoteChecks.push({
        label: "upgrade1080FaststartAvc",
        ...(r.ok ? { ok: true, url: upgradeUrl } : { ok: false, url: upgradeUrl, reason: "reason" in r ? r.reason : "unknown" })
      });
      if (!r.ok) throw new Error(`deferred_1080_verify_failed:${"reason" in r ? r.reason : "unknown"}`);
    }

    const mergedVariants = { ...variants, upgrade1080FaststartAvc: upgradeUrl };
    delete (mergedVariants as { main1080?: unknown }).main1080;
    delete (mergedVariants as { main1080Avc?: unknown }).main1080Avc;
    delete (mergedVariants as { startup1080FaststartAvc?: unknown }).startup1080FaststartAvc;

    setVideoVariantsOnAssetRow(assetRow, mergedVariants as Record<string, unknown>);
    assetsMut[idx] = assetRow;

    const labNodeFull: Record<string, unknown> = {
      generated: {
        ...encoded.playbackLabGenerated,
        diagnosticsJson: encoded.diagnosticsJson
      },
      generationMetadata: encoded.generationMetadata,
      lastVerifyResults: [...encoded.lastVerifyResults, ...remoteChecks],
      lastVerifyAllOk: true
    };

    const wr = await writeCompactLivePostAfterNativeVideoProcessing({
      db,
      postRef,
      postId: payload.postId,
      snapshotRaw,
      workingPost,
      playbackLabDiagnosticsAssets: {
        [job.id]: labNodeFull
      },
      diagnosticsExtra: { job: "deferred_1080_upgrade" },
      extraLiveTopLevel: {
        deferred1080Upgrade: {
          phase: "complete",
          uiStatus: "1080_upgrade_complete",
          completedAt: new Date().toISOString()
        }
      }
    });
    if (!wr.ok) return { ok: false, error: wr.error };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await postRef.set(
      {
        deferred1080Upgrade: {
          phase: "failed",
          uiStatus: "1080_upgrade_failed",
          lastError: msg.slice(0, 800),
          failedAt: new Date().toISOString()
        },
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );
    return { ok: false, error: msg };
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
