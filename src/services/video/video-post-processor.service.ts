import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { readWasabiConfigFromEnv } from "../storage/wasabi-config.js";
import { buildPostMediaReadiness } from "../../lib/posts/media-readiness.js";
import {
  encodeAndUploadVideoAsset,
  LAB_ARTIFACT_KEYS,
  type VideoAssetJob,
} from "./video-post-encoding.pipeline.js";
import { verifyRemoteMp4Faststart } from "./remote-url-verify.js";
import { verifyS3ObjectMp4Faststart } from "./s3-mp4-verify.js";
import { shouldGenerate1080Ladder } from "./video-source-policy.js";

export type VideoProcessorPayload = {
  postId: string;
  userId: string;
  videoAssets: VideoAssetJob[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

async function emitAsyncPipelinePhase(
  postRef: DocumentReference,
  asyncExtras: Record<string, unknown>,
  progressExtras?: Record<string, unknown>,
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
  const assets = Array.isArray(post.assets) ? [...(post.assets as Record<string, unknown>[])] : [];
  const nowMs = Date.now();
  const nowTs = Timestamp.fromMillis(nowMs);

  const videoProc = String(post.videoProcessingStatus ?? "").toLowerCase();
  const prevLabSt = String(asRecord(post.playbackLab)?.status ?? "").toLowerCase();
  if (post.assetsReady === true && videoProc === "completed") {
    return { ok: true };
  }
  /** Cloud Tasks retries after a permanent verify failure were merging `processing` atop `lastError`. */
  if (videoProc === "failed" || prevLabSt === "failed") {
    return { ok: true };
  }

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
    { merge: true },
  );

  await emitAsyncPipelinePhase(
    postRef,
    { status: "processing", phase: "worker_started" },
    { phase: "encode", totalVideos: payload.videoAssets.length, processedVideos: 0 },
  ).catch(() => {});

  const workRoot = path.join(os.tmpdir(), `locava-v2-video-${payload.postId}-${randomUUID()}`);
  await fs.mkdir(workRoot, { recursive: true });

  const playbackLabAssets: Record<string, unknown> = {
    ...asRecord(asRecord(post.playbackLab)?.assets)
  };
  const generateErrors: string[] = [];
  let assetsEncodedAndVerified = 0;

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
      const workDir = path.join(workRoot, job.id.replace(/[^\w-]+/g, "_"));
      await fs.mkdir(workDir, { recursive: true });
      await emitAsyncPipelinePhase(
        postRef,
        { status: "processing", phase: "encode_transcode", encodeAssetId: job.id },
        { phase: "encode_transcode", currentAssetId: job.id },
      ).catch(() => {});
      const encoded = await encodeAndUploadVideoAsset({
        cfg,
        postId: payload.postId,
        asset: job,
        workDir,
        enableMain720Hevc: process.env.VIDEO_MAIN720_HEVC_ENABLED === "1"
      });

      const vPrev = asRecord(assetRow.variants) ?? {};
      const mergedVariants: Record<string, unknown> = {
        ...vPrev,
        ...encoded.variants,
        poster: String(vPrev.poster ?? poster ?? "")
      };
      if (!shouldGenerate1080Ladder(encoded.sourceWidth, encoded.sourceHeight)) {
        delete mergedVariants.main1080;
        delete mergedVariants.main1080Avc;
      }
      if (!mergedVariants.poster) delete mergedVariants.poster;

      await emitAsyncPipelinePhase(
        postRef,
        { status: "processing", phase: "verify_lab_outputs", encodeAssetId: job.id },
        { phase: "verify", currentAssetId: job.id },
      ).catch(() => {});

      const remoteChecks: Array<Record<string, unknown>> = [];
      const prefix = String(encoded.videosLabKeyPrefix ?? "").trim();
      const check = async (label: string, url: string) => {
        const u = String(url ?? "").trim();
        if (process.env.VIDEO_SKIP_REMOTE_UPLOAD_VERIFY === "1") {
          remoteChecks.push({
            label,
            verifyMode: "skipped_env",
            ok: true,
            skipped: true,
            reason: "VIDEO_SKIP_REMOTE_UPLOAD_VERIFY"
          } as Record<string, unknown>);
          return;
        }
        const suffix = labArtifactSuffixForVerifyLabel(label);
        const useS3Lab = Boolean(prefix && suffix);
        const variantHintForDedup =
          u || `https://videos-lab.internal/${encodeURIComponent(payload.postId)}/${suffix}`;
        let verifyMode: "s3_lab" | "remote" | "s3_lab_then_https" | "skipped_env" = useS3Lab ? "s3_lab" : "remote";
        const moovOpts = { requireMoovBeforeMdat: true as const };

        let r: Awaited<ReturnType<typeof verifyRemoteMp4Faststart>>;
        if (useS3Lab) {
          r = await verifyS3ObjectMp4Faststart(cfg, `${prefix}/${suffix}`, original, variantHintForDedup, moovOpts);
          /** Lab objects are reachable at public CDN URLs — anonymous Range GET succeeds where SigV4 ranged GetObject fails. */
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
          ...r,
        });
        if (!r.ok) throw new Error(`remote_verify_failed:${label}:${"reason" in r ? r.reason : "unknown"}`);
      };
      await check("preview360Avc", String(mergedVariants.preview360Avc ?? ""));
      await check("main720Avc", String(mergedVariants.main720Avc ?? ""));
      const main720Url = String(mergedVariants.main720 ?? "").trim();
      if (main720Url && main720Url !== String(mergedVariants.main720Avc ?? "").trim()) {
        await check("main720", main720Url);
      }
      await check("startup540", encoded.playbackLabGenerated.startup540FaststartAvc ?? "");
      await check("startup720", encoded.playbackLabGenerated.startup720FaststartAvc ?? "");
      if (encoded.playbackLabGenerated.startup1080FaststartAvc) {
        await check("startup1080", encoded.playbackLabGenerated.startup1080FaststartAvc);
        await check("upgrade1080", encoded.playbackLabGenerated.upgrade1080FaststartAvc ?? "");
      }

      const labNode = {
        generated: {
          ...encoded.playbackLabGenerated,
          diagnosticsJson: encoded.diagnosticsJson
        },
        generationMetadata: encoded.generationMetadata,
        lastVerifyResults: [...encoded.lastVerifyResults, ...remoteChecks],
        lastVerifyAllOk: true
      };
      playbackLabAssets[job.id] = labNode;

      const nextMeta = { ...(asRecord(assetRow.variantMetadata) ?? {}), ...encoded.variantMetadata };
      delete (nextMeta as { processing?: unknown }).processing;

      const mergedAsset = {
        ...assetRow,
        width: encoded.sourceWidth,
        height: encoded.sourceHeight,
        durationSec: encoded.durationSec,
        aspectRatio: encoded.sourceHeight > 0 ? encoded.sourceWidth / encoded.sourceHeight : assetRow.aspectRatio,
        variants: mergedVariants,
        variantMetadata: nextMeta,
        playbackLab: {
          ...(asRecord(assetRow.playbackLab) ?? {}),
          status: "ready",
          generated: labNode.generated,
          generationMetadata: labNode.generationMetadata
        },
        instantPlaybackReady: true
      };

      const idx = assets.findIndex((a) => String(a.id ?? "") === job.id.trim());
      if (idx >= 0) assets[idx] = mergedAsset;

      assetsEncodedAndVerified += 1;
      await emitAsyncPipelinePhase(
        postRef,
        {
          status: "processing",
          phase: "asset_encoded_verified",
          encodeAssetId: job.id,
        },
        {
          phase: "asset_encoded_verified",
          processedVideos: assetsEncodedAndVerified,
          totalVideos: payload.videoAssets.length,
          lastCompletedAssetId: job.id,
        },
      ).catch(() => {});
    }

    if (generateErrors.length > 0) {
      throw new Error(`video_job_errors:${generateErrors.join(";")}`);
    }

    const firstVideo = assets.find((a) => String(a.type ?? "").toLowerCase() === "video");
    const v0 = asRecord(firstVideo?.variants);
    const preview360Avc = String(v0?.preview360Avc ?? "").trim();
    const main720Avc = String(v0?.main720Avc ?? "").trim();
    const posterUrl =
      String(firstVideo?.poster ?? "").trim() || String(v0?.poster ?? "").trim() || undefined;
    const mergedPost: Record<string, unknown> = {
      ...post,
      assets,
      assetsReady: true,
      videoProcessingStatus: "completed",
      videoProcessingProgress: FieldValue.delete(),
      instantPlaybackReady: true,
      mediaStatus: "ready",
      posterReady: Boolean(posterUrl),
      posterPresent: Boolean(posterUrl),
      ...(posterUrl ? { posterUrl } : {}),
      playbackReady: true,
      playbackUrlPresent: true,
      photoLinks2: preview360Avc || posterUrl,
      photoLinks3: main720Avc || preview360Avc || posterUrl,
      legacy: {
        ...(asRecord(post.legacy) ?? {}),
        photoLink: posterUrl ?? post.photoLink,
        photoLinks2: preview360Avc,
        photoLinks3: main720Avc
      },
      playbackLabUpdatedAt: nowTs,
      playbackLabStatus: "ready",
      playbackLab: {
        ...(asRecord(post.playbackLab) ?? {}),
        status: "ready",
        version: 1,
        generatedAt: nowTs,
        lastVerifyAllOk: true,
        assets: playbackLabAssets,
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
      ...mergedPost,
      assetsReady: true,
      videoProcessingStatus: "completed",
      instantPlaybackReady: true
    });
    mergedPost.playbackReady = readiness.playbackReady;
    mergedPost.playbackUrlPresent = readiness.playbackUrlPresent;
    if (readiness.playbackUrl) mergedPost.playbackUrl = readiness.playbackUrl;
    if (readiness.fallbackVideoUrl) mergedPost.fallbackVideoUrl = readiness.fallbackVideoUrl;

    for (const k of Object.keys(mergedPost)) {
      if (mergedPost[k] === undefined) delete mergedPost[k];
    }

    await postRef.set(mergedPost, { merge: true });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const refreshed = await postRef.get();
    const latest = (refreshed.data() ?? {}) as Record<string, unknown>;
    const playbackReadinessFromDoc = buildPostMediaReadiness({
      ...latest,
      videoProcessingStatus: "failed",
      assetsReady: false,
      instantPlaybackReady: false,
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
          assets: playbackLabAssets,
          asyncPipeline: {
            ...(asRecord(asRecord(latest.playbackLab)?.asyncPipeline) ?? {}),
            status: "failed",
            source: "native_v2_finalize",
            lastGenerateSuccess: false,
            lastVerifyAllOk: false,
            lastException: msg.slice(0, 1500),
            lastGenerateErrors: generateErrors.length > 0 ? generateErrors : [msg.slice(0, 500)],
            phase: "failed",
          },
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
        updatedAt: nowTs,
      },
      { merge: true },
    );
    return { ok: false, error: msg };
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
