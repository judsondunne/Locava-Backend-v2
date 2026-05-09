import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { readWasabiConfigFromEnv } from "../storage/wasabi-config.js";
import { buildPostMediaReadiness } from "../../lib/posts/media-readiness.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import {
  collectTrustedStartupUrlsForNativeComplete,
  mergeEncodedIntoVideoAssetRow,
  playbackLabVerificationFromUrls,
  slimPlaybackLabAssetNode,
  writeCompactLivePostAfterNativeVideoProcessing
} from "../posting/native-async-video-post-complete.js";
import {
  encodeAndUploadVideoAsset,
  LAB_ARTIFACT_KEYS,
  type EncodedVideoAssetResult,
  type VideoAssetJob
} from "./video-post-encoding.pipeline.js";
import { verifyRemoteMp4Faststart } from "./remote-url-verify.js";
import { verifyS3ObjectMp4Faststart } from "./s3-mp4-verify.js";
import { normalizeVideoLabPostFolder } from "./normalizeVideoLabPostFolder.js";
import { enqueueDeferred1080UpgradeCloudTask } from "../posting/video-processing-cloud-task.service.js";
import {
  buildNativeFastPathEncodeOnly,
  evaluateDeferred1080UpgradeEligibility,
  getRequiredVariantsForPostReady,
  hasConfidentPosterUrl
} from "./post-ready-variant-plan.js";

export type VideoProcessorPayload = {
  postId: string;
  userId: string;
  videoAssets: VideoAssetJob[];
};

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

async function emitAsyncPipelinePhase(
  postRef: DocumentReference,
  asyncExtras: Record<string, unknown>,
  progressExtras?: Record<string, unknown>
): Promise<void> {
  const snap = await postRef.get();
  const doc = (snap.data() ?? {}) as Record<string, unknown>;
  const prevLab = asRecord(doc.playbackLab) ?? {};
  const prevPipe = asRecord(prevLab.asyncPipeline) ?? {};
  const stamp = Date.now();
  const patch: Record<string, unknown> = {
    playbackLabUpdatedAt: Timestamp.fromMillis(stamp),
    playbackLab: {
      ...prevLab,
      asyncPipeline: {
        ...prevPipe,
        ...asyncExtras,
        phaseUpdatedAtMs: stamp
      }
    }
  };
  if (progressExtras) {
    const prevProg = asRecord(doc.videoProcessingProgress) ?? {};
    patch.videoProcessingProgress = { ...prevProg, ...progressExtras };
  }
  await postRef.set(patch, { merge: true });
}

function labArtifactSuffixForVerifyLabel(label: string): string | null {
  switch (label) {
    case "preview360Avc":
      return LAB_ARTIFACT_KEYS.preview360Avc;
    case "main720Avc":
      return LAB_ARTIFACT_KEYS.main720Avc;
    case "main720":
      return LAB_ARTIFACT_KEYS.main720Hevc;
    case "startup540":
      return LAB_ARTIFACT_KEYS.startup540FaststartAvc;
    case "startup720":
      return LAB_ARTIFACT_KEYS.startup720FaststartAvc;
    case "startup1080":
      return LAB_ARTIFACT_KEYS.startup1080FaststartAvc;
    case "upgrade1080":
      return LAB_ARTIFACT_KEYS.upgrade1080FaststartAvc;
    default:
      return null;
  }
}

export async function processVideoPostJob(payload: VideoProcessorPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getFirestoreSourceClient();
  const cfg = readWasabiConfigFromEnv();
  if (!db) return { ok: false, error: "firestore_unavailable" };
  if (!cfg) return { ok: false, error: "wasabi_unavailable" };

  const postRef = db.collection("posts").doc(payload.postId);
  const snap = await postRef.get();
  if (!snap.exists) return { ok: false, error: "post_not_found" };
  const post = (snap.data() ?? {}) as Record<string, unknown>;
  const snapshotRaw = { ...post } as Record<string, unknown>;
  const assets = Array.isArray(post.assets) ? [...(post.assets as Record<string, unknown>[])] : [];
  const nowMs = Date.now();
  const nowTs = Timestamp.fromMillis(nowMs);

  const normalizedProbe = normalizeMasterPostV2(post, {
    postId: payload.postId,
    postingFinalizeV2: true,
    now: new Date(nowMs)
  });
  const fvProbe = normalizedProbe.canonical.media.assets.find((a) => a.type === "video");
  const completed = String(post.videoProcessingStatus ?? "").toLowerCase() === "completed";
  const mediaReady = normalizedProbe.canonical.media.status === "ready";
  const vidReady =
    fvProbe &&
    fvProbe.video?.readiness?.instantPlaybackReady === true &&
    fvProbe.video?.readiness?.assetsReady === true &&
    fvProbe.video?.readiness?.faststartVerified === true;
  if (completed && mediaReady && vidReady) {
    return { ok: true };
  }

  const enableRemoteUploadVerify = process.env.VIDEO_ENABLE_REMOTE_UPLOAD_VERIFY === "1";
  const includePreview360 = process.env.NATIVE_POST_READY_INCLUDE_PREVIEW360 === "1";
  const includeMain720 = process.env.NATIVE_POST_READY_INCLUDE_MAIN720 === "1";
  const variantPlan = getRequiredVariantsForPostReady({
    includePreview360Avc: includePreview360,
    includeMain720Avc: includeMain720
  });

  await postRef.set(
    {
      playbackLabUpdatedAt: nowTs,
      playbackLabStatus: "processing",
      playbackLab: {
        ...(asRecord(post.playbackLab) ?? {}),
        status: "processing",
        asyncPipeline: {
          status: "processing",
          source: "native_v2_finalize",
          lastGenerateSuccess: false,
          lastVerifyAllOk: false,
          lastException: null,
          lastGenerateErrors: []
        }
      },
      videoProcessingStatus: "processing"
    },
    { merge: true }
  );

  await emitAsyncPipelinePhase(
    postRef,
    { status: "processing", phase: "worker_started" },
    { phase: "encode", totalVideos: payload.videoAssets.length, processedVideos: 0 }
  ).catch(() => {});

  const workRoot = path.join(os.tmpdir(), `locava-v2-video-${payload.postId}-${randomUUID()}`);
  await fs.mkdir(workRoot, { recursive: true });

  const playbackLabAssetsFull: Record<string, unknown> = {
    ...asRecord(asRecord(post.playbackLab)?.assets)
  };
  const slimLabAssets: Record<string, unknown> = {};
  const generateErrors: string[] = [];
  let assetsEncodedAndVerified = 0;
  const allTrustUrls: string[] = [];
  /** First encoded asset's HDR / filter mode summary — surfaced into diagnostics. */
  let firstEncodedHdrInfo: {
    hdrKind: string;
    isHdr: boolean;
    isWideGamutOrHdr: boolean;
    colorPrimaries: string | null;
    colorTransfer: string | null;
    colorSpace: string | null;
    pixFmt: string | null;
    dolbyVisionSideData: boolean;
    filterMode: string;
    posterToneMappingApplied: boolean;
  } | null = null;

  try {
    for (const job of payload.videoAssets) {
      const assetRow = assets.find((a) => String(a.id ?? "") === job.id.trim());
      if (!assetRow || String(assetRow.type ?? "").toLowerCase() !== "video") {
        generateErrors.push(`missing_video_asset:${job.id}`);
        continue;
      }
      const original = String(assetRow.original ?? "").trim();
      if (original !== job.original.trim()) {
        generateErrors.push(`original_mismatch:${job.id}`);
        continue;
      }
      const poster =
        String(assetRow.poster ?? "").trim() ||
        String((asRecord(assetRow.variants)?.poster as string | undefined) ?? "").trim();
      const variants = asRecord(assetRow.variants) ?? {};
      const existing540 = trimStr(variants.startup540FaststartAvc);
      const existing720 = trimStr(variants.startup720FaststartAvc);
      const existingKeys = new Set<string>();
      if (existing540) existingKeys.add("startup540FaststartAvc");
      if (existing720) existingKeys.add("startup720FaststartAvc");
      if (trimStr(variants.preview360Avc)) existingKeys.add("preview360Avc");
      if (trimStr(variants.main720Avc)) existingKeys.add("main720Avc");
      if (trimStr(variants.posterHigh)) existingKeys.add("posterHigh");

      const needsPosterHigh = !hasConfidentPosterUrl({
        poster: assetRow.poster,
        variantPoster: variants.poster
      });

      const encodeOnly = buildNativeFastPathEncodeOnly({
        plan: variantPlan,
        needsPosterHigh,
        includePreview360Avc: includePreview360,
        includeMain720Avc: includeMain720,
        existingEncodedKeys: existingKeys
      });
      const needsEncode = Object.values(encodeOnly).some(Boolean);

      const workDir = path.join(workRoot, job.id.replace(/[^\w-]+/g, "_"));
      await fs.mkdir(workDir, { recursive: true });
      await emitAsyncPipelinePhase(
        postRef,
        { status: "processing", phase: "encode_transcode", encodeAssetId: job.id },
        { phase: "encode_transcode", currentAssetId: job.id }
      ).catch(() => {});

      let encoded: EncodedVideoAssetResult | null = null;
      if (needsEncode) {
        encoded = await encodeAndUploadVideoAsset({
          cfg,
          postId: payload.postId,
          asset: job,
          workDir,
          enableMain720Hevc: false,
          encodeOnly
        });
        if (encoded && !firstEncodedHdrInfo) {
          firstEncodedHdrInfo = {
            hdrKind: encoded.hdr.kind,
            isHdr: encoded.hdr.isHdr,
            isWideGamutOrHdr: encoded.hdr.isWideGamutOrHdr,
            colorPrimaries: encoded.hdr.colorPrimaries,
            colorTransfer: encoded.hdr.colorTransfer,
            colorSpace: encoded.hdr.colorSpace,
            pixFmt: encoded.hdr.pixFmt,
            dolbyVisionSideData: encoded.hdr.dolbyVisionSideData,
            filterMode: encoded.filterMode,
            posterToneMappingApplied: encoded.filterMode === "hdr_tonemap",
          };
        }
      }

      const mergedRow = mergeEncodedIntoVideoAssetRow({
        assetRow,
        encoded,
        existingStartup540: existing540,
        existingStartup720: existing720
      });
      const mergedVariantsPreview = asRecord(mergedRow.variants) ?? {};

      await emitAsyncPipelinePhase(
        postRef,
        { status: "processing", phase: "verify_lab_outputs", encodeAssetId: job.id },
        { phase: "verify", currentAssetId: job.id }
      ).catch(() => {});

      const remoteChecks: Array<Record<string, unknown>> = [];
      const prefix = encoded ? String(encoded.videosLabKeyPrefix ?? "").trim() : "";
      const check = async (label: string, url: string) => {
        const u = String(url ?? "").trim();
        if (!u) return;
        if (!enableRemoteUploadVerify) {
          remoteChecks.push({
            label,
            verifyMode: "trust_local_encode",
            ok: true,
            skipped: true,
            url: u
          });
          return;
        }
        const suffix = labArtifactSuffixForVerifyLabel(label);
        const useS3Lab = Boolean(prefix && suffix);
        const variantHintForDedup =
          u ||
          `https://videos-lab.internal/${encodeURIComponent(normalizeVideoLabPostFolder(payload.postId))}/${suffix}`;
        let verifyMode: "s3_lab" | "remote" | "s3_lab_then_https" = useS3Lab ? "s3_lab" : "remote";
        const moovOpts = { requireMoovBeforeMdat: true as const };

        let r: Awaited<ReturnType<typeof verifyRemoteMp4Faststart>>;
        if (useS3Lab) {
          r = await verifyS3ObjectMp4Faststart(cfg, `${prefix}/${suffix}`, original, variantHintForDedup, moovOpts);
          if (!r.ok && /^https?:\/\//i.test(u)) {
            const rHttp = await verifyRemoteMp4Faststart(u, original, moovOpts);
            if (rHttp.ok) {
              r = rHttp;
              verifyMode = "s3_lab_then_https";
            }
          }
        } else {
          r = await verifyRemoteMp4Faststart(u, original, moovOpts);
        }
        remoteChecks.push({
          label,
          verifyMode,
          ...r
        });
        if (!r.ok) throw new Error(`remote_verify_failed:${label}:${"reason" in r ? r.reason : "unknown"}`);
      };

      const u540 = trimStr(mergedVariantsPreview.startup540FaststartAvc);
      const u720 = trimStr(mergedVariantsPreview.startup720FaststartAvc);
      const u360 = trimStr(mergedVariantsPreview.preview360Avc);
      const uMain = trimStr(mergedVariantsPreview.main720Avc);
      await check("startup540", u540);
      await check("startup720", u720);
      if (u360) await check("preview360Avc", u360);
      if (uMain) await check("main720Avc", uMain);

      const labNodeFull: Record<string, unknown> = encoded
        ? {
            generated: {
              ...encoded.playbackLabGenerated,
              diagnosticsJson: encoded.diagnosticsJson
            },
            generationMetadata: encoded.generationMetadata,
            lastVerifyResults: [...encoded.lastVerifyResults, ...remoteChecks],
            lastVerifyAllOk: true
          }
        : {
            generated: {
              ...(u540 ? { startup540FaststartAvc: u540 } : {}),
              ...(u720 ? { startup720FaststartAvc: u720 } : {}),
              ...(u360 ? { preview360Avc: u360 } : {}),
              ...(uMain ? { main720Avc: uMain } : {})
            },
            lastVerifyResults: remoteChecks,
            lastVerifyAllOk: true
          };

      playbackLabAssetsFull[job.id] = labNodeFull;
      slimLabAssets[job.id] = slimPlaybackLabAssetNode(labNodeFull);

      const trustUrls = collectTrustedStartupUrlsForNativeComplete({
        remoteChecks,
        encoded,
        existingStartup540: existing540,
        existingStartup720: existing720
      });
      allTrustUrls.push(...trustUrls);

      const mergedAsset = { ...mergedRow };
      mergedAsset.playbackLab = {
        ...(asRecord(assetRow.playbackLab) ?? {}),
        ...slimPlaybackLabAssetNode(labNodeFull)
      };

      const idx = assets.findIndex((a) => String(a.id ?? "") === job.id.trim());
      if (idx >= 0) assets[idx] = mergedAsset;

      assetsEncodedAndVerified += 1;
      await emitAsyncPipelinePhase(
        postRef,
        {
          status: "processing",
          phase: "asset_encoded_verified",
          encodeAssetId: job.id
        },
        {
          phase: "asset_encoded_verified",
          processedVideos: assetsEncodedAndVerified,
          totalVideos: payload.videoAssets.length,
          lastCompletedAssetId: job.id
        }
      ).catch(() => {});
    }

    if (generateErrors.length > 0) {
      throw new Error(`video_job_errors:${generateErrors.join(";")}`);
    }

    const firstVideo = assets.find((a) => String(a.type ?? "").toLowerCase() === "video");
    const v0 = asRecord(firstVideo?.variants);
    const startup720 = trimStr(v0?.startup720FaststartAvc);
    const startup540 = trimStr(v0?.startup540FaststartAvc);
    if (!startup720 || !startup540) {
      throw new Error("native_video_fastpath_missing_startup_variants");
    }

    const posterHigh =
      trimStr(v0?.posterHigh) ||
      trimStr(firstVideo?.poster) ||
      trimStr(v0?.poster) ||
      trimStr(post.displayPhotoLink);
    const preview360Avc = trimStr(v0?.preview360Avc);
    const main720Avc = trimStr(v0?.main720Avc);

    const verification = playbackLabVerificationFromUrls([...new Set(allTrustUrls)]);

    const prevLc = asRecord(post.lifecycle) ?? {};
    const workingPost: Record<string, unknown> = {
      ...post,
      assets,
      assetsReady: true,
      videoProcessingStatus: "completed",
      instantPlaybackReady: true,
      mediaStatus: "ready",
      lifecycle: {
        ...prevLc,
        status: "active"
      },
      posterReady: Boolean(posterHigh),
      posterPresent: Boolean(posterHigh),
      ...(posterHigh ? { posterUrl: posterHigh } : {}),
      playbackReady: true,
      playbackUrlPresent: true,
      photoLink: posterHigh || post.photoLink,
      displayPhotoLink: posterHigh || post.displayPhotoLink,
      thumbUrl: posterHigh || post.thumbUrl,
      photoLinks2: startup720,
      photoLinks3: startup720,
      legacy: {
        ...(asRecord(post.legacy) ?? {}),
        photoLink: posterHigh || (asRecord(post.legacy)?.photoLink ?? post.photoLink),
        displayPhotoLink: posterHigh || (asRecord(post.legacy)?.displayPhotoLink ?? post.displayPhotoLink),
        thumbUrl: posterHigh || (asRecord(post.legacy)?.thumbUrl ?? post.thumbUrl),
        posterUrl: posterHigh || (asRecord(post.legacy)?.posterUrl ?? post.posterUrl),
        photoLinks2: startup720,
        photoLinks3: startup720,
        fallbackVideoUrl: trimStr(firstVideo?.original) || trimStr(post.fallbackVideoUrl)
      },
      fallbackVideoUrl: trimStr(firstVideo?.original) || trimStr(post.fallbackVideoUrl),
      playbackLabUpdatedAt: nowTs,
      playbackLabStatus: "ready",
      playbackLab: {
        ...(asRecord(post.playbackLab) ?? {}),
        status: "ready",
        version: 1,
        generatedAt: nowTs,
        lastVerifyAllOk: true,
        assets: slimLabAssets,
        verification,
        asyncPipeline: {
          status: "ready",
          source: "native_v2_finalize",
          lastGenerateSuccess: true,
          lastVerifyAllOk: true,
          lastException: null,
          lastGenerateErrors: []
        }
      },
      updatedAtMs: nowMs,
      lastUpdated: nowTs,
      updatedAt: nowTs
    };

    const readiness = buildPostMediaReadiness({
      ...workingPost,
      assetsReady: true,
      videoProcessingStatus: "completed",
      instantPlaybackReady: true
    });
    workingPost.playbackReady = readiness.playbackReady;
    workingPost.playbackUrlPresent = readiness.playbackUrlPresent;
    if (readiness.playbackUrl) workingPost.playbackUrl = readiness.playbackUrl;
    if (readiness.fallbackVideoUrl) workingPost.fallbackVideoUrl = readiness.fallbackVideoUrl;

    for (const k of Object.keys(workingPost)) {
      if (workingPost[k] === undefined) delete workingPost[k];
    }

    const w = num(firstVideo?.width);
    const h = num(firstVideo?.height);
    const durationSec = num(firstVideo?.durationSec);
    const sizeBytes = firstVideo?.sizeBytes != null ? num(firstVideo.sizeBytes) : null;
    const meta = asRecord(firstVideo?.variantMetadata);
    const brFromMeta = meta ? num((meta as { aggregateBitrateKbps?: unknown }).aggregateBitrateKbps) : 0;
    let sourceBitrateKbps: number | null = brFromMeta > 0 ? brFromMeta : null;
    if (sourceBitrateKbps == null && sizeBytes != null && durationSec > 0.05) {
      sourceBitrateKbps = (sizeBytes * 8) / durationSec / 1000;
    }
    const elig = evaluateDeferred1080UpgradeEligibility({
      width: w,
      height: h,
      durationSec,
      sizeBytes,
      sourceBitrateKbps
    });
    const upgradeExisting = trimStr(v0?.upgrade1080FaststartAvc);
    let extraLiveTopLevel: Record<string, unknown> | undefined;
    if (!upgradeExisting) {
      if (!elig.eligible) {
        extraLiveTopLevel = {
          deferred1080Upgrade: {
            phase: "skipped",
            uiStatus: "1080_upgrade_skipped_source_too_low",
            skippedReason: elig.skippedReason ?? "source_below_1080_quality",
            checkedAt: new Date().toISOString()
          }
        };
      } else {
        const enq = await enqueueDeferred1080UpgradeCloudTask({
          postId: payload.postId,
          userId: payload.userId,
          videoAssets: payload.videoAssets.map((a) => ({ id: a.id, original: a.original.trim() }))
        });
        extraLiveTopLevel = {
          deferred1080Upgrade: enq.ok
            ? {
                phase: "pending",
                uiStatus: "1080_upgrade_pending",
                enqueuedAt: new Date().toISOString(),
                taskName: enq.taskName
              }
            : {
                phase: "pending",
                uiStatus: "1080_upgrade_pending",
                enqueueWarning: enq.reason,
                enqueuedAt: new Date().toISOString()
              }
        };
      }
    }

    /**
     * Surface HDR / color / poster-source diagnostics for ops + audit tooling. Only present when
     * we actually re-encoded in this run; existing-variants-only runs don't have hdr data.
     * The audit script uses `sourceHdrDetected` + `posterToneMappingApplied` to flag the
     * `possible_hdr_poster_mismatch` classification.
     */
    const hdrDiagnostics: Record<string, unknown> = firstEncodedHdrInfo
      ? {
          sourceHdrDetected: firstEncodedHdrInfo.isHdr,
          sourceWideGamutOrHdrDetected: firstEncodedHdrInfo.isWideGamutOrHdr,
          sourceColorPrimaries: firstEncodedHdrInfo.colorPrimaries,
          sourceColorTransfer: firstEncodedHdrInfo.colorTransfer,
          sourceColorSpace: firstEncodedHdrInfo.colorSpace,
          sourcePixFmt: firstEncodedHdrInfo.pixFmt,
          sourceDolbyVisionSideData: firstEncodedHdrInfo.dolbyVisionSideData,
          outputFilterMode: firstEncodedHdrInfo.filterMode,
          posterToneMappingApplied: firstEncodedHdrInfo.posterToneMappingApplied,
          posterColorNormalizationApplied: firstEncodedHdrInfo.filterMode !== "sdr",
        }
      : {};

    const writeResult = await writeCompactLivePostAfterNativeVideoProcessing({
      db,
      postRef,
      postId: payload.postId,
      snapshotRaw,
      workingPost,
      playbackLabDiagnosticsAssets: playbackLabAssetsFull,
      diagnosticsExtra: {
        variantPlan: variantPlan.requiredForReady,
        includePreview360,
        includeMain720,
        encodedNewOutputs: assetsEncodedAndVerified,
        ...hdrDiagnostics,
      },
      ...(extraLiveTopLevel ? { extraLiveTopLevel } : {})
    });
    if (!writeResult.ok) {
      throw new Error(writeResult.error);
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const refreshed = await postRef.get();
    const latest = (refreshed.data() ?? {}) as Record<string, unknown>;
    const playbackReadinessFromDoc = buildPostMediaReadiness({
      ...latest,
      videoProcessingStatus: "failed",
      assetsReady: false,
      instantPlaybackReady: false
    });

    await postRef.set(
      {
        playbackLabUpdatedAt: nowTs,
        playbackLabStatus: "failed",
        playbackLab: {
          ...(asRecord(latest.playbackLab) ?? asRecord(post.playbackLab) ?? {}),
          status: "failed",
          lastVerifyAllOk: false,
          lastError: msg.slice(0, 1500),
          lastGenerateErrors: [msg.slice(0, 500)],
          assets: playbackLabAssetsFull,
          asyncPipeline: {
            ...(asRecord(asRecord(latest.playbackLab)?.asyncPipeline) ?? {}),
            status: "failed",
            source: "native_v2_finalize",
            lastGenerateSuccess: false,
            lastVerifyAllOk: false,
            lastException: msg.slice(0, 1500),
            lastGenerateErrors: generateErrors.length > 0 ? generateErrors : [msg.slice(0, 500)],
            phase: "failed"
          }
        },
        videoProcessingStatus: "failed",
        videoProcessingFailureReason: msg.slice(0, 500),
        mediaStatus: playbackReadinessFromDoc.mediaStatus,
        assetsReady: false,
        playbackReady: playbackReadinessFromDoc.playbackReady,
        playbackUrlPresent: playbackReadinessFromDoc.playbackUrlPresent,
        ...(playbackReadinessFromDoc.playbackUrl ? { playbackUrl: playbackReadinessFromDoc.playbackUrl } : {}),
        ...(playbackReadinessFromDoc.fallbackVideoUrl
          ? { fallbackVideoUrl: playbackReadinessFromDoc.fallbackVideoUrl }
          : {}),
        posterReady: playbackReadinessFromDoc.posterReady,
        posterPresent: playbackReadinessFromDoc.posterPresent,
        ...(playbackReadinessFromDoc.posterUrl ? { posterUrl: playbackReadinessFromDoc.posterUrl } : {}),
        instantPlaybackReady: false,
        updatedAtMs: nowMs,
        lastUpdated: nowTs,
        updatedAt: nowTs
      },
      { merge: true }
    );
    return { ok: false, error: msg };
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
