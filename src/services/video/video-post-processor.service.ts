import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { readWasabiConfigFromEnv } from "../storage/wasabi-config.js";
import { buildPostMediaReadiness } from "../../lib/posts/media-readiness.js";
import { encodeAndUploadVideoAsset, type VideoAssetJob } from "./video-post-encoding.pipeline.js";
import { verifyRemoteMp4Faststart } from "./remote-url-verify.js";
import { shouldGenerate1080Ladder } from "./video-source-policy.js";

export type VideoProcessorPayload = {
  postId: string;
  userId: string;
  videoAssets: VideoAssetJob[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
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

  const workRoot = path.join(os.tmpdir(), `locava-v2-video-${payload.postId}-${randomUUID()}`);
  await fs.mkdir(workRoot, { recursive: true });

  const playbackLabAssets: Record<string, unknown> = {
    ...asRecord(asRecord(post.playbackLab)?.assets)
  };
  const generateErrors: string[] = [];

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

      const remoteChecks: Array<Record<string, unknown>> = [];
      const check = async (label: string, url: string) => {
        const r = await verifyRemoteMp4Faststart(url, original, { requireMoovBeforeMdat: true });
        remoteChecks.push({ label, ...r });
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
    await postRef.set(
      {
        playbackLabUpdatedAt: nowTs,
        playbackLabStatus: "failed",
        playbackLab: {
          ...(asRecord(post.playbackLab) ?? {}),
          status: "failed",
          lastVerifyAllOk: false,
          lastError: msg.slice(0, 1500),
          lastGenerateErrors: [msg.slice(0, 500)],
          assets: playbackLabAssets,
          asyncPipeline: {
            status: "failed",
            source: "native_v2_finalize",
            lastGenerateSuccess: false,
            lastVerifyAllOk: false,
            lastException: msg.slice(0, 1500),
            lastGenerateErrors: generateErrors.length > 0 ? generateErrors : [msg.slice(0, 500)]
          }
        },
        videoProcessingStatus: "failed",
        videoProcessingFailureReason: msg.slice(0, 500),
        mediaStatus: "processing",
        assetsReady: false,
        playbackReady: false,
        playbackUrlPresent: false,
        instantPlaybackReady: false,
        updatedAtMs: nowMs,
        lastUpdated: nowTs,
        updatedAt: nowTs
      },
      { merge: true },
    );
    return { ok: false, error: msg };
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
