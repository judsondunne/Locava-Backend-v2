import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MasterPostV2 } from "../../contracts/master-post-v2.types.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";
import {
  compactCanonicalPostForLiveWrite,
  detectPlaybackLabGeneratedNotPromoted,
  isCompactCanonicalPostV2
} from "../../lib/posts/master-post-v2/compactCanonicalPostV2.js";
import { classifyPostRebuildFailure } from "../../lib/posts/master-post-v2/postRebuildFailureClassification.js";
import { evaluatePosterRepairNeed } from "../../lib/posts/master-post-v2/posterRepair.js";
import { mediaUrlSanityCheckOnSavedCompactPost } from "../../lib/posts/master-post-v2/savedCompactPostHealth.js";
import { buildStrictGenerationFailureDetail } from "../../lib/posts/master-post-v2/strictGenerationFailureDetail.js";
import { encodeFirestoreTimestampsInPostWrite } from "../../lib/posts/master-post-v2/encodeFirestoreTimestampsInPostWrite.js";
import { extractMediaProcessingDebugV2 } from "../../lib/posts/master-post-v2/extractMediaProcessingDebugV2.js";
import { hashPostForRebuild } from "../../lib/posts/master-post-v2/hashPostForRebuild.js";
import { diffMasterPostPreview } from "../../lib/posts/master-post-v2/diffMasterPostPreview.js";
import { auditPostEngagementSourcesV2 } from "../../lib/posts/master-post-v2/auditPostEngagementSourcesV2.js";
import {
  analyzeVideoFastStartNeeds,
  generateMissingFastStartVariantsForPost,
  mergePlaybackLabResultsIntoRawPost,
  rebuildPostAfterFastStartRepair,
  type VerifyOutput
} from "../../lib/posts/master-post-v2/videoFastStartRepair.js";
import { encodeAndUploadVideoAsset } from "../../services/video/video-post-encoding.pipeline.js";
import { downloadVideoSourceToFile } from "../../services/video/video-post-encoding.pipeline.js";
import {
  normalizeVideoLabPostFolder,
  repairVideosLabDoublePostPrefixUrlsDeep
} from "../../services/video/normalizeVideoLabPostFolder.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import { verifyRemoteImage, verifyRemoteMp4Faststart } from "../../services/video/remote-url-verify.js";
import { uploadFileToWasabiKey } from "../../services/video/wasabi-upload-file.js";
import { runFfmpeg } from "../../services/video/ffmpeg-runner.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";

/**
 * Upper bound for `/debug/post-rebuilder/posts` (rank-ordered load). Admin-only; keep finite so
 * accidental "count=999999999" does not OOM the worker. Paste-IDs / append loads are not capped here.
 */
const POST_REBUILDER_RANK_QUERY_LIMIT_MAX = 50_000;
const POST_REBUILDER_RANK_QUERY_OFFSET_MAX = 200_000;

const ParamsSchema = z.object({ postId: z.string().min(1) });
const WriteSchema = z.object({
  expectedHash: z.string().min(8),
  mode: z.literal("additiveCanonicalFieldsOnly"),
  force: z.boolean().optional().default(false)
});
const RevertSchema = z.object({ backupId: z.string().min(1) });
const PreviewQuerySchema = z.object({
  dryRunMode: z.enum(["default", "singleVideoCheck"]).optional().default("default")
});
const LoadNewestPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(POST_REBUILDER_RANK_QUERY_LIMIT_MAX).optional().default(12),
  /** Number of docs to skip after ordering (0 = start at newest). */
  offset: z.coerce.number().int().min(0).max(POST_REBUILDER_RANK_QUERY_OFFSET_MAX).optional().default(0)
});
const OptimizeAndWriteQuerySchema = z.object({
  /** When "1", response is NDJSON stream: progress lines then a final done/error line. */
  stream: z.enum(["1"]).optional()
});
const GenerateFastStartBodySchema = z.object({
  dryRun: z.boolean().optional().default(false)
});
const OptimizeAndWriteBodySchema = z.object({
  strict: z.boolean().optional().default(true)
});

type UnknownRecord = Record<string, unknown>;

function selectedVideoUrlsFromCanonical(canonical: any) {
  const assets = Array.isArray(canonical?.media?.assets) ? canonical.media.assets : [];
  return assets
    .filter((asset: any) => asset?.type === "video")
    .map((asset: any) => ({
      assetId: asset?.id ?? null,
      defaultUrl: asset?.video?.playback?.defaultUrl ?? null,
      startupUrl: asset?.video?.playback?.startupUrl ?? null,
      primaryUrl: asset?.video?.playback?.primaryUrl ?? null,
      goodNetworkUrl: asset?.video?.playback?.goodNetworkUrl ?? null,
      weakNetworkUrl: asset?.video?.playback?.weakNetworkUrl ?? null,
      poorNetworkUrl: asset?.video?.playback?.poorNetworkUrl ?? null,
      previewUrl: asset?.video?.playback?.previewUrl ?? null,
      fallbackUrl: asset?.video?.playback?.fallbackUrl ?? null,
      selectedReason: asset?.video?.playback?.selectedReason ?? null,
      instantPlaybackReady: asset?.video?.readiness?.instantPlaybackReady ?? null,
      faststartVerified: asset?.video?.readiness?.faststartVerified ?? null
    }));
}

/** Same playback summary as canonical, but read from a Firestore-shaped doc (e.g. compact `livePost` after read). */
function selectedVideoUrlsFromPostDocument(post: UnknownRecord) {
  return selectedVideoUrlsFromCanonical({ media: post.media } as MasterPostV2);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function buildOptimizeFailureClassification(input: {
  compactPre: ReturnType<typeof isCompactCanonicalPostV2>;
  status: string;
  lastStep?: string;
  repairedRaw: UnknownRecord;
  canonical: MasterPostV2 | null;
  validation: { blockingErrors?: Array<{ code?: string; message?: string; path?: string }> } | null;
  generationFailureDetail?: Record<string, unknown> | null;
  analyzeAfterRepair: ReturnType<typeof analyzeVideoFastStartNeeds> | null;
}) {
  const classified = classifyPostRebuildFailure({
    rawPost: input.repairedRaw as Record<string, unknown>,
    normalizedPost: input.canonical ? (input.canonical as unknown as Record<string, unknown>) : undefined,
    validation: input.validation,
    compactCheck: input.compactPre as unknown as Record<string, unknown>,
    context: {
      status: input.status,
      lastStep: input.lastStep,
      generationFailureDetail: input.generationFailureDetail ?? null,
      analyze: input.analyzeAfterRepair
        ? {
            missingSourceCount: input.analyzeAfterRepair.missingSourceCount,
            needsGenerationCount: input.analyzeAfterRepair.needsGenerationCount
          }
        : null
    }
  });
  return {
    ...classified,
    lastStep: input.lastStep ?? null,
    optimizeStatus: input.status
  };
}

function estimateJsonUtf8Bytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function getNestedRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function getNestedString(root: UnknownRecord | null, ...path: string[]): string | null {
  let cursor: unknown = root;
  for (const segment of path) {
    const record = getNestedRecord(cursor);
    if (!record) return null;
    cursor = record[segment];
  }
  return typeof cursor === "string" && cursor.trim().length > 0 ? cursor.trim() : null;
}

function coerceIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "object") {
    const timestampLike = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };
    if (typeof timestampLike.toDate === "function") return timestampLike.toDate().toISOString();
    const seconds =
      typeof timestampLike.seconds === "number"
        ? timestampLike.seconds
        : typeof timestampLike._seconds === "number"
          ? timestampLike._seconds
          : null;
    if (seconds !== null) return new Date(seconds * 1000).toISOString();
  }
  return null;
}

/** Human-readable post time for queue UI (never mix dateStyle + timeZoneName in one Intl call). */
function formatPostTimeDisplayLabel(isoOrNull: string | null): string | null {
  if (!isoOrNull) return null;
  const ms = Date.parse(isoOrNull);
  if (!Number.isFinite(ms)) return isoOrNull;
  try {
    return new Date(ms).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    });
  } catch {
    return isoOrNull;
  }
}

function summarizeQueueCandidate(postId: string, raw: UnknownRecord) {
  const text = getNestedRecord(raw.text);
  const classification = getNestedRecord(raw.classification);
  const location = getNestedRecord(raw.location);
  const display = getNestedRecord(location?.display);
  const author = getNestedRecord(raw.author);
  const rawSchema = getNestedRecord(raw.schema);
  const lifecycle = getNestedRecord(raw.lifecycle);
  const timeIso = coerceIsoDate(raw.time ?? lifecycle?.createdAt ?? raw.createdAt);
  return {
    postId,
    time: timeIso,
    timeDisplay: formatPostTimeDisplayLabel(timeIso),
    userId: firstNonEmptyString(raw.userId, author?.userId, raw.uid),
    title: firstNonEmptyString(
      text?.title,
      raw.title,
      raw.caption,
      raw.description,
      raw.postTitle
    ),
    mediaKind: firstNonEmptyString(
      classification?.mediaKind,
      raw.mediaType,
      raw.postType,
      raw.type
    ),
    locationName: firstNonEmptyString(
      display?.name,
      location?.locationTitle,
      location?.name,
      raw.address,
      raw.locationLabel
    ),
    schemaVersion: firstNonEmptyString(rawSchema?.version, rawSchema?.name),
    hasCanonicalSchema: Boolean(rawSchema?.version || rawSchema?.name)
  };
}

async function defaultVerifyGeneratedVideoUrl(input: {
  label: string;
  url: string;
  originalUrl: string | null;
}): Promise<VerifyOutput> {
  const isPoster = input.label === "posterHigh" || input.label === "poster";
  if (isPoster) {
    const img = await verifyRemoteImage(input.url);
    return {
      label: input.label,
      url: input.url,
      ok: img.ok,
      moovHint: img.ok ? img.moovHint : undefined,
      probe: img.ok
        ? {
            head: { ok: true, status: 200, contentType: img.contentType, acceptRanges: "" },
            moovHint: img.moovHint
          }
        : undefined
    };
  }
  const headRes = await fetch(input.url, { method: "HEAD" }).catch(() => null);
  const contentType = (String(headRes?.headers.get("content-type") ?? "")
    .split(";")
    .at(0) ?? "")
    .trim()
    .toLowerCase();
  const acceptRanges = String(headRes?.headers.get("accept-ranges") ?? "").trim().toLowerCase();
  const verify = await verifyRemoteMp4Faststart(input.url, input.originalUrl ?? "", { requireMoovBeforeMdat: true });
  return {
    label: input.label,
    url: input.url,
    ok: verify.ok,
    moovHint: verify.ok ? verify.moovHint : undefined,
    probe: {
      head: {
        ok: Boolean(headRes?.ok),
        status: headRes?.status ?? 0,
        contentType,
        acceptRanges
      },
      moovHint: verify.ok ? verify.moovHint : undefined
    }
  };
}

async function defaultGenerateMissingForAsset(input: {
  postId: string;
  asset: UnknownRecord;
  needs: {
    posterHigh: boolean;
    preview360Avc: boolean;
    main720Avc: boolean;
    startup540FaststartAvc: boolean;
    startup720FaststartAvc: boolean;
    startup1080FaststartAvc: boolean;
    upgrade1080FaststartAvc: boolean;
  };
  onEncoderProgress?: (evt: { phase: string; detail?: string }) => void;
}) {
  const cfg = readWasabiConfigFromEnv();
  if (!cfg) throw new Error("wasabi_unavailable");
  const assetId = firstNonEmptyString(input.asset.id) ?? `video_${Date.now()}`;
  const video = getNestedRecord(input.asset.video);
  const playback = getNestedRecord(video?.playback);
  const original = firstNonEmptyString(
    input.asset.original,
    input.asset.url,
    video?.originalUrl,
    playback?.defaultUrl,
    playback?.primaryUrl
  );
  if (!original) throw new Error("source_missing");
  const workDir = path.join(os.tmpdir(), `rebuilder-faststart-${input.postId}-${assetId}-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    /** Rebuilder fast path: never request 1080 ladder encodes here (540/720 + optional poster/preview/main720 only). */
    const encodeOnly: Partial<{
      posterHigh: boolean;
      preview360Avc: boolean;
      main720Avc: boolean;
      startup540FaststartAvc: boolean;
      startup720FaststartAvc: boolean;
    }> = {};
    if (input.needs.posterHigh) encodeOnly.posterHigh = true;
    if (input.needs.preview360Avc) encodeOnly.preview360Avc = true;
    if (input.needs.main720Avc) encodeOnly.main720Avc = true;
    if (input.needs.startup540FaststartAvc) encodeOnly.startup540FaststartAvc = true;
    if (input.needs.startup720FaststartAvc) encodeOnly.startup720FaststartAvc = true;
    const encoded = await encodeAndUploadVideoAsset({
      cfg,
      postId: normalizeVideoLabPostFolder(input.postId),
      asset: { id: assetId, original },
      workDir,
      encodeOnly,
      onProgress: input.onEncoderProgress
    });
    const generated: Record<string, string> = {};
    if (input.needs.posterHigh && encoded.playbackLabGenerated.posterHigh) generated.posterHigh = encoded.playbackLabGenerated.posterHigh;
    if (input.needs.preview360Avc && encoded.variants.preview360Avc) generated.preview360Avc = encoded.variants.preview360Avc;
    if (input.needs.main720Avc && encoded.variants.main720Avc) generated.main720Avc = encoded.variants.main720Avc;
    if (input.needs.startup540FaststartAvc && encoded.playbackLabGenerated.startup540FaststartAvc) {
      generated.startup540FaststartAvc = encoded.playbackLabGenerated.startup540FaststartAvc;
    }
    if (input.needs.startup720FaststartAvc && encoded.playbackLabGenerated.startup720FaststartAvc) {
      generated.startup720FaststartAvc = encoded.playbackLabGenerated.startup720FaststartAvc;
    }
    return {
      generated,
      generationMetadata: encoded.generationMetadata,
      diagnosticsJson: encoded.diagnosticsJson,
      sourceWidth: encoded.sourceWidth,
      sourceHeight: encoded.sourceHeight
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function pickVideoPosterAsset(raw: UnknownRecord): UnknownRecord | null {
  const media = getNestedRecord(raw.media);
  const assets = Array.isArray(media?.assets) ? (media.assets as unknown[]) : [];
  for (const row of assets) {
    const ar = getNestedRecord(row);
    if (!ar || ar.type !== "video") continue;
    return ar;
  }
  const legacy = Array.isArray(raw.assets) ? (raw.assets as unknown[]) : [];
  for (const row of legacy) {
    const ar = getNestedRecord(row);
    if (!ar || ar.type !== "video") continue;
    return ar;
  }
  return null;
}

function collectPosterAndVideoCandidates(raw: UnknownRecord, preferredAssetId: string | null): {
  posterUrls: string[];
  videoUrls: string[];
} {
  const urlsPoster: string[] = [];
  const urlsVideo: string[] = [];
  const push = (out: string[], value: unknown) => {
    if (typeof value !== "string") return;
    const t = value.trim();
    if (!/^https?:\/\//i.test(t)) return;
    out.push(t);
  };
  const media = getNestedRecord(raw.media);
  const cover = getNestedRecord(media?.cover);
  const compatibility = getNestedRecord(raw.compatibility);
  push(urlsPoster, cover?.posterUrl);
  push(urlsPoster, cover?.url);
  push(urlsPoster, cover?.thumbUrl);
  push(urlsPoster, compatibility?.posterUrl);
  push(urlsPoster, compatibility?.photoLink);
  push(urlsPoster, compatibility?.displayPhotoLink);
  push(urlsPoster, compatibility?.thumbUrl);
  push(urlsPoster, raw.posterUrl);
  push(urlsPoster, raw.photoLink);
  push(urlsPoster, raw.displayPhotoLink);
  push(urlsPoster, raw.thumbUrl);
  const assets: UnknownRecord[] = [];
  if (Array.isArray(media?.assets)) {
    for (const v of media.assets as unknown[]) {
      const r = getNestedRecord(v);
      if (r) assets.push(r);
    }
  }
  if (Array.isArray(raw.assets)) {
    for (const v of raw.assets as unknown[]) {
      const r = getNestedRecord(v);
      if (r) assets.push(r);
    }
  }
  const sorted = assets.sort((a, b) => {
    if (preferredAssetId && String(a.id ?? "") === preferredAssetId) return -1;
    if (preferredAssetId && String(b.id ?? "") === preferredAssetId) return 1;
    return 0;
  });
  for (const ar of sorted) {
    if (ar.type !== "video") continue;
    const vv = getNestedRecord(ar.video);
    const pb = getNestedRecord(vv?.playback);
    const variants = getNestedRecord(vv?.variants);
    push(urlsPoster, pb?.posterUrl);
    push(urlsPoster, variants?.poster);
    push(urlsPoster, vv?.posterUrl);
    push(urlsVideo, pb?.startupUrl);
    push(urlsVideo, pb?.defaultUrl);
    push(urlsVideo, pb?.primaryUrl);
    push(urlsVideo, variants?.startup720FaststartAvc);
    push(urlsVideo, variants?.startup540FaststartAvc);
    push(urlsVideo, pb?.fallbackUrl);
    push(urlsVideo, vv?.originalUrl);
  }
  push(urlsVideo, compatibility?.fallbackVideoUrl);
  push(urlsVideo, raw.fallbackVideoUrl);
  push(urlsVideo, raw.photoLinks2);
  push(urlsVideo, raw.photoLinks3);
  return { posterUrls: [...new Set(urlsPoster)], videoUrls: [...new Set(urlsVideo)] };
}

function applyDurablePosterToRawPost(raw: UnknownRecord, assetId: string, posterUrl: string): UnknownRecord {
  const next: UnknownRecord = JSON.parse(JSON.stringify(raw));
  const setRec = (base: UnknownRecord, key: string) => {
    const cur = getNestedRecord(base[key]);
    if (cur) return cur;
    const created: UnknownRecord = {};
    base[key] = created;
    return created;
  };
  const media = setRec(next, "media");
  const cover = setRec(media, "cover");
  cover.url = posterUrl;
  cover.posterUrl = posterUrl;
  cover.thumbUrl = posterUrl;
  const compatibility = setRec(next, "compatibility");
  compatibility.photoLink = posterUrl;
  compatibility.displayPhotoLink = posterUrl;
  compatibility.thumbUrl = posterUrl;
  compatibility.posterUrl = posterUrl;
  next.photoLink = posterUrl;
  next.displayPhotoLink = posterUrl;
  next.thumbUrl = posterUrl;
  next.posterUrl = posterUrl;
  const patchAsset = (list: unknown[]) => {
    for (const row of list) {
      const ar = getNestedRecord(row);
      if (!ar || String(ar.id ?? "") !== assetId || ar.type !== "video") continue;
      const v = setRec(ar, "video");
      const pb = setRec(v, "playback");
      const variants = setRec(v, "variants");
      pb.posterUrl = posterUrl;
      variants.poster = posterUrl;
      v.posterUrl = posterUrl;
      ar.posterHigh = posterUrl;
    }
  };
  if (Array.isArray(media.assets)) patchAsset(media.assets as unknown[]);
  if (Array.isArray(next.assets)) patchAsset(next.assets as unknown[]);
  return next;
}

async function repairPosterForRawPost(input: {
  postId: string;
  raw: UnknownRecord;
  onProgress?: (evt: OptimizeProgress) => void;
}): Promise<{
  repairedRaw: UnknownRecord;
  posterRepairApplied: boolean;
  posterRepairReason: string;
  posterRepairSource: string | null;
  posterRepairUrl: string | null;
  diagnostics: Record<string, unknown>;
  failure?: {
    failureClass: string;
    message: string;
  };
}> {
  const { postId, raw, onProgress } = input;
  const evaluation = evaluatePosterRepairNeed(raw, {
    configuredPublicBases: [
      process.env.LOCAVA_PUBLIC_ASSET_BASE ?? "",
      process.env.WASABI_ENDPOINT ?? "",
      process.env.NEXT_PUBLIC_WASABI_ENDPOINT ?? ""
    ].filter(Boolean)
  });
  if (!evaluation.needsPosterRepair) {
    return {
      repairedRaw: raw,
      posterRepairApplied: false,
      posterRepairReason: evaluation.reason,
      posterRepairSource: null,
      posterRepairUrl: evaluation.durablePosterUrl ?? null,
      diagnostics: { evaluation }
    };
  }
  const cfg = readWasabiConfigFromEnv();
  if (!cfg) {
    return {
      repairedRaw: raw,
      posterRepairApplied: false,
      posterRepairReason: "poster_unreachable",
      posterRepairSource: null,
      posterRepairUrl: null,
      diagnostics: { evaluation, error: "wasabi_unavailable" }
    };
  }
  const asset = pickVideoPosterAsset(raw);
  const assetId = firstNonEmptyString(asset?.id) ?? "video_0";
  const candidates = collectPosterAndVideoCandidates(raw, assetId);
  const workDir = path.join(os.tmpdir(), `rebuilder-poster-${postId}-${assetId}-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  const folder = normalizeVideoLabPostFolder(postId);
  const key = `videos-lab/${folder}/${assetId}/poster_high.jpg`;
  try {
    for (const posterUrl of candidates.posterUrls) {
      const v = await verifyRemoteImage(posterUrl).catch(() => ({ ok: false, reason: "probe_failed" }));
      if (!v.ok) continue;
      onProgress?.({ stage: "poster_ingest", detail: posterUrl, assetId });
      const imgRes = await fetch(posterUrl).catch(() => null);
      if (!imgRes?.ok || !imgRes.body) continue;
      const posterLocal = path.join(workDir, "poster_ingested.jpg");
      const arr = Buffer.from(await imgRes.arrayBuffer());
      await fs.writeFile(posterLocal, arr);
      const up = await uploadFileToWasabiKey({ cfg, localPath: posterLocal, key, contentType: "image/jpeg" });
      return {
        repairedRaw: applyDurablePosterToRawPost(raw, assetId, up.publicUrl),
        posterRepairApplied: true,
        posterRepairReason: evaluation.reason,
        posterRepairSource: "ingested_external_poster",
        posterRepairUrl: up.publicUrl,
        diagnostics: { evaluation, candidatePosterUrl: posterUrl, uploadedKey: key }
      };
    }
    for (const videoUrl of candidates.videoUrls) {
      if (!/^https?:\/\//i.test(videoUrl) || /\.(jpe?g|png|webp)(\?|$)/i.test(videoUrl)) continue;
      const verifyVideo = await verifyRemoteMp4Faststart(videoUrl, "", { requireMoovBeforeMdat: false }).catch(() => null);
      if (!verifyVideo?.ok) continue;
      onProgress?.({ stage: "poster_derive_from_video", detail: videoUrl, assetId });
      const source = path.join(workDir, "source.mp4");
      const posterLocal = path.join(workDir, "poster_derived.jpg");
      await downloadVideoSourceToFile(videoUrl, source);
      await runFfmpeg([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        "0.25",
        "-i",
        source,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        posterLocal
      ]);
      const up = await uploadFileToWasabiKey({ cfg, localPath: posterLocal, key, contentType: "image/jpeg" });
      return {
        repairedRaw: applyDurablePosterToRawPost(raw, assetId, up.publicUrl),
        posterRepairApplied: true,
        posterRepairReason: evaluation.reason,
        posterRepairSource: "derived_first_frame_from_video",
        posterRepairUrl: up.publicUrl,
        diagnostics: { evaluation, videoSourceUrl: videoUrl, uploadedKey: key }
      };
    }
    return {
      repairedRaw: raw,
      posterRepairApplied: false,
      posterRepairReason: "poster_unreachable",
      posterRepairSource: null,
      posterRepairUrl: null,
      diagnostics: { evaluation, candidates },
      failure: {
        failureClass: "poster_and_video_source_unreachable",
        message: "poster_and_video_source_unreachable"
      }
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

type OptimizeProgress = {
  stage: string;
  detail?: string;
  assetId?: string;
  index?: number;
  total?: number;
};

async function persistCompactCanonicalPost(input: {
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>;
  postId: string;
  rawBefore: UnknownRecord;
  repairedRaw: UnknownRecord;
  canonical: MasterPostV2;
  engagementSourceAudit: Awaited<ReturnType<typeof auditPostEngagementSourcesV2>>;
  actorRoute: string;
}): Promise<{
  backupId: string;
  backupPath: string;
  byteEstimateBefore: number;
  byteEstimateAfter: number;
  removedPaths: string[];
}> {
  const { db, postId, rawBefore, repairedRaw, canonical, engagementSourceAudit, actorRoute } = input;
  const ts = Date.now();
  const backupId = `${postId}_${ts}`;
  const backupPath = `postCanonicalBackups/${backupId}`;
  const compact = compactCanonicalPostForLiveWrite({ canonical, rawBefore, postId });
  await db.collection("postCanonicalBackups").doc(backupId).set({
    postId,
    createdAt: new Date().toISOString(),
    rawBefore,
    rawHash: hashPostForRebuild(rawBefore),
    optimizedRaw: repairedRaw,
    canonicalPreview: canonical,
    compactLivePost: compact.livePost,
    compactionDiagnostics: JSON.parse(JSON.stringify(compact.diagnostics)),
    engagementSourceAudit,
    actor: { route: actorRoute }
  });
  await db.collection("postCanonicalDiagnostics").doc(backupId).set(
    JSON.parse(
      JSON.stringify({
        postId,
        createdAt: new Date().toISOString(),
        backupPath,
        diagnosticsDoc: `postCanonicalDiagnostics/${backupId}`,
        ...compact.diagnostics
      })
    )
  );
  const liveForFirestore = encodeFirestoreTimestampsInPostWrite(compact.livePost as Record<string, unknown>);
  await db.collection("posts").doc(postId).set(liveForFirestore, { merge: false });
  return {
    backupId,
    backupPath,
    byteEstimateBefore: compact.byteEstimateBefore,
    byteEstimateAfter: compact.byteEstimateAfter,
    removedPaths: compact.removedPaths
  };
}

async function optimizeAndWritePost(input: {
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>;
  postId: string;
  strict: boolean;
  onProgress?: (evt: OptimizeProgress) => void;
}) {
  const { db, postId, strict, onProgress } = input;
  const stages: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const postRef = db.collection("posts").doc(postId);

  const emit = (stage: string, detail?: string, extra?: Partial<OptimizeProgress>) => {
    onProgress?.({ stage, detail, ...extra });
  };

  stages.push("loading_latest_raw");
  emit("loading_latest_raw", "firestore_get_post");
  const snap = await postRef.get();
  if (!snap.exists) return { status: "post_not_found", stages, warnings, errors: ["post_not_found"] };
  /** Immutable Firestore snapshot for backups / audit (`raw` may be replaced after legacy URL repair). */
  const snapshotRaw = (snap.data() ?? {}) as UnknownRecord;
  let raw = snapshotRaw;

  const compactPre = isCompactCanonicalPostV2(raw as Record<string, unknown>);
  emit(
    "compact_precheck",
    JSON.stringify({
      ok: compactPre.canSkipWrite,
      compactOk: compactPre.compactOk,
      canSkipWrite: compactPre.canSkipWrite,
      mediaNeedsRepair: compactPre.mediaNeedsRepair,
      videoNeedsFaststart: compactPre.videoNeedsFaststart,
      posterNeedsRepair: compactPre.posterNeedsRepair === true,
      posterRepairReason: compactPre.posterRepairReason ?? null,
      videoIssueCount:
        typeof compactPre.videoIssueCount === "number"
          ? compactPre.videoIssueCount
          : Array.isArray(compactPre.videoIssues)
            ? compactPre.videoIssues.length
            : 0
    })
  );
  if (compactPre.canSkipWrite) {
    stages.push("already_compact_canonical");
    const bytes = estimateJsonUtf8Bytes(raw);
    const savedMediaSanity = mediaUrlSanityCheckOnSavedCompactPost(raw);
    const videoUrls = selectedVideoUrlsFromPostDocument(raw);
    return {
      status: "already_compact_canonical",
      postId,
      stages,
      warnings,
      errors: [],
      compactCheck: compactPre,
      savedMediaUrlSanity: savedMediaSanity,
      raw,
      generatedAssets: [] as Array<{ assetId: string; generated: Record<string, string> }>,
      skippedAssets: [] as string[],
      selectedVideoUrlsBefore: videoUrls,
      selectedVideoUrlsAfterGeneration: videoUrls,
      selectedVideoUrlsSaved: videoUrls,
      validation: null,
      repairedRaw: raw,
      canonicalPreview: null,
      diffSummary: {},
      generationErrors: [] as string[],
      backupPath: "",
      byteEstimateBefore: bytes,
      byteEstimateAfter: bytes,
      removedPaths: [] as string[]
    };
  }

  const cfgLabUrlRepair = readWasabiConfigFromEnv();
  if (cfgLabUrlRepair) {
    const rep = await repairVideosLabDoublePostPrefixUrlsDeep(cfgLabUrlRepair, raw as Record<string, unknown>);
    raw = rep.value as UnknownRecord;
    for (const w of rep.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }

  const baselineAnalyze = analyzeVideoFastStartNeeds(raw, { postId });
  const shouldRunFaststartRepair =
    Boolean(compactPre.videoNeedsFaststart) ||
    detectPlaybackLabGeneratedNotPromoted(raw as Record<string, unknown>) ||
    baselineAnalyze.needsGenerationCount > 0;
  emit(
    "fast_start_repair_plan",
    JSON.stringify({
      shouldRunFaststartRepair,
      posterNeedsRepair: compactPre.posterNeedsRepair === true,
      needsGenerationCount: baselineAnalyze.needsGenerationCount,
      missingSourceCount: baselineAnalyze.missingSourceCount
    })
  );

  emit("normalize_baseline", "before_fast_start_repair");
  const beforeNormalized = normalizeMasterPostV2(raw, { postId });
  const selectedVideoUrlsBefore = selectedVideoUrlsFromCanonical(beforeNormalized.canonical);

  stages.push("analyzing_fast_start_needs");
  emit("analyzing_fast_start_needs", "scan_assets_and_urls");
  let run: Awaited<ReturnType<typeof generateMissingFastStartVariantsForPost>>;
  if (shouldRunFaststartRepair) {
    run = await generateMissingFastStartVariantsForPost(postId, raw, {
      generateMissingForAsset: defaultGenerateMissingForAsset,
      verifyGeneratedUrl: defaultVerifyGeneratedVideoUrl,
      onProgress: (evt) =>
        emit(evt.phase, evt.detail, { assetId: evt.assetId, index: evt.index, total: evt.total })
    });
  } else {
    stages.push("fast_start_generation_skipped");
    warnings.push("fast_start_generation_skipped_not_needed");
    run = {
      analyze: baselineAnalyze,
      generationResults: []
    };
  }
  const generatedAssets = run.generationResults
    .filter((row) => !row.skipped && Object.keys(row.generated ?? {}).length > 0)
    .map((row) => ({ assetId: row.assetId, generated: row.generated }));
  const skippedAssets = run.generationResults.filter((row) => row.skipped).map((row) => row.assetId);
  const generationErrors = run.generationResults.flatMap((row) => row.errors ?? []);
  if (run.analyze.videoAssetCount === 0) warnings.push("no_video_assets");
  if (run.analyze.alreadyOptimizedCount === run.analyze.videoAssetCount && run.analyze.videoAssetCount > 0) {
    warnings.push("already_optimized");
    warnings.push("no_missing_fast_starts");
  }

  if (generatedAssets.length > 0) stages.push("generating_missing_fast_starts");
  stages.push("merging_generated_assets");
  emit("merging_generated_assets", `rows=${run.generationResults.length}`);
  let repairedRaw = mergePlaybackLabResultsIntoRawPost(raw, run.generationResults);
  stages.push("poster_repair_check");
  const posterRepair = await repairPosterForRawPost({
    postId,
    raw: repairedRaw,
    onProgress: (evt) => emit(evt.stage, evt.detail, { assetId: evt.assetId })
  });
  if (posterRepair.posterRepairApplied) {
    emit("poster_repair_applied", `${posterRepair.posterRepairSource ?? "unknown"} ${posterRepair.posterRepairUrl ?? ""}`);
    warnings.push(`poster_repaired:${posterRepair.posterRepairSource ?? "unknown"}`);
  }
  if (posterRepair.failure) {
    errors.push("poster_repair_failed");
    return {
      status: "poster_repair_failed",
      stages,
      warnings,
      errors,
      generatedAssets,
      skippedAssets,
      selectedVideoUrlsBefore,
      selectedVideoUrlsAfterGeneration: selectedVideoUrlsBefore,
      validation: null,
      raw,
      repairedRaw,
      canonicalPreview: null,
      diffSummary: {
        posterRepairDiagnostics: posterRepair.diagnostics
      },
      generationErrors,
      unresolvedAfterRepair: baselineAnalyze,
      generationFailureDetail: {
        reason: "poster_and_video_source_unreachable",
        posterRepairDiagnostics: posterRepair.diagnostics
      },
      failureClassification: {
        failureClass: "poster_and_video_source_unreachable",
        isRepairable: false,
        shouldAttemptFaststartRepair: false,
        shouldFallbackToOriginalIfVerifiedFaststart: false,
        shouldQuarantine: true,
        reasons: ["poster_and_video_source_unreachable"],
        sourceUrls: [],
        assetIds: [],
        suggestedNextAction:
          "Poster URL is external/expired and no reachable video source could be probed. Restore either poster image or video source URL.",
        precheckValidationContradiction: false,
        optimizeStatus: "poster_repair_failed",
        lastStep: "poster_repair_check"
      }
    };
  }
  repairedRaw = posterRepair.repairedRaw;

  stages.push("rebuilding_canonical_preview");
  emit("engagement_source_audit", "firestore_subcollections");
  const engagementSourceAudit = await auditPostEngagementSourcesV2(db, postId, repairedRaw);
  emit("normalize_master_post_v2", "strict_after_repair");
  const normalized = normalizeMasterPostV2(repairedRaw, { postId, strict: true, engagementSourceAudit });
  const compactPlaybackBaseline = compactCanonicalPostForLiveWrite({
    canonical: normalized.canonical,
    rawBefore: raw,
    postId
  });
  const selectedVideoUrlsAfterGeneration = selectedVideoUrlsFromPostDocument(
    compactPlaybackBaseline.livePost as UnknownRecord
  );
  const analyzeAfterRepair = analyzeVideoFastStartNeeds(repairedRaw, { postId });
  const previewDiffSummary = diffMasterPostPreview({
    raw: repairedRaw,
    canonical: normalized.canonical,
    recoveredLegacyAssets: normalized.recoveredLegacyAssets,
    dedupedAssets: normalized.dedupedAssets,
    warnings: normalized.warnings,
    errors: normalized.errors,
    processingDebugExtracted: true
  });

  stages.push("validating");
  emit("validating", "blocking_and_warnings");
  const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
  if (validation.blockingErrors.length > 0) {
    errors.push("validation_failed");
    return {
      status: "validation_failed",
      stages,
      warnings,
      errors,
      generatedAssets,
      skippedAssets,
      selectedVideoUrlsBefore,
      selectedVideoUrlsAfterGeneration,
      validation,
      raw,
      repairedRaw,
      canonicalPreview: normalized.canonical,
      diffSummary: previewDiffSummary,
      generationErrors,
      posterRepairApplied: posterRepair.posterRepairApplied,
      posterRepairSource: posterRepair.posterRepairSource,
      posterRepairUrl: posterRepair.posterRepairUrl,
      posterRepairDiagnostics: posterRepair.diagnostics,
      unresolvedAfterRepair: analyzeAfterRepair,
      failureClassification: buildOptimizeFailureClassification({
        compactPre,
        status: "validation_failed",
        lastStep: "validate_after_repair",
        repairedRaw,
        canonical: normalized.canonical,
        validation,
        generationFailureDetail: null,
        analyzeAfterRepair
      })
    };
  }
  const unresolvedRequiredAssets = analyzeAfterRepair.assetNeeds.filter(
    (asset) =>
      asset.sourceUrl &&
      (asset.needs.startup540FaststartAvc ||
        asset.needs.startup720FaststartAvc ||
        asset.needs.posterHigh ||
        asset.needs.preview360Avc ||
        asset.needs.main720Avc)
  );
  if (strict && unresolvedRequiredAssets.length > 0) {
    errors.push("generation_failed");
    const generationFailureDetail = buildStrictGenerationFailureDetail({
      postId,
      unresolvedRequiredAssets,
      analyzeAfterRepair,
      generationErrors,
      generatedAssets,
      skippedAssets
    });
    return {
      status: "generation_failed",
      stages,
      warnings,
      errors: [...errors, ...generationErrors],
      generatedAssets,
      skippedAssets,
      selectedVideoUrlsBefore,
      selectedVideoUrlsAfterGeneration,
      validation,
      raw,
      repairedRaw,
      canonicalPreview: normalized.canonical,
      diffSummary: previewDiffSummary,
      generationErrors,
      posterRepairApplied: posterRepair.posterRepairApplied,
      posterRepairSource: posterRepair.posterRepairSource,
      posterRepairUrl: posterRepair.posterRepairUrl,
      posterRepairDiagnostics: posterRepair.diagnostics,
      unresolvedAfterRepair: analyzeAfterRepair,
      generationFailureDetail,
      failureClassification: buildOptimizeFailureClassification({
        compactPre,
        status: "generation_failed",
        lastStep: "strict_unresolved_after_repair",
        repairedRaw,
        canonical: normalized.canonical,
        validation,
        generationFailureDetail,
        analyzeAfterRepair
      })
    };
  }
  if (generationErrors.length > 0) {
    warnings.push("generation_partial_errors_nonblocking");
  }

  stages.push("creating_backup");
  emit("creating_backup", "postCanonicalBackups + compact live set");
  const persisted = await persistCompactCanonicalPost({
    db,
    postId,
    rawBefore: snapshotRaw,
    repairedRaw,
    canonical: normalized.canonical,
    engagementSourceAudit,
    actorRoute: "debug/post-rebuilder/optimize-and-write"
  });
  const backupPath = persisted.backupPath;

  stages.push("writing_firestore");
  emit("writing_firestore", "compact_replace_document");

  stages.push("verifying_saved_doc");
  emit("verifying_saved_doc", "compact_check_and_urls");
  const savedSnap = await postRef.get();
  const savedRaw = (savedSnap.data() ?? {}) as UnknownRecord;
  const savedCompact = isCompactCanonicalPostV2(savedRaw as Record<string, unknown>);
  if (!savedCompact.ok) {
    errors.push("post_write_compact_validation_failed");
    const savedMediaSanityOnFail = mediaUrlSanityCheckOnSavedCompactPost(savedRaw);
    return {
      status: "write_failed_compact_validation",
      stages,
      backupPath,
      generatedAssets,
      skippedAssets,
      selectedVideoUrlsBefore,
      selectedVideoUrlsAfterGeneration,
      validation,
      warnings,
      errors,
      raw,
      repairedRaw,
      canonicalPreview: normalized.canonical,
      diffSummary: previewDiffSummary,
      generationErrors,
      posterRepairApplied: posterRepair.posterRepairApplied,
      posterRepairSource: posterRepair.posterRepairSource,
      posterRepairUrl: posterRepair.posterRepairUrl,
      posterRepairDiagnostics: posterRepair.diagnostics,
      unresolvedAfterRepair: analyzeAfterRepair,
      compactValidation: savedCompact,
      savedCompactCheck: savedCompact,
      savedMediaUrlSanity: savedMediaSanityOnFail,
      savedRaw,
      byteEstimateBefore: persisted.byteEstimateBefore,
      byteEstimateAfter: persisted.byteEstimateAfter,
      failureClassification: buildOptimizeFailureClassification({
        compactPre,
        status: "write_failed_compact_validation",
        lastStep: "verify_saved_doc",
        repairedRaw: savedRaw,
        canonical: normalized.canonical,
        validation,
        generationFailureDetail: null,
        analyzeAfterRepair
      })
    };
  }
  const savedMediaSanity = mediaUrlSanityCheckOnSavedCompactPost(savedRaw);
  if (!savedMediaSanity.ok) {
    errors.push("post_write_media_url_sanity_failed");
    return {
      status: "write_failed_media_url_sanity",
      stages,
      backupPath,
      generatedAssets,
      skippedAssets,
      selectedVideoUrlsBefore,
      selectedVideoUrlsAfterGeneration,
      validation,
      warnings,
      errors,
      raw,
      repairedRaw,
      canonicalPreview: normalized.canonical,
      diffSummary: previewDiffSummary,
      generationErrors,
      posterRepairApplied: posterRepair.posterRepairApplied,
      posterRepairSource: posterRepair.posterRepairSource,
      posterRepairUrl: posterRepair.posterRepairUrl,
      posterRepairDiagnostics: posterRepair.diagnostics,
      unresolvedAfterRepair: analyzeAfterRepair,
      compactValidation: savedCompact,
      savedCompactCheck: savedCompact,
      savedMediaUrlSanity: savedMediaSanity,
      savedRaw,
      byteEstimateBefore: persisted.byteEstimateBefore,
      byteEstimateAfter: persisted.byteEstimateAfter,
      failureClassification: buildOptimizeFailureClassification({
        compactPre,
        status: "write_failed_media_url_sanity",
        lastStep: "media_url_sanity_saved_doc",
        repairedRaw: savedRaw,
        canonical: normalized.canonical,
        validation,
        generationFailureDetail: null,
        analyzeAfterRepair
      })
    };
  }
  const selectedVideoUrlsSaved = selectedVideoUrlsFromPostDocument(savedRaw);
  if (JSON.stringify(selectedVideoUrlsSaved) !== JSON.stringify(selectedVideoUrlsAfterGeneration)) {
    errors.push("post_write_verification_failed");
    return {
      status: "post_write_verification_failed",
      stages,
      backupPath,
      generatedAssets,
      skippedAssets,
      selectedVideoUrlsBefore,
      selectedVideoUrlsAfterGeneration,
      selectedVideoUrlsSaved,
      validation,
      warnings,
      errors,
      raw,
      repairedRaw,
      canonicalPreview: normalized.canonical,
      diffSummary: previewDiffSummary,
      generationErrors,
      posterRepairApplied: posterRepair.posterRepairApplied,
      posterRepairSource: posterRepair.posterRepairSource,
      posterRepairUrl: posterRepair.posterRepairUrl,
      posterRepairDiagnostics: posterRepair.diagnostics,
      unresolvedAfterRepair: analyzeAfterRepair,
      savedCompactCheck: savedCompact,
      savedMediaUrlSanity: savedMediaSanity,
      savedRaw,
      byteEstimateBefore: persisted.byteEstimateBefore,
      byteEstimateAfter: persisted.byteEstimateAfter,
      failureClassification: buildOptimizeFailureClassification({
        compactPre,
        status: "post_write_verification_failed",
        lastStep: "selected_video_urls_mismatch",
        repairedRaw: savedRaw,
        canonical: normalized.canonical,
        validation,
        generationFailureDetail: null,
        analyzeAfterRepair
      })
    };
  }

  stages.push("complete");
  return {
    postId,
    status: "complete",
    stages,
    backupPath,
    generatedAssets,
    skippedAssets,
    selectedVideoUrlsBefore,
    selectedVideoUrlsAfterGeneration,
    selectedVideoUrlsSaved,
    validation,
    warnings,
    errors,
    raw,
    repairedRaw,
    canonicalPreview: normalized.canonical,
    diffSummary: previewDiffSummary,
    generationErrors,
    posterRepairApplied: posterRepair.posterRepairApplied,
    posterRepairSource: posterRepair.posterRepairSource,
    posterRepairUrl: posterRepair.posterRepairUrl,
    posterRepairDiagnostics: posterRepair.diagnostics,
    unresolvedAfterRepair: analyzeAfterRepair,
    compactWrite: true,
    byteEstimateBefore: persisted.byteEstimateBefore,
    byteEstimateAfter: persisted.byteEstimateAfter,
    removedPaths: persisted.removedPaths,
    savedRaw,
    savedRawHash: hashPostForRebuild(savedRaw),
    savedCompactCheck: savedCompact,
    savedMediaUrlSanity: savedMediaSanity
  };
}

const htmlPage = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Post Rebuilder Queue</title>
  <style>
    :root{
      --bg:#f4f1ea;
      --bg-accent:#efe6d6;
      --surface:#fffdf8;
      --surface-strong:#ffffff;
      --ink:#1f2430;
      --muted:#5d6472;
      --line:#d8cfbf;
      --line-strong:#c4b79f;
      --brand:#9f4f2e;
      --brand-soft:#f4d6c8;
      --success:#246a3d;
      --success-soft:#dff3e6;
      --warning:#8d5b12;
      --warning-soft:#f9ebc9;
      --danger:#a23434;
      --danger-soft:#f9d8d8;
      --info:#205e8f;
      --info-soft:#dceefb;
      --shadow:0 18px 40px rgba(86, 60, 20, 0.08);
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      color:var(--ink);
      font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255,255,255,0.85), transparent 32%),
        linear-gradient(180deg, #faf6ef 0%, #f4f1ea 38%, #efe6d6 100%);
    }
    button,input,select,textarea{font:inherit}
    button{
      border:1px solid var(--line-strong);
      background:var(--surface-strong);
      color:var(--ink);
      border-radius:12px;
      padding:10px 14px;
      cursor:pointer;
      transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease;
      box-shadow:0 2px 0 rgba(31,36,48,0.03);
    }
    button:hover:enabled{
      transform:translateY(-1px);
      border-color:var(--brand);
      box-shadow:0 10px 20px rgba(159,79,46,0.1);
    }
    button:disabled{
      opacity:.55;
      cursor:not-allowed;
      box-shadow:none;
    }
    .button-optimize{
      background:linear-gradient(180deg, #0d7a4a, #0a5f3a);
      color:#f3fff9;
      border-color:#0a5f3a;
      font-weight:800;
    }
    .button-optimize:hover:enabled{
      border-color:#07502f;
      box-shadow:0 10px 20px rgba(10,95,58,0.22);
    }
    input,select,textarea{
      width:100%;
      border:1px solid var(--line);
      border-radius:12px;
      background:var(--surface-strong);
      color:var(--ink);
      padding:10px 12px;
    }
    textarea{min-height:220px;resize:vertical}
    textarea.compact{min-height:110px}
    pre{
      margin:0;
      white-space:pre-wrap;
      word-break:break-word;
      background:#191d24;
      color:#dbe7ff;
      padding:14px;
      border-radius:14px;
      overflow:auto;
      min-height:96px;
    }
    .shell{
      max-width:1660px;
      margin:0 auto;
      padding:20px;
    }
    .hero{
      display:grid;
      grid-template-columns:minmax(0,1.7fr) minmax(280px,.95fr);
      gap:18px;
      align-items:stretch;
      margin-bottom:18px;
    }
    .top-console{
      position:sticky;
      top:10px;
      z-index:4;
      margin-bottom:16px;
      border-radius:14px;
      border:1px solid #2e3a52;
      background:#111826;
      color:#c9ddff;
      padding:10px 12px;
      box-shadow:0 8px 20px rgba(0,0,0,0.24);
    }
    .top-console strong{
      display:block;
      font-size:12px;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:#88b4ff;
      margin-bottom:6px;
    }
    .top-console pre{
      min-height:54px;
      max-height:320px;
      background:transparent;
      padding:0;
      border-radius:0;
      margin:0;
      color:inherit;
      overflow:auto;
      font-size:12px;
    }
    .top-console-head{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      flex-wrap:wrap;
    }
    .top-console-head button{
      padding:6px 12px;
      font-size:13px;
    }
    .hero-card,.panel,.detail-card{
      background:rgba(255,253,248,0.92);
      border:1px solid rgba(196,183,159,0.8);
      border-radius:22px;
      box-shadow:var(--shadow);
    }
    .hero-copy{
      padding:24px;
      background:
        linear-gradient(140deg, rgba(255,255,255,0.8), rgba(255,246,232,0.95)),
        linear-gradient(180deg, rgba(159,79,46,0.08), rgba(159,79,46,0));
    }
    .eyebrow{
      margin:0 0 10px;
      color:var(--brand);
      text-transform:uppercase;
      letter-spacing:.14em;
      font-size:12px;
      font-weight:800;
    }
    h1,h2,h3,p{margin:0}
    .hero-copy h1{
      font-size:34px;
      line-height:1.05;
      margin-bottom:10px;
      letter-spacing:-0.04em;
    }
    .hero-copy p{
      color:var(--muted);
      max-width:850px;
      line-height:1.5;
    }
    .hero-stats{
      padding:18px;
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:12px;
    }
    .stat{
      padding:16px;
      border-radius:18px;
      background:var(--surface-strong);
      border:1px solid var(--line);
    }
    .stat span{
      display:block;
      color:var(--muted);
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:.08em;
      margin-bottom:8px;
    }
    .stat strong{
      display:block;
      font-size:26px;
      line-height:1;
    }
    .migration-gate.safe{
      border-color:#7ab87a;
      background:#f0faf0;
    }
    .migration-gate.unsafe{
      border-color:#c46a5c;
      background:#fdf2f0;
    }
    .controls{
      display:grid;
      grid-template-columns:1.35fr .9fr .9fr;
      gap:16px;
      margin-bottom:18px;
    }
    .panel{
      padding:18px;
    }
    .panel h2{
      font-size:18px;
      margin-bottom:12px;
    }
    .muted{
      color:var(--muted);
      line-height:1.45;
    }
    .inline-row{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
    }
    .inline-row > *{flex:1 1 auto}
    .button-row{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:12px;
    }
    .button-row button{flex:0 0 auto}
    .checkbox{
      display:flex;
      align-items:center;
      gap:8px;
      color:var(--muted);
      margin-top:12px;
    }
    .checkbox input{
      width:auto;
      padding:0;
      border-radius:6px;
    }
    .mode-switch{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:10px;
      margin-bottom:12px;
    }
    .mode-switch button.active{
      background:var(--brand);
      color:#fff8f2;
      border-color:var(--brand);
    }
    .workspace{
      display:grid;
      grid-template-columns:minmax(360px, 430px) minmax(0,1fr);
      gap:18px;
      align-items:start;
    }
    .queue-toolbar{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      margin-top:14px;
    }
    .queue-list{
      display:flex;
      flex-direction:column;
      gap:12px;
      margin-top:16px;
      max-height:calc(100vh - 330px);
      overflow:auto;
      padding-right:4px;
    }
    .queue-card{
      width:100%;
      text-align:left;
      padding:16px;
      border-radius:18px;
      border:1px solid var(--line);
      background:var(--surface-strong);
    }
    .queue-card.active{
      border-color:var(--brand);
      box-shadow:0 18px 28px rgba(159,79,46,0.14);
      background:linear-gradient(180deg, #fffefb, #fff5ef);
    }
    .queue-card h3{
      font-size:16px;
      margin-bottom:6px;
      word-break:break-word;
    }
    .queue-card p{
      color:var(--muted);
      line-height:1.4;
      margin-bottom:10px;
      word-break:break-word;
    }
    .badge-row{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
    }
    .badge{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:28px;
      padding:4px 10px;
      border-radius:999px;
      font-size:12px;
      font-weight:800;
      letter-spacing:.02em;
      border:1px solid transparent;
    }
    .badge.neutral{background:#f3ede3;color:#64553c;border-color:#e2d4bb}
    .badge.info{background:var(--info-soft);color:var(--info);border-color:#b3daef}
    .badge.success{background:var(--success-soft);color:var(--success);border-color:#bee0ca}
    .badge.warning{background:var(--warning-soft);color:var(--warning);border-color:#efd993}
    .badge.danger{background:var(--danger-soft);color:var(--danger);border-color:#e9b4b4}
    .details{
      display:grid;
      gap:16px;
    }
    .detail-card{
      padding:18px;
    }
    .selected-head{
      display:flex;
      justify-content:space-between;
      gap:18px;
      align-items:flex-start;
      flex-wrap:wrap;
      margin-bottom:14px;
    }
    .selected-head h2{
      font-size:24px;
      line-height:1.1;
      margin-top:4px;
      word-break:break-word;
    }
    .selected-overline{
      color:var(--brand);
      text-transform:uppercase;
      letter-spacing:.1em;
      font-size:11px;
      font-weight:800;
    }
    .summary-grid{
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:12px;
      margin-top:14px;
    }
    .summary-chip{
      padding:12px;
      border-radius:14px;
      background:var(--surface-strong);
      border:1px solid var(--line);
    }
    .summary-chip span{
      display:block;
      color:var(--muted);
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:.08em;
      margin-bottom:6px;
    }
    .summary-chip strong{
      display:block;
      font-size:15px;
      line-height:1.3;
      word-break:break-word;
    }
    .detail-grid{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:16px;
    }
    .detail-grid .span-2{grid-column:span 2}
    .detail-card h3{
      font-size:16px;
      margin-bottom:10px;
    }
    .log{
      margin-top:18px;
    }
    .hint{
      margin-top:10px;
      padding:12px 14px;
      border-radius:14px;
      background:#f7f1e5;
      border:1px solid #ebddbf;
      color:#6c5a35;
      line-height:1.45;
    }
    [data-mode-section]{display:none}
    body[data-mode="manual"] [data-mode-section="manual"]{display:block}
    body[data-mode="auto"] [data-mode-section="auto"]{display:block}
    @media (max-width: 1280px){
      .controls,.workspace,.hero,.detail-grid{grid-template-columns:1fr}
      .queue-list{max-height:none}
      .detail-grid .span-2{grid-column:auto}
      .summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    @media (max-width: 720px){
      .shell{padding:14px}
      .hero-copy h1{font-size:28px}
      .summary-grid,.hero-stats{grid-template-columns:1fr}
      .selected-head{flex-direction:column}
    }
  </style>
</head>
<body data-mode="manual">
  <div class="shell">
    <section class="top-console">
      <div class="top-console-head">
        <strong>Optimize Console</strong>
        <button id="cancelRunning" type="button" disabled>Cancel in-flight</button>
      </div>
      <pre id="topConsole">Idle.</pre>
    </section>
    <section class="hero">
      <div class="hero-card hero-copy">
        <p class="eyebrow">Debug / Master Post V2</p>
        <h1>Post Rebuilder Queue</h1>
        <p>
          Exact same per-post rebuild flow, now wrapped in a multi-post queue. Paste a comma-separated list of post IDs,
          pull the newest posts from Firestore, inspect one selected post in detail, or run clean sequential auto previews and writes.
        </p>
        <p class="muted" style="margin-top:12px;font-size:13px;line-height:1.45">
          <strong>Live compact</strong> means the Firestore doc already matches the tight production shape — Optimize/Write will <em>skip</em> safely.
          <strong>Needs work</strong> means compact check failed (bloat, bad video URLs, missing fields) — run Optimize + Write to repair.
          Normalize <strong>preview</strong> can show blocking errors even when live is already OK; trust the <strong>Compact canonical check</strong> panel and green <strong>LIVE OK</strong> badges.
        </p>
      </div>
      <div class="hero-card hero-stats">
        <div class="stat"><span>Queue Size</span><strong id="queueCount">0</strong></div>
        <div class="stat"><span>Preview Ready</span><strong id="previewReadyCount">0</strong></div>
        <div class="stat"><span>Compact writes OK</span><strong id="compactWriteOkCount">0</strong></div>
        <div class="stat"><span>Already compact · skipped</span><strong id="compactSkipCount">0</strong></div>
        <div class="stat"><span>Media repaired (queue)</span><strong id="mediaRepairCount">0</strong></div>
        <div class="stat"><span>Poster repaired</span><strong id="posterRepairCount">0</strong></div>
        <div class="stat"><span>Poster repair failed</span><strong id="posterRepairFailedCount">0</strong></div>
        <div class="stat"><span>External poster pending</span><strong id="externalPosterSkippedCount">0</strong></div>
        <div class="stat"><span>Video faststart pending (live)</span><strong id="videoFaststartPendingCount">0</strong></div>
        <div class="stat"><span>Blocked / errors (live or write)</span><strong id="problemCount">0</strong></div>
      </div>
      <div id="migrationGateBanner" class="migration-gate" style="display:none;margin-top:14px;padding:14px 16px;border-radius:14px;border:1px solid var(--line);background:var(--surface-strong);font-size:14px;line-height:1.45"></div>
    </section>

    <section id="queueRunReportSection" class="panel" style="display:none;margin-top:0">
      <h2>Last queue run — failures & export</h2>
      <p class="muted">After a batch, download a JSON report, copy failed IDs only, or retry repairable failures (skips missing source / external-only sources).</p>
      <div class="button-row" style="margin-top:10px">
        <button id="downloadFailureReport" type="button">Download failure report JSON</button>
        <button id="copyFailureReport" type="button">Copy report JSON</button>
        <button id="retryFailedRepairable" type="button">Retry failed (repairable only)</button>
      </div>
      <label class="muted" style="display:block;margin-top:12px">Failed post IDs only (comma-separated)</label>
      <textarea id="failedIdsOnly" class="compact" style="min-height:64px;margin-top:6px" readonly placeholder="Run a queue batch with failures to populate."></textarea>
    </section>

    <section class="controls">
      <div class="panel">
        <h2>Queue Input</h2>
        <p class="muted">Paste one or many post IDs. Commas and new lines both work.</p>
        <textarea id="postIdsInput" class="compact" placeholder="postIdOne, postIdTwo, postIdThree"></textarea>
        <label class="checkbox">
          <input id="appendQueue" type="checkbox"/>
          <span>Append to existing queue instead of replacing it</span>
        </label>
        <div class="button-row">
          <button id="loadIds">Build Queue From IDs</button>
          <button id="clearQueue">Clear Queue</button>
        </div>
      </div>

      <div class="panel">
        <h2>Load posts by Firestore rank</h2>
        <p class="muted">Rank is global recency in the <code>posts</code> collection (<code>time</code> desc), not a slot in your queue below.</p>
        <div class="inline-row" style="margin-top:12px">
          <input id="newestFromRank" type="number" min="1" max="${POST_REBUILDER_RANK_QUERY_OFFSET_MAX}" value="1" title="1 = newest document"/>
          <input id="newestCount" type="number" min="1" max="${POST_REBUILDER_RANK_QUERY_LIMIT_MAX}" value="12"/>
          <button id="loadNewest">Load by rank</button>
        </div>
        <div class="hint">Example: From #20 + Count 10 loads the 20th–29th newest posts. Server accepts up to ${POST_REBUILDER_RANK_QUERY_LIMIT_MAX.toLocaleString()} per request (very large batches may be slow or hit HTTP timeouts). Paste IDs / append are not limited by this cap.</div>
      </div>

      <div class="panel">
        <h2>Modes</h2>
        <div class="mode-switch">
          <button id="manualMode" class="active">Manual Mode</button>
          <button id="autoMode">Auto Mode</button>
        </div>
        <div data-mode-section="manual">
          <p class="muted">Use this when you want the same old one-post workflow, but for a selected post inside a multi-post queue.</p>
        </div>
        <div data-mode-section="auto">
          <p class="muted">Use this when you want a clean migration dashboard feel: sequential queue processing with clear per-post status tracking.</p>
          <label class="checkbox">
            <input id="autoGenerateFastStarts" type="checkbox"/>
            <span>Also generate missing fast starts before preview/write</span>
          </label>
        </div>
        <div class="hint" id="modeHint">
          Manual mode keeps the original raw / preview / write / backups / revert steps focused on one selected post at a time.
        </div>
      </div>
    </section>

    <section class="workspace">
      <div class="panel">
        <h2>Post Queue</h2>
        <p class="muted">Click any queued post to inspect its full JSON and migration state on the right.</p>

        <div class="queue-toolbar" data-mode-section="manual">
          <button id="loadRawSelected">Load Raw Selected</button>
          <button id="previewSelected">Preview Selected</button>
          <button id="generateFastStartsSelected">Generate Missing Fast Starts</button>
          <button id="optimizeWriteSelected" class="button-optimize">Optimize + Write Selected</button>
          <button id="optimizeWriteQueueManual" class="button-optimize">Optimize + Write Queue (Manual)</button>
          <button id="writeSelected">Write Selected</button>
          <button id="backupsSelected">Load Backups</button>
        </div>
        <div class="inline-row" data-mode-section="manual" style="margin-top:12px">
          <input id="queueRangeStart" type="number" min="1" placeholder="Range start (1-based)"/>
          <input id="queueRangeEnd" type="number" min="1" placeholder="Range end (1-based, optional)"/>
        </div>
        <div class="hint" data-mode-section="manual" style="margin-top:10px">
          Queue range is positions in the <em>current queue list</em> (for batch optimize / auto). Use “Load by rank” above to pull a window of newest posts from Firestore by global rank #.
        </div>
        <label class="checkbox" data-mode-section="manual" style="margin-top:12px">
          <input id="manualConfirmQueueStart" type="checkbox" checked/>
          <span>Confirm once before starting queue</span>
        </label>

        <div class="queue-toolbar" data-mode-section="auto">
          <button id="autoPreviewQueue">Auto Preview Queue</button>
          <button id="autoPreviewWriteQueue">Auto Preview + Write Queue</button>
          <button id="stopAuto">Stop Auto Run</button>
        </div>

        <div class="hint" id="queueStatusHint" style="margin-top:14px">
          Queue is empty. Add post IDs or load newest posts to get started.
        </div>
        <div id="queueList" class="queue-list"></div>
      </div>

      <div class="details">
        <div class="detail-card">
          <div id="selectedSummary"></div>
          <div class="inline-row" style="margin-top:14px">
            <select id="backupSelect"></select>
            <button id="revertSelected">Revert Selected Backup</button>
          </div>
        </div>

        <div class="detail-grid">
          <div class="detail-card">
            <h3>Diff Summary</h3>
            <pre id="diff"></pre>
          </div>
          <div class="detail-card">
            <h3>Validation</h3>
            <pre id="validation"></pre>
          </div>
          <div class="detail-card">
            <h3>Engagement Source Audit</h3>
            <pre id="engagementAudit"></pre>
          </div>
          <div class="detail-card">
            <h3>Media Preview</h3>
            <pre id="media"></pre>
          </div>
          <div class="detail-card">
            <h3>Engagement Preview</h3>
            <pre id="engagement"></pre>
          </div>
          <div class="detail-card">
            <h3>Location</h3>
            <pre id="location"></pre>
          </div>
          <div class="detail-card span-2">
            <h3>Compact canonical check</h3>
            <pre id="compactCheck"></pre>
          </div>
          <div class="detail-card span-2">
            <h3>Raw JSON</h3>
            <textarea id="raw"></textarea>
          </div>
          <div class="detail-card span-2">
            <h3>Canonical JSON</h3>
            <textarea id="canonical"></textarea>
          </div>
          <div class="detail-card span-2">
            <h3>Media Processing Debug Preview</h3>
            <textarea id="processing"></textarea>
          </div>
        </div>

        <div class="detail-card log">
          <h3>Run Log</h3>
          <pre id="activityLog"></pre>
        </div>
      </div>
    </section>
  </div>

  <script>
    const state = {
      mode: 'manual',
      queue: [],
      activePostId: null,
      log: [],
      auto: { running: false, kind: null, generateFastStarts: false },
      manualQueue: { running: false },
      inFlightAbort: null,
      lastFailureReport: null,
      lastFailureReportFilename: ''
    };

    const el = (id) => document.getElementById(id);

    function json(value) {
      if (value === undefined) return 'null';
      try {
        return JSON.stringify(value, null, 2);
      } catch (_error) {
        return String(value);
      }
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function dedupePostIds(text) {
      const seen = new Set();
      return String(text || '')
        .split(/[\\n,]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((postId) => {
          if (seen.has(postId)) return false;
          seen.add(postId);
          return true;
        });
    }

    function nowLabel() {
      return new Date().toLocaleTimeString();
    }

    /** Normalize Firestore timestamp / ISO / epoch to a single display string (user locale + short TZ). */
    function formatQueueTime(value) {
      if (value == null || value === '') return '';
      var v = value;
      if (typeof v === 'object' && v !== null && typeof v.toDate === 'function') {
        try {
          v = v.toDate().toISOString();
        } catch (_e) {
          return '';
        }
      }
      if (typeof v === 'object' && v !== null) {
        var sec =
          typeof v.seconds === 'number'
            ? v.seconds
            : typeof v._seconds === 'number'
              ? v._seconds
              : null;
        if (sec != null) v = new Date(sec * 1000).toISOString();
      }
      var s = String(v).trim();
      if (!s) return '';
      var ms = Date.parse(s);
      if (!Number.isFinite(ms)) return s;
      var d = new Date(ms);
      try {
        // Do not mix dateStyle/timeStyle with timeZoneName — that throws in ECMA-402 (Invalid option).
        return d.toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short'
        });
      } catch (_err) {
        try {
          return d.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
          });
        } catch (_err2) {
          return d.toISOString().replace('T', ' ').replace(/\\.\\d{3}Z$/, ' UTC');
        }
      }
    }

    function pickTimeFromRawOrCanonical(data) {
      if (!data) return '';
      var raw = data.raw;
      if (raw && raw.time != null && raw.time !== '') {
        var t0 = coerceAnyTimeToIsoString(raw.time);
        if (t0) return t0;
      }
      if (raw && raw.lifecycle && raw.lifecycle.createdAt != null && raw.lifecycle.createdAt !== '') {
        var t1 = coerceAnyTimeToIsoString(raw.lifecycle.createdAt);
        if (t1) return t1;
      }
      if (raw && raw.lifecycle && raw.lifecycle.createdAtMs != null && Number.isFinite(Number(raw.lifecycle.createdAtMs))) {
        return new Date(Number(raw.lifecycle.createdAtMs)).toISOString();
      }
      var c = data.canonicalPreview;
      if (c && c.lifecycle) {
        if (c.lifecycle.createdAt != null && c.lifecycle.createdAt !== '') {
          var t2 = coerceAnyTimeToIsoString(c.lifecycle.createdAt);
          if (t2) return t2;
        }
        if (c.lifecycle.createdAtMs != null && Number.isFinite(Number(c.lifecycle.createdAtMs))) {
          return new Date(Number(c.lifecycle.createdAtMs)).toISOString();
        }
      }
      return '';
    }

    function addLog(message, postId) {
      const line = '[' + nowLabel() + '] ' + (postId ? postId + ' - ' : '') + message;
      state.log = [line].concat(state.log).slice(0, 220);
      el('activityLog').textContent = state.log.length ? state.log.join('\\n') : 'No actions yet.';
    }

    function pushTopConsole(message, postId) {
      const line = '[' + nowLabel() + '] ' + (postId ? postId + ' - ' : '') + message;
      const current = el('topConsole').textContent || '';
      const rows = current === 'Idle.' ? [] : current.split('\\n');
      rows.unshift(line);
      el('topConsole').textContent = rows.slice(0, 80).join('\\n');
    }

    function buildBadge(label, tone) {
      return '<span class="badge ' + tone + '">' + escapeHtml(label) + '</span>';
    }

    function createQueueItem(postId) {
      return {
        postId: postId,
        title: '',
        mediaKind: '',
        locationName: '',
        userId: '',
        time: '',
        timeDisplay: '',
        schemaVersion: '',
        hasCanonicalSchema: false,
        exists: null,
        rawHash: null,
        raw: null,
        canonicalPreview: null,
        mediaProcessingDebugPreview: null,
        engagementSourceAudit: null,
        diffSummary: null,
        validation: null,
        mediaView: null,
        engagementView: null,
        locationView: null,
        backups: [],
        backupSelection: '',
        status: {
          raw: 'idle',
          preview: 'idle',
          write: 'idle',
          backups: 'idle',
          revert: 'idle'
        },
        counts: {
          warnings: 0,
          blocking: 0
        },
        previewChecks: null,
        lastMessage: '',
        lastError: '',
        backupId: '',
        lastPreviewedAt: '',
        lastWrittenAt: '',
        generatedRepairPendingWrite: false,
        compactCheck: null,
        compactLivePreviewSummary: null,
        lastWriteOutcome: null,
        mediaRepairHappened: false,
        faststartVerifyFailed: false,
        lastBackupPath: '',
        lastDiagnosticsPath: '',
        previewNormalizeMismatch: false,
        lifecycleDeleted: false,
        generationFailureDetail: null,
        savedMediaUrlSanity: null,
        failureClassification: null,
        posterNeedsRepair: false,
        posterRepairReason: "",
        posterRepairApplied: false,
        posterRepairSource: "",
        posterRepairUrl: ""
      };
    }

    function collectMissingRequiredPathsFromItem(item) {
      const g = item.generationFailureDetail;
      if (!g || !Array.isArray(g.perAsset)) return [];
      const out = [];
      g.perAsset.forEach(function (row) {
        const id = row && row.assetId ? String(row.assetId) : '?';
        const needs = row && row.needs && typeof row.needs === 'object' ? row.needs : {};
        Object.keys(needs).forEach(function (k) {
          if (needs[k] === true) out.push(id + '.' + k);
        });
      });
      return out;
    }

    function buildFailureReportRow(item) {
      const fc = item.failureClassification || null;
      const ve =
        item.validation && Array.isArray(item.validation.blockingErrors) ? item.validation.blockingErrors : [];
      return {
        postId: item.postId,
        title: item.title || null,
        mediaKind: item.mediaKind || null,
        failureClass: fc ? fc.failureClass : 'unknown',
        isRepairable: fc ? Boolean(fc.isRepairable) : false,
        shouldAttemptFaststartRepair: fc ? Boolean(fc.shouldAttemptFaststartRepair) : false,
        shouldFallbackToOriginalIfVerifiedFaststart: fc ? Boolean(fc.shouldFallbackToOriginalIfVerifiedFaststart) : false,
        shouldQuarantine: fc ? Boolean(fc.shouldQuarantine) : false,
        reasons: fc && Array.isArray(fc.reasons) ? fc.reasons : [],
        precheckValidationContradiction: fc ? Boolean(fc.precheckValidationContradiction) : false,
        sourceUrls: fc && Array.isArray(fc.sourceUrls) ? fc.sourceUrls : [],
        assetIds: fc && Array.isArray(fc.assetIds) ? fc.assetIds : [],
        missingRequiredPaths: collectMissingRequiredPathsFromItem(item),
        validationErrors: ve,
        compactCheck: item.compactCheck || null,
        lastStep: fc && fc.lastStep != null ? fc.lastStep : null,
        optimizeStatus: fc && fc.optimizeStatus != null ? fc.optimizeStatus : null,
        lastWriteOutcome: item.lastWriteOutcome,
        lastError: item.lastError || null,
        lastMessage: item.lastMessage || null,
        generationFailureDetail: item.generationFailureDetail || null,
        posterNeedsRepair: item.compactCheck ? Boolean(item.compactCheck.posterNeedsRepair) : false,
        posterRepairReason: item.compactCheck ? item.compactCheck.posterRepairReason || null : null,
        posterRepairApplied: Boolean(item.posterRepairApplied),
        posterRepairSource: item.posterRepairSource || null,
        posterRepairUrl: item.posterRepairUrl || null,
        suggestedNextAction: fc
          ? fc.suggestedNextAction
          : 'Inspect validation + generationFailureDetail; re-run preview after upstream fix.'
      };
    }

    function captureQueueRunFailureReport() {
      const failures = state.queue
        .filter(function (item) {
          return item.lastWriteOutcome === 'error' || item.status.write === 'error';
        })
        .map(buildFailureReportRow);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = 'postRebuilderFailures_' + ts + '.json';
      const acted = state.queue.filter(function (i) {
        return (
          i.lastWriteOutcome === 'complete' ||
          i.lastWriteOutcome === 'already_compact' ||
          i.lastWriteOutcome === 'compacted_manual' ||
          i.lastWriteOutcome === 'error'
        );
      });
      const n = acted.length;
      const ok = acted.filter(function (i) {
        return i.lastWriteOutcome === 'complete' || i.lastWriteOutcome === 'compacted_manual';
      }).length;
      const skipped = acted.filter(function (i) {
        return i.lastWriteOutcome === 'already_compact';
      }).length;
      const err = acted.filter(function (i) {
        return i.lastWriteOutcome === 'error';
      }).length;
      const contradiction = failures.filter(function (f) {
        return f.precheckValidationContradiction;
      }).length;
      const unknownCls = failures.filter(function (f) {
        return f.failureClass === 'unknown';
      }).length;
      const completeOkMedia = state.queue.filter(function (i) {
        return i.lastWriteOutcome === 'complete' || i.lastWriteOutcome === 'compacted_manual';
      });
      const sampleSanityFail = completeOkMedia.some(function (i) {
        return i.savedMediaUrlSanity && i.savedMediaUrlSanity.ok === false;
      });
      const safe =
        n > 0 &&
        (ok + skipped) / n >= 0.95 &&
        err / n <= 0.05 &&
        contradiction === 0 &&
        !sampleSanityFail &&
        (failures.length === 0 || unknownCls / failures.length <= 0.25);
      state.lastFailureReport = {
        generatedAtIso: new Date().toISOString(),
        filename: filename,
        failures: failures,
        summary: {
          queueSize: state.queue.length,
          actedCount: n,
          compactWriteOk: ok,
          alreadyCompactSkipped: skipped,
          writeErrors: err,
          unknownFailureCount: unknownCls,
          precheckValidationContradictions: contradiction,
          sampleSavedMediaUrlSanityFailed: sampleSanityFail,
          safeToScaleFullMigration: safe
        },
        failedIdsOnly: failures.map(function (f) {
          return f.postId;
        }).join(',')
      };
      state.lastFailureReportFilename = filename;
      if (failures.length) {
        addLog(
          'Queue failure report: ' +
            failures.length +
            ' failed — download JSON filename=' +
            filename +
            ' contradictions=' +
            contradiction +
            ' unknownClass=' +
            unknownCls +
            '.'
        );
      } else {
        addLog('Queue failure report: 0 write/preview errors in queue snapshot after this pass.');
      }
      pushTopConsole('failure_report rows=' + failures.length + ' safeToScale=' + (safe ? 'yes' : 'no'), '');
    }

    function renderMigrationGateAndFailureReport() {
      const rep = state.lastFailureReport;
      const gate = el('migrationGateBanner');
      const section = el('queueRunReportSection');
      const ta = el('failedIdsOnly');
      if (!gate || !section || !ta) return;
      if (!rep) {
        gate.style.display = 'none';
        section.style.display = 'none';
        return;
      }
      section.style.display = 'block';
      ta.value = rep.failedIdsOnly || '';
      const s = rep.summary || {};
      if (!s.actedCount) {
        gate.style.display = 'none';
        return;
      }
      gate.style.display = 'block';
      const pctOk = Math.round((((s.compactWriteOk || 0) + (s.alreadyCompactSkipped || 0)) / s.actedCount) * 1000) / 10;
      const pctErr = Math.round(((s.writeErrors || 0) / s.actedCount) * 1000) / 10;
      if (s.safeToScaleFullMigration) {
        gate.className = 'migration-gate safe';
        gate.innerHTML =
          '<strong>SAFE TO SCALE</strong> — success+skipped≈' +
          pctOk +
          '% of acted posts; errors≈' +
          pctErr +
          '%; contradictions=0; unknown failure share within threshold; completed writes pass sample media URL sanity.';
      } else {
        gate.className = 'migration-gate unsafe';
        gate.innerHTML =
          '<strong>NOT SAFE TO SCALE</strong> — classify and retry failures first. Acted=' +
          s.actedCount +
          ' errors≈' +
          pctErr +
          '% contradictions=' +
          (s.precheckValidationContradictions || 0) +
          ' unknownFailures=' +
          (s.unknownFailureCount || 0) +
          (s.sampleSavedMediaUrlSanityFailed ? '; a completed write failed media URL sanity' : '') +
          '.';
      }
    }

    /** True when live Firestore doc passes compact canonical gate (optimize/write will skip). */
    function liveDocIsCompactCanonical(item) {
      return Boolean(item && item.compactCheck && item.compactCheck.canSkipWrite === true);
    }

    /** Blocking validation from normalize preview — ignored for buttons/queue when live is already compact. */
    function normalizePreviewBlocking(item) {
      if (!item) return false;
      return item.counts.blocking > 0 && !liveDocIsCompactCanonical(item);
    }

    function coerceAnyTimeToIsoString(v) {
      if (v == null || v === '') return '';
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'object' && v !== null && typeof v.toDate === 'function') {
        try {
          return v.toDate().toISOString();
        } catch (_e) {
          return '';
        }
      }
      if (typeof v === 'object' && v !== null && typeof v.seconds === 'number') {
        var nano = typeof v.nanoseconds === 'number' ? v.nanoseconds : Number(v._nanoseconds || 0);
        return new Date(v.seconds * 1000 + nano / 1e6).toISOString();
      }
      if (typeof v === 'object' && v !== null && typeof v._seconds === 'number') {
        var nano2 = typeof v._nanoseconds === 'number' ? v._nanoseconds : 0;
        return new Date(v._seconds * 1000 + nano2 / 1e6).toISOString();
      }
      return '';
    }

    function mergeQueueSummary(item, patch) {
      if (!patch) return item;
      ['title', 'mediaKind', 'locationName', 'userId', 'schemaVersion'].forEach(function (key) {
        if (typeof patch[key] === 'string' && patch[key].trim()) item[key] = patch[key].trim();
      });
      if (typeof patch.timeDisplay === 'string' && patch.timeDisplay.trim()) {
        item.timeDisplay = patch.timeDisplay.trim();
      }
      if (patch.time != null && patch.time !== '') {
        var isoT = coerceAnyTimeToIsoString(patch.time);
        if (isoT) item.time = isoT;
      }
      if (patch.hasCanonicalSchema !== undefined) item.hasCanonicalSchema = Boolean(patch.hasCanonicalSchema);
      if (patch.exists !== undefined) item.exists = patch.exists;
      return item;
    }

    function getQueueItem(postId) {
      return state.queue.find(function (item) { return item.postId === postId; }) || null;
    }

    function getActiveItem() {
      return state.activePostId ? getQueueItem(state.activePostId) : null;
    }

    function ensureQueueFromSeeds(seeds, append) {
      const queue = append ? state.queue.slice() : [];
      const byId = new Map(queue.map(function (item) { return [item.postId, item]; }));
      seeds.forEach(function (seed) {
        const postId = String(seed.postId || '').trim();
        if (!postId) return;
        let item = byId.get(postId);
        if (!item) {
          item = createQueueItem(postId);
          queue.push(item);
          byId.set(postId, item);
        }
        mergeQueueSummary(item, seed);
      });
      state.queue = queue;
      if (!state.activePostId && state.queue.length) state.activePostId = state.queue[0].postId;
      if (state.activePostId && !getQueueItem(state.activePostId)) {
        state.activePostId = state.queue.length ? state.queue[0].postId : null;
      }
    }

    function setMode(mode) {
      state.mode = mode === 'auto' ? 'auto' : 'manual';
      document.body.dataset.mode = state.mode;
      el('manualMode').classList.toggle('active', state.mode === 'manual');
      el('autoMode').classList.toggle('active', state.mode === 'auto');
      el('modeHint').textContent =
        state.mode === 'manual'
          ? 'Manual mode keeps the original raw / preview / write / backups / revert steps focused on one selected post at a time.'
          : 'Auto mode previews and writes the queue in order, then leaves every post card with a clear status trail.';
      render();
    }

    function setSelectedPost(postId) {
      state.activePostId = postId;
      render();
    }

    function resolveQueueRunRange() {
      const total = state.queue.length;
      if (!total) return { ok: false, message: 'Queue is empty.', startIdx: 0, endIdx: -1 };
      const startRaw = Number(el('queueRangeStart') ? el('queueRangeStart').value : '');
      const endRaw = Number(el('queueRangeEnd') ? el('queueRangeEnd').value : '');
      const hasStart = Number.isFinite(startRaw) && startRaw > 0;
      const hasEnd = Number.isFinite(endRaw) && endRaw > 0;
      const startOneBased = hasStart ? Math.floor(startRaw) : 1;
      const endOneBased = hasEnd ? Math.floor(endRaw) : total;
      if (startOneBased < 1 || startOneBased > total) {
        return { ok: false, message: 'Range start must be between 1 and ' + total + '.', startIdx: 0, endIdx: -1 };
      }
      if (endOneBased < 1 || endOneBased > total) {
        return { ok: false, message: 'Range end must be between 1 and ' + total + '.', startIdx: 0, endIdx: -1 };
      }
      if (endOneBased < startOneBased) {
        return { ok: false, message: 'Range end must be >= range start.', startIdx: 0, endIdx: -1 };
      }
      return {
        ok: true,
        message: '',
        startIdx: startOneBased - 1,
        endIdx: endOneBased - 1
      };
    }

    function summarizeFromPreview(item, data) {
      const canonical = data && data.canonicalPreview ? data.canonicalPreview : {};
      const rawDoc = data && data.raw ? data.raw : {};
      const rawLc = rawDoc.lifecycle || {};
      item.lifecycleDeleted = Boolean(
        rawDoc.deleted ||
          rawDoc.isDeleted ||
          rawLc.isDeleted ||
          String(rawLc.status || '').toLowerCase() === 'deleted' ||
          (canonical.lifecycle &&
            (canonical.lifecycle.isDeleted || String(canonical.lifecycle.status || '').toLowerCase() === 'deleted'))
      );
      const text = canonical.text || {};
      const classification = canonical.classification || {};
      const location = canonical.location || {};
      const display = location.display || {};
      const author = canonical.author || {};
      const schema = canonical.schema || {};
      item.timeDisplay = '';
      mergeQueueSummary(item, {
        title: text.title || item.title,
        mediaKind: classification.mediaKind || item.mediaKind,
        locationName: display.name || item.locationName,
        userId: author.userId || item.userId || (data && data.raw ? data.raw.userId : ''),
        time: pickTimeFromRawOrCanonical(data) || item.time || '',
        schemaVersion: schema.version || item.schemaVersion,
        hasCanonicalSchema: Boolean(schema.version || schema.name)
      });
    }

    function compactStatusBadges(item) {
      const badges = [];
      const ck = item.compactCheck;
      if (!ck) return badges;
      if (ck.canSkipWrite) {
        badges.push(buildBadge('LIVE OK · COMPACT', 'success'));
        if (ck.posterNeedsRepair) badges.push(buildBadge('LIVE COMPACT · POSTER NEEDS REPAIR', 'warning'));
      } else if (ck.compactOk && ck.videoNeedsFaststart) {
        badges.push(buildBadge('LIVE COMPACT · VIDEO NEEDS FASTSTART', 'warning'));
        badges.push(buildBadge('MEDIA REPAIR REQUIRED', 'warning'));
      } else if (ck.compactOk && ck.posterNeedsRepair) {
        badges.push(buildBadge('LIVE COMPACT · POSTER NEEDS REPAIR', 'warning'));
      } else if (ck.compactOk && ck.mediaNeedsRepair) {
        badges.push(buildBadge('STRUCTURE OK', 'neutral'));
        badges.push(buildBadge('ALREADY COMPACT BUT MEDIA NOT READY', 'warning'));
      } else if (ck.compactOk) {
        badges.push(buildBadge('STRUCTURE OK', 'neutral'));
      } else {
        badges.push(buildBadge('LIVE NEEDS WORK', 'danger'));
        if (ck.mediaNeedsRepair) badges.push(buildBadge('MEDIA REPAIR REQUIRED', 'warning'));
        if (ck.needsCompaction) badges.push(buildBadge('NEEDS COMPACTION', 'warning'));
        if (!ck.mediaNeedsRepair && !ck.needsCompaction && !ck.compactOk) {
          badges.push(buildBadge('NEEDS REPAIR', 'danger'));
        }
      }
      if (ck.forbiddenLivePathsPresent && ck.forbiddenLivePathsPresent.length) {
        badges.push(buildBadge('FORBIDDEN ' + ck.forbiddenLivePathsPresent.length, 'danger'));
      }
      return badges;
    }

    function renderQueueCard(item) {
      const badges = [];
      if (item.hasCanonicalSchema) badges.push(buildBadge('CANONICAL', 'info'));
      badges.push.apply(badges, compactStatusBadges(item));
      if (item.lastWriteOutcome === 'already_compact') badges.push(buildBadge('ALREADY COMPACT · SKIPPED', 'neutral'));
      if (item.lastWriteOutcome === 'complete' || item.lastWriteOutcome === 'compacted_manual') {
        badges.push(buildBadge('WRITE OK', 'success'));
      }
      if (item.mediaRepairHappened) {
        badges.push(buildBadge('MEDIA REPAIRED', 'info'));
        badges.push(buildBadge('FASTSTART GENERATED', 'success'));
      }
      if (item.posterRepairApplied) {
        badges.push(buildBadge('POSTER REPAIRED', 'success'));
        badges.push(buildBadge(item.posterRepairSource === 'derived_first_frame_from_video' ? 'POSTER DERIVED FROM VIDEO' : 'POSTER INGESTED', 'info'));
      }
      if (item.faststartVerifyFailed) badges.push(buildBadge('FASTSTART VERIFY FAILED', 'danger'));
      if (item.status.raw === 'success') badges.push(buildBadge('RAW LOADED', 'neutral'));
      if (item.status.raw === 'missing') badges.push(buildBadge('RAW MISSING', 'danger'));
      if (item.previewNormalizeMismatch) {
        badges.push(buildBadge('PREVIEW MISMATCH INFO', 'neutral'));
      }
      if (item.status.preview === 'success') badges.push(buildBadge('PREVIEW OK', 'success'));
      if (item.status.preview === 'warning') badges.push(buildBadge('PREVIEW WARN ONLY', 'warning'));
      if (item.status.preview === 'blocked') badges.push(buildBadge('PREVIEW BLOCKING', 'danger'));
      if (item.status.preview === 'error') badges.push(buildBadge('PREVIEW ERROR', 'danger'));
      if (item.counts.warnings > 0) badges.push(buildBadge('WARN ' + item.counts.warnings, 'warning'));
      if (item.counts.blocking > 0 && !liveDocIsCompactCanonical(item)) {
        badges.push(buildBadge('PREVIEW ' + item.counts.blocking + ' blocking (live not OK)', 'danger'));
      } else if (item.counts.blocking > 0 && liveDocIsCompactCanonical(item)) {
        badges.push(buildBadge('PREVIEW INVALID BUT LIVE OK', 'neutral'));
      }
      if (item.status.write === 'success') badges.push(buildBadge('WRITE OK', 'success'));
      if (item.lifecycleDeleted) badges.push(buildBadge('DELETED POST', 'warning'));
      if (item.status.write === 'skipped' && item.lastWriteOutcome !== 'already_compact') {
        badges.push(buildBadge('WRITE SKIPPED', 'warning'));
      }
      if (item.status.write === 'error') badges.push(buildBadge('WRITE ERROR', 'danger'));
      if (item.backups.length > 0) badges.push(buildBadge('BACKUPS ' + item.backups.length, 'info'));
      if (item.status.preview === 'working' || item.status.write === 'working' || item.status.raw === 'working') {
        badges.push(buildBadge('RUNNING', 'info'));
      }
      const title = item.title || '(untitled / not yet previewed)';
      var timeShown =
        item.timeDisplay && String(item.timeDisplay).trim()
          ? String(item.timeDisplay).trim()
          : formatQueueTime(item.time);
      const meta =
        [item.mediaKind, item.locationName, item.userId, timeShown].filter(Boolean).join(' • ') ||
        'No preview metadata yet.';
      const rm = item.compactLivePreviewSummary && item.compactLivePreviewSummary.removedPathsCount != null
        ? ' · est removed fields: ' + item.compactLivePreviewSummary.removedPathsCount
        : '';
      const bytes = item.compactLivePreviewSummary && item.compactLivePreviewSummary.byteEstimateBefore != null
        ? ' · bytes ~' + item.compactLivePreviewSummary.byteEstimateBefore + '→' +
          (item.compactLivePreviewSummary.byteEstimateAfter != null ? item.compactLivePreviewSummary.byteEstimateAfter : '?')
        : '';
      let noteLine = item.lastError || item.lastMessage || 'Ready.';
      const videoNote =
        item.compactCheck && Array.isArray(item.compactCheck.videoIssues) && item.compactCheck.videoIssues.length
          ? item.compactCheck.videoIssues
              .map(function (vi) {
                return vi.summary || '';
              })
              .filter(Boolean)
              .join(' ')
          : '';
      if (videoNote) {
        noteLine = videoNote;
      } else if (liveDocIsCompactCanonical(item) && item.previewNormalizeMismatch) {
        noteLine =
          'Live doc is production-ready. Preview normalize disagrees — ignore red preview unless compact check fails.';
      }
      const note = noteLine + rm + bytes;
      return ''
        + '<button class="queue-card' + (state.activePostId === item.postId ? ' active' : '') + '" data-post-id="' + escapeHtml(item.postId) + '">'
        +   '<h3>' + escapeHtml(item.postId) + '</h3>'
        +   '<p><strong>' + escapeHtml(title) + '</strong></p>'
        +   '<p>' + escapeHtml(meta) + '</p>'
        +   '<div class="badge-row">' + badges.join('') + '</div>'
        +   '<p style="margin-top:10px">' + escapeHtml(note) + '</p>'
        + '</button>';
    }

    function renderQueue() {
      el('queueList').innerHTML = state.queue.map(renderQueueCard).join('');
      el('queueStatusHint').textContent = state.queue.length
        ? (state.auto.running
            ? 'Auto run is active. The selected card will follow the queue as each post is processed.'
            : 'Queue ready. Select any post card to inspect the full migration details.')
        : 'Queue is empty. Add post IDs or load newest posts to get started.';
    }

    function renderStats() {
      const previewReadyCount = state.queue.filter(function (item) {
        return item.status.preview === 'success' || item.status.preview === 'warning';
      }).length;
      const compactWriteOkCount = state.queue.filter(function (item) {
        return item.lastWriteOutcome === 'complete' || item.lastWriteOutcome === 'compacted_manual';
      }).length;
      const compactSkipCount = state.queue.filter(function (item) {
        return item.lastWriteOutcome === 'already_compact';
      }).length;
      const mediaRepairCount = state.queue.filter(function (item) { return item.mediaRepairHappened; }).length;
      const posterRepairCount = state.queue.filter(function (item) { return item.posterRepairApplied; }).length;
      const posterRepairFailedCount = state.queue.filter(function (item) {
        return item.status.write === 'error' && String(item.lastError || '').indexOf('poster_repair_failed') >= 0;
      }).length;
      const externalPosterSkippedCount = state.queue.filter(function (item) {
        return item.compactCheck && item.compactCheck.posterNeedsRepair === true && item.status.write !== 'success';
      }).length;
      const videoFaststartPendingCount = state.queue.filter(function (item) {
        return item.compactCheck && item.compactCheck.compactOk === true && item.compactCheck.videoNeedsFaststart === true;
      }).length;
      const problemCount = state.queue.filter(function (item) {
        if (item.status.write === 'error' || item.status.preview === 'error') return true;
        if (normalizePreviewBlocking(item)) return true;
        return false;
      }).length;
      el('queueCount').textContent = String(state.queue.length);
      el('previewReadyCount').textContent = String(previewReadyCount);
      el('compactWriteOkCount').textContent = String(compactWriteOkCount);
      el('compactSkipCount').textContent = String(compactSkipCount);
      el('mediaRepairCount').textContent = String(mediaRepairCount);
      if (el('posterRepairCount')) el('posterRepairCount').textContent = String(posterRepairCount);
      if (el('posterRepairFailedCount')) el('posterRepairFailedCount').textContent = String(posterRepairFailedCount);
      if (el('externalPosterSkippedCount')) el('externalPosterSkippedCount').textContent = String(externalPosterSkippedCount);
      if (el('videoFaststartPendingCount')) {
        el('videoFaststartPendingCount').textContent = String(videoFaststartPendingCount);
      }
      el('problemCount').textContent = String(problemCount);
    }

    function renderSelected() {
      const item = getActiveItem();
      if (!item) {
        el('selectedSummary').innerHTML = ''
          + '<div class="selected-head">'
          +   '<div>'
          +     '<div class="selected-overline">Selected Post</div>'
          +     '<h2>No post selected</h2>'
          +     '<p class="muted" style="margin-top:8px">Load a queue and click a post card to inspect its migration details.</p>'
          +   '</div>'
          + '</div>';
        el('backupSelect').innerHTML = '';
        el('diff').textContent = 'Select a post from the queue.';
        el('validation').textContent = 'Select a post from the queue.';
        el('engagementAudit').textContent = 'Select a post from the queue.';
        el('media').textContent = 'Select a post from the queue.';
        el('engagement').textContent = 'Select a post from the queue.';
        el('location').textContent = 'Select a post from the queue.';
        el('raw').value = '';
        el('canonical').value = '';
        el('processing').value = '';
        el('compactCheck').textContent = 'Select a post from the queue.';
        return;
      }

      const badges = [];
      if (item.compactCheck && item.compactCheck.canSkipWrite) badges.push(buildBadge('LIVE OK · COMPACT', 'success'));
      else if (item.compactCheck && item.compactCheck.compactOk && item.compactCheck.videoNeedsFaststart) {
        badges.push(buildBadge('LIVE COMPACT · VIDEO NEEDS FASTSTART', 'warning'));
        badges.push(buildBadge('MEDIA REPAIR REQUIRED', 'warning'));
      } else if (item.compactCheck && item.compactCheck.compactOk) {
        badges.push(buildBadge('STRUCTURE OK · NOT READY TO SKIP', 'warning'));
      }
      if (item.previewNormalizeMismatch) badges.push(buildBadge('PREVIEW MISMATCH INFO', 'neutral'));
      if (item.status.preview === 'success') badges.push(buildBadge('PREVIEW OK', 'success'));
      if (item.status.preview === 'warning') badges.push(buildBadge('PREVIEW WARN ONLY', 'warning'));
      if (item.status.preview === 'blocked') badges.push(buildBadge('PREVIEW BLOCKING', 'danger'));
      if (item.lifecycleDeleted) badges.push(buildBadge('DELETED POST', 'warning'));
      if (item.status.write === 'success') badges.push(buildBadge('WRITE COMPLETE', 'success'));
      if (item.status.write === 'error') badges.push(buildBadge('WRITE ERROR', 'danger'));
      if (item.backups.length > 0) badges.push(buildBadge('BACKUP READY', 'info'));

      const title = item.title || '(untitled / not yet previewed)';
      const summaryHtml = ''
        + '<div class="selected-head">'
        +   '<div>'
        +     '<div class="selected-overline">Selected Post</div>'
        +     '<h2>' + escapeHtml(item.postId) + '</h2>'
        +     '<p class="muted" style="margin-top:8px">' + escapeHtml(title) + '</p>'
        +   '</div>'
        +   '<div class="badge-row">' + badges.join('') + '</div>'
        + (item.lifecycleDeleted
          ? '<p class="muted" style="margin-top:8px">Lifecycle: <strong>deleted</strong> — preview/write must preserve deleted status.</p>'
          : '')
        + '</div>'
        + '<div class="summary-grid">'
        +   '<div class="summary-chip"><span>Media Kind</span><strong>' + escapeHtml(item.mediaKind || 'Unknown') + '</strong></div>'
        +   '<div class="summary-chip"><span>Warnings</span><strong>' + escapeHtml(item.counts.warnings || 0) + '</strong></div>'
        +   '<div class="summary-chip"><span>Blocking (preview)</span><strong>' +
              escapeHtml(
                item.counts.blocking > 0 && liveDocIsCompactCanonical(item)
                  ? String(item.counts.blocking) + ' — live OK, informational'
                  : String(item.counts.blocking || 0)
              ) + '</strong></div>'
        +   '<div class="summary-chip"><span>Latest Backup</span><strong>' + escapeHtml(item.backupId || item.backupSelection || 'None') + '</strong></div>'
        +   '<div class="summary-chip"><span>Author</span><strong>' + escapeHtml(item.userId || 'Unknown') + '</strong></div>'
        +   '<div class="summary-chip"><span>Location</span><strong>' + escapeHtml(item.locationName || 'Unknown') + '</strong></div>'
        +   '<div class="summary-chip"><span>Previewed At</span><strong>' + escapeHtml(item.lastPreviewedAt || 'Not yet') + '</strong></div>'
        +   '<div class="summary-chip"><span>Write Status</span><strong>' + escapeHtml(item.lastError || item.lastMessage || 'Idle') + '</strong></div>'
        + '</div>';
      el('selectedSummary').innerHTML = summaryHtml;

      const backupSelect = el('backupSelect');
      backupSelect.innerHTML = '';
      if (!item.backups.length) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'No backups loaded';
        backupSelect.appendChild(placeholder);
      } else {
        item.backups.forEach(function (backup) {
          const option = document.createElement('option');
          option.value = backup.backupId;
          option.textContent = backup.backupId;
          if (item.backupSelection && item.backupSelection === backup.backupId) option.selected = true;
          backupSelect.appendChild(option);
        });
      }

      el('diff').textContent = json(item.diffSummary || {});
      el('validation').textContent = json({
        previewValidation: item.validation || null,
        generationFailureDetail: item.generationFailureDetail || null
      });
      el('engagementAudit').textContent = json(item.engagementSourceAudit || null);
      el('media').textContent = json(item.mediaView || null);
      el('engagement').textContent = json(item.engagementView || null);
      el('location').textContent = json(item.locationView || null);
      el('raw').value = json(item.raw || null);
      el('canonical').value = json(item.canonicalPreview || null);
      el('processing').value = json(item.mediaProcessingDebugPreview || null);
      el('compactCheck').textContent = json({
        compactCheck: item.compactCheck,
        compactOk: item.compactCheck ? item.compactCheck.compactOk : null,
        canSkipWrite: item.compactCheck ? item.compactCheck.canSkipWrite : null,
        mediaNeedsRepair: item.compactCheck ? item.compactCheck.mediaNeedsRepair : null,
        videoNeedsFaststart: item.compactCheck ? item.compactCheck.videoNeedsFaststart : null,
        videoIssueCount: item.compactCheck ? item.compactCheck.videoIssueCount : null,
        posterNeedsRepair: item.compactCheck ? item.compactCheck.posterNeedsRepair : null,
        posterRepairReason: item.compactCheck ? item.compactCheck.posterRepairReason : null,
        videoIssues: item.compactCheck ? item.compactCheck.videoIssues : null,
        failureClassification: item.failureClassification || null,
        savedMediaUrlSanity: item.savedMediaUrlSanity,
        compactLivePreviewSummary: item.compactLivePreviewSummary,
        lastWriteOutcome: item.lastWriteOutcome,
        lastBackupPath: item.lastBackupPath || null,
        lastDiagnosticsPath: item.lastDiagnosticsPath || null
      });
    }

    function renderButtons() {
      const item = getActiveItem();
      const queueEmpty = state.queue.length === 0;
      const busy = state.auto.running || state.manualQueue.running;
      const hasBlocking = normalizePreviewBlocking(item);
      el('loadRawSelected').disabled = !item || busy;
      el('previewSelected').disabled = !item || busy;
      el('generateFastStartsSelected').disabled = !item || busy;
      el('optimizeWriteSelected').disabled = !item || busy;
      el('optimizeWriteQueueManual').disabled = queueEmpty || busy;
      el('writeSelected').disabled =
        !item || busy || !item.rawHash || hasBlocking || item.status.preview === 'working' || Boolean(item.generatedRepairPendingWrite);
      el('backupsSelected').disabled = !item || busy;
      el('revertSelected').disabled = !item || busy || !item.backupSelection;
      el('autoPreviewQueue').disabled = queueEmpty || busy;
      el('autoPreviewWriteQueue').disabled = queueEmpty || busy;
      el('stopAuto').disabled = !busy;
      el('loadIds').disabled = busy;
      el('clearQueue').disabled = busy && queueEmpty;
      el('loadNewest').disabled = busy;
      el('cancelRunning').disabled =
        !state.inFlightAbort && !state.manualQueue.running && !state.auto.running;
    }

    function render() {
      renderStats();
      renderQueue();
      renderSelected();
      renderButtons();
      renderMigrationGateAndFailureReport();
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options || {});
      let data = null;
      try {
        data = await response.json();
      } catch (_error) {
        data = null;
      }
      if (!response.ok) {
        const message =
          (data && typeof data.error === 'string' && data.error) ||
          (data && data.error && typeof data.error.message === 'string' && data.error.message) ||
          ('request_failed_' + response.status);
        const error = new Error(message);
        error.statusCode = response.status;
        error.body = data;
        throw error;
      }
      return data;
    }

    function formatOptimizeProgressLine(msg) {
      const parts = [];
      if (msg.stage) parts.push(String(msg.stage));
      if (msg.detail) parts.push(String(msg.detail));
      if (msg.assetId) parts.push('asset=' + String(msg.assetId));
      if (msg.index != null && msg.total != null) {
        parts.push('(' + String(msg.index) + '/' + String(msg.total) + ')');
      }
      return parts.join(' · ');
    }

    function mergeAbortSignals(primary, secondary) {
      const merged = new AbortController();
      const onAbort = function () {
        try {
          merged.abort();
        } catch (_e) {}
      };
      if (primary && primary.aborted) {
        onAbort();
        return merged.signal;
      }
      if (secondary && secondary.aborted) {
        onAbort();
        return merged.signal;
      }
      if (primary) primary.addEventListener('abort', onAbort);
      if (secondary) secondary.addEventListener('abort', onAbort);
      return merged.signal;
    }

    async function fetchOptimizeWriteNdjson(postId, item, signal) {
      const timeoutCtrl = new AbortController();
      const timeoutMs = 900000;
      const timeoutId = setTimeout(function () {
        try {
          timeoutCtrl.abort();
        } catch (_e) {}
      }, timeoutMs);
      const mergedSignal = mergeAbortSignals(signal, timeoutCtrl.signal);
      try {
        const res = await fetch(
          '/debug/post-rebuilder/' + encodeURIComponent(postId) + '/optimize-and-write?stream=1',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ strict: true }),
            signal: mergedSignal
          }
        );
        if (!res.ok) {
          let data = null;
          try {
            data = await res.json();
          } catch (_err) {}
          const message =
            (data && typeof data.error === 'string' && data.error) ||
            (data && data.error && typeof data.error.message === 'string' && data.error.message) ||
            ('request_failed_' + res.status);
          const error = new Error(message);
          error.statusCode = res.status;
          error.body = data;
          throw error;
        }
        if (!res.body) throw new Error('no_response_body');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let msg;
            try {
              msg = JSON.parse(line);
            } catch (_err) {
              pushTopConsole('ndjson_parse_skip ' + line.slice(0, 96), item.postId);
              continue;
            }
            if (msg.type === 'progress') {
              const human = formatOptimizeProgressLine(msg);
              item.lastMessage = human;
              item.status.write = 'working';
              pushTopConsole(human, item.postId);
              render();
            } else if (msg.type === 'done') {
              finalResult = msg.result;
            } else if (msg.type === 'error') {
              throw new Error(msg.message || 'stream_error');
            }
          }
        }
        if (!finalResult) throw new Error('optimize_stream_no_result');
        return finalResult;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    function abortInFlightSilently() {
      if (state.inFlightAbort) {
        try {
          state.inFlightAbort.abort();
        } catch (_err) {}
        state.inFlightAbort = null;
      }
      state.auto.running = false;
      state.manualQueue.running = false;
    }

    function cancelInFlight() {
      abortInFlightSilently();
      addLog('Cancel / stop requested.');
      render();
    }

    function setActionState(item, action, nextState, note) {
      item.status[action] = nextState;
      item.lastMessage = note || item.lastMessage;
      if (nextState !== 'error') item.lastError = '';
      render();
    }

    function hydratePreviewViews(item, data) {
      const canonical = data.canonicalPreview || {};
      const media = canonical.media || {};
      const mediaAssets = (media.assets || []).map(function (asset) {
        if (asset.type === 'video') {
          return {
            id: asset.id,
            type: asset.type,
            default: asset.video && asset.video.playback ? asset.video.playback.defaultUrl : undefined,
            primary: asset.video && asset.video.playback ? asset.video.playback.primaryUrl : undefined,
            startup: asset.video && asset.video.playback ? asset.video.playback.startupUrl : undefined,
            highQuality: asset.video && asset.video.playback ? asset.video.playback.highQualityUrl : undefined,
            upgrade: asset.video && asset.video.playback ? asset.video.playback.upgradeUrl : undefined,
            hls: asset.video && asset.video.playback ? asset.video.playback.hlsUrl : undefined,
            fallback: asset.video && asset.video.playback ? asset.video.playback.fallbackUrl : undefined,
            preview: asset.video && asset.video.playback ? asset.video.playback.previewUrl : undefined
          };
        }
        return {
          id: asset.id,
          type: asset.type,
          width: asset.image ? asset.image.width : undefined,
          height: asset.image ? asset.image.height : undefined,
          aspectRatio: asset.image ? asset.image.aspectRatio : undefined,
          display: asset.image ? asset.image.displayUrl : undefined,
          thumbnail: asset.image ? asset.image.thumbnailUrl : undefined,
          original: asset.image ? asset.image.originalUrl : undefined
        };
      });
      item.mediaView = {
        cover: media.cover,
        assetCount: media.assetCount,
        assetsReady: media.assetsReady,
        instantPlaybackReady: media.instantPlaybackReady,
        rawAssetCount: media.rawAssetCount,
        hasMultipleAssets: media.hasMultipleAssets,
        primaryAssetId: media.primaryAssetId,
        coverAssetId: media.coverAssetId,
        coverDimensions: {
          width: media.cover ? media.cover.width : undefined,
          height: media.cover ? media.cover.height : undefined,
          aspectRatio: media.cover ? media.cover.aspectRatio : undefined
        },
        completeness: media.completeness,
        assets: mediaAssets,
        faststartVerified: mediaAssets
          .filter(function (asset) { return asset.type === 'video'; })
          .map(function (asset) {
            const fullAsset = (media.assets || []).find(function (value) { return value.id === asset.id; });
            return asset.id + ':' + String(fullAsset && fullAsset.video && fullAsset.video.readiness ? fullAsset.video.readiness.faststartVerified : false);
          })
      };
      item.engagementView = {
        oldLikesArrayCount: Array.isArray(data.raw && data.raw.likes) ? data.raw.likes.length : 0,
        oldCommentsArrayCount: Array.isArray(data.raw && data.raw.comments) ? data.raw.comments.length : 0,
        canonicalLikeCount: canonical.engagement ? canonical.engagement.likeCount : undefined,
        canonicalCommentCount: canonical.engagement ? canonical.engagement.commentCount : undefined,
        recentLikers: canonical.engagementPreview ? canonical.engagementPreview.recentLikers : undefined,
        recentComments: canonical.engagementPreview ? canonical.engagementPreview.recentComments : undefined,
        preservationNote: 'Likers/comments previews mirror production fields; full arrays remain in backup/raw + legacy summaries — canonical stores counts + small preview slices only.'
      };
      item.locationView = {
        old: {
          lat: data.raw ? data.raw.lat : undefined,
          long: data.raw ? data.raw.long : undefined,
          lng: data.raw ? data.raw.lng : undefined,
          geohash: data.raw ? data.raw.geohash : undefined,
          address: data.raw ? data.raw.address : undefined
        },
        canonical: canonical.location,
        note: 'location.display.name is place/address UI — text.title is the post title only.'
      };
    }

    async function loadRawForItem(item) {
      setActionState(item, 'raw', 'working', 'Loading raw...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/raw');
        item.exists = Boolean(data.exists);
        item.rawHash = data.rawHash || null;
        item.raw = data.raw || null;
        item.status.raw = data.exists ? 'success' : 'missing';
        item.lastMessage = data.exists ? 'Raw loaded.' : 'Post was not found.';
        mergeQueueSummary(item, { exists: data.exists });
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.raw = 'error';
        item.lastError = error.message || 'raw_load_failed';
        addLog('Raw load failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function previewItem(item) {
      setActionState(item, 'preview', 'working', 'Previewing canonical rebuild...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/preview', { method: 'POST' });
        item.exists = Boolean(data.raw);
        item.rawHash = data.rawHash || null;
        item.raw = data.raw || null;
        item.canonicalPreview = data.canonicalPreview || null;
        item.mediaProcessingDebugPreview = data.mediaProcessingDebugPreview || null;
        item.engagementSourceAudit = data.engagementSourceAudit || null;
        item.diffSummary = data.diffSummary || {};
        item.validation = data.validation || null;
        item.previewChecks = data.previewChecks || null;
        item.compactCheck = data.compactCheck || null;
        const clp = data.compactLivePreview;
        item.compactLivePreviewSummary = clp
          ? {
              byteEstimateBefore: clp.byteEstimateBefore,
              byteEstimateAfter: clp.byteEstimateAfter,
              removedPathsCount: Array.isArray(clp.removedPaths) ? clp.removedPaths.length : null,
              removedPathsSample: Array.isArray(clp.removedPaths) ? clp.removedPaths.slice(0, 24) : [],
              diagnosticsKeys: clp.diagnostics && typeof clp.diagnostics === 'object' ? Object.keys(clp.diagnostics).slice(0, 40) : []
            }
          : null;
        item.counts = {
          warnings: Array.isArray(data.validation && data.validation.warnings) ? data.validation.warnings.length : 0,
          blocking: Array.isArray(data.validation && data.validation.blockingErrors) ? data.validation.blockingErrors.length : 0
        };
        const liveOk = liveDocIsCompactCanonical(item);
        item.previewNormalizeMismatch = Boolean(liveOk && item.counts.blocking > 0);
        if (liveOk) {
          item.status.preview = item.counts.warnings > 0 ? 'warning' : 'success';
          if (item.previewNormalizeMismatch) {
            item.lastMessage =
              'Preview mismatch only — live compact doc is valid. Normalize preview disagrees; trust saved live compact + post-write checks for write success.';
          } else if (item.counts.warnings > 0) {
            item.lastMessage = 'Live compact OK. Preview has warnings only.';
          } else {
            item.lastMessage = 'Live compact OK — nothing to write.';
          }
        } else {
          item.previewNormalizeMismatch = false;
          item.status.preview = item.counts.blocking > 0 ? 'blocked' : (item.counts.warnings > 0 ? 'warning' : 'success');
          let compactNote = '';
          if (item.compactCheck) {
            if (item.compactCheck.mediaNeedsRepair) compactNote = ' VIDEO NEEDS FASTSTART.';
            else if (item.compactCheck.needsCompaction) compactNote = ' NEEDS COMPACTION.';
            else if (!item.compactCheck.compactOk) compactNote = ' NEEDS REPAIR.';
            else if (!item.compactCheck.canSkipWrite) compactNote = ' MEDIA / PLAYBACK NOT READY.';
          }
          item.lastMessage =
            item.status.preview === 'blocked'
              ? 'Preview blocking — live doc needs Optimize + Write (or media repair).' + compactNote
              : item.status.preview === 'warning'
                ? 'Preview finished with warnings.' + compactNote
                : 'Preview ready.' + compactNote;
        }
        item.generatedRepairPendingWrite = false;
        item.lastPreviewedAt = nowLabel();
        summarizeFromPreview(item, data);
        hydratePreviewViews(item, data);
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.preview = 'error';
        item.lastError = error.message || 'preview_failed';
        addLog('Preview failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function generateFastStartsForItem(item) {
      setActionState(item, 'preview', 'working', 'Analyzing + generating missing fast starts...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/preview-after-fast-starts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dryRun: true })
        });
        item.exists = Boolean(data.raw);
        item.rawHash = data.rawHash || null;
        item.raw = data.raw || null;
        item.canonicalPreview = data.canonicalPreview || null;
        item.diffSummary = data.diffSummary || {};
        item.validation = data.validation || null;
        item.counts = {
          warnings: Array.isArray(data.validation && data.validation.warnings) ? data.validation.warnings.length : 0,
          blocking: Array.isArray(data.validation && data.validation.blockingErrors) ? data.validation.blockingErrors.length : 0
        };
        item.compactCheck = data.compactCheckPreview || data.compactVerified || item.compactCheck;
        const liveOkFs = liveDocIsCompactCanonical(item);
        item.previewNormalizeMismatch = Boolean(liveOkFs && item.counts.blocking > 0);
        if (liveOkFs) {
          item.status.preview = item.counts.warnings > 0 ? 'warning' : 'success';
          item.lastMessage = item.previewNormalizeMismatch
            ? 'Preview mismatch only — repaired preview disagrees but live/repaired shape is compact OK. Use Optimize + Write when ready.'
            : 'Fast-start preview ready (dry run). Live compact OK.';
        } else {
          item.previewNormalizeMismatch = false;
          item.status.preview = item.counts.blocking > 0 ? 'blocked' : (item.counts.warnings > 0 ? 'warning' : 'success');
          item.lastMessage = 'Generated missing fast starts preview is ready. Use Optimize + Write Selected for safe write.';
        }
        item.lastPreviewedAt = nowLabel();
        item.generatedRepairPendingWrite = true;
        summarizeFromPreview(item, data);
        hydratePreviewViews(item, data);
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.preview = 'error';
        item.lastError = error.message || 'generate_fast_starts_failed';
        addLog('Generate missing fast starts failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function listBackupsForItem(item) {
      setActionState(item, 'backups', 'working', 'Loading backups...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/backups');
        item.backups = Array.isArray(data.backups) ? data.backups : [];
        item.backupSelection = item.backups.length ? item.backups[0].backupId : '';
        item.status.backups = 'success';
        item.lastMessage = item.backups.length ? 'Loaded ' + item.backups.length + ' backups.' : 'No backups found.';
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.backups = 'error';
        item.lastError = error.message || 'backup_list_failed';
        addLog('Backup load failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function writeItem(item) {
      if (!item.rawHash) {
        alert('Preview selected post first.');
        return null;
      }
      if (item.generatedRepairPendingWrite) {
        alert('Use Optimize + Write Selected to safely write generated fast-start results.');
        return null;
      }
      if (normalizePreviewBlocking(item)) {
        alert('Selected post has blocking preview validation and live doc is not compact OK. Use Optimize + Write or fix the post first.');
        return null;
      }
      const force = false;
      setActionState(item, 'write', 'working', 'Writing canonical fields...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedHash: item.rawHash,
            mode: 'additiveCanonicalFieldsOnly',
            force: force
          })
        });
        if (data.status === 'already_compact_canonical') {
          item.status.write = 'skipped';
          item.lastWriteOutcome = 'already_compact';
          item.compactCheck = data.compactCheck || item.compactCheck;
          item.savedMediaUrlSanity = data.savedMediaUrlSanity || null;
          item.lastMessage = 'ALREADY COMPACT — WRITE SKIPPED (no backup, no Firestore write).';
          item.lastBackupPath = '';
          item.lastDiagnosticsPath = '';
          addLog(item.lastMessage, item.postId);
          render();
          return data;
        }
        if (data.status !== 'compacted_write_ok') {
          item.status.write = 'error';
          item.lastWriteOutcome = 'error';
          item.lastError = String(data.status || 'write_failed');
          addLog('Write failed: ' + item.lastError, item.postId);
          render();
          throw new Error(item.lastError);
        }
        item.status.write = 'success';
        item.lastWriteOutcome = 'compacted_manual';
        const wTail = data.backupPath ? String(data.backupPath).split('/').pop() : '';
        item.backupId = wTail || data.backupId || '';
        item.lastWrittenAt = nowLabel();
        item.lastBackupPath = data.backupPath || '';
        item.lastDiagnosticsPath = wTail ? ('postCanonicalDiagnostics/' + wTail) : '';
        item.lastMessage = 'COMPACTED WRITE OK — ' + (data.backupPath || data.backupId || 'ok');
        if (item.backupId) {
          item.backups = [{ backupId: item.backupId }].concat(item.backups.filter(function (backup) {
            return backup.backupId !== item.backupId;
          }));
          item.backupSelection = item.backupId;
        }
        if (data.byteEstimateBefore != null) {
          item.compactLivePreviewSummary = {
            byteEstimateBefore: data.byteEstimateBefore,
            byteEstimateAfter: data.byteEstimateAfter,
            removedPathsCount: Array.isArray(data.removedPaths) ? data.removedPaths.length : null
          };
        }
        addLog(item.lastMessage, item.postId);
        await previewItem(item);
        render();
        return data;
      } catch (error) {
        item.status.write = 'error';
        item.lastError = error.message || 'write_failed';
        if (error.body && error.body.error === 'stale_hash') {
          item.lastError = (error.body.message || 'Preview is stale. Reload/preview again, or use Optimize + Write Selected for one-step fresh optimize/write.');
        }
        if (error.body && error.body.validation) {
          item.validation = error.body.validation;
          item.counts.blocking = Array.isArray(error.body.validation.blockingErrors) ? error.body.validation.blockingErrors.length : item.counts.blocking;
          item.counts.warnings = Array.isArray(error.body.validation.warnings) ? error.body.validation.warnings.length : item.counts.warnings;
        }
        addLog('Write failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function revertItem(item) {
      if (!item.backupSelection) {
        alert('Select a backup first.');
        return null;
      }
      if (!window.confirm('Revert selected post to backup ' + item.backupSelection + '?')) return null;
      setActionState(item, 'revert', 'working', 'Reverting post to selected backup...');
      try {
        const data = await fetchJson('/debug/post-rebuilder/' + encodeURIComponent(item.postId) + '/revert', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ backupId: item.backupSelection })
        });
        item.status.revert = 'success';
        item.lastMessage = 'Reverted from backup ' + item.backupSelection + '.';
        addLog(item.lastMessage, item.postId);
        render();
        return data;
      } catch (error) {
        item.status.revert = 'error';
        item.lastError = error.message || 'revert_failed';
        addLog('Revert failed: ' + item.lastError, item.postId);
        render();
        throw error;
      }
    }

    async function loadNewestPosts() {
      const fromRank = Math.max(1, Math.floor(Number(el('newestFromRank').value || 1)));
      const count = Math.min(${POST_REBUILDER_RANK_QUERY_LIMIT_MAX}, Math.max(1, Math.floor(Number(el('newestCount').value || 12))));
      const offset = fromRank - 1;
      const append = Boolean(el('appendQueue').checked);
      const data = await fetchJson(
        '/debug/post-rebuilder/posts?offset=' +
          encodeURIComponent(String(offset)) +
          '&limit=' +
          encodeURIComponent(String(count))
      );
      ensureQueueFromSeeds((data.posts || []).map(function (post) { return post; }), append);
      el('postIdsInput').value = state.queue.map(function (item) { return item.postId; }).join(', ');
      const n = (data.posts || []).length;
      const endRank = n ? fromRank + n - 1 : fromRank - 1;
      addLog('Loaded ' + String(n) + ' post(s) from Firestore rank #' + fromRank + (n ? '–#' + endRank : '') + '.');
      render();
    }

    function loadIdsIntoQueue() {
      const postIds = dedupePostIds(el('postIdsInput').value);
      if (!postIds.length) {
        alert('Paste one or more post IDs first.');
        return;
      }
      const append = Boolean(el('appendQueue').checked);
      ensureQueueFromSeeds(postIds.map(function (postId) { return { postId: postId }; }), append);
      addLog('Queued ' + postIds.length + ' post id' + (postIds.length === 1 ? '' : 's') + '.');
      render();
    }

    function clearQueue() {
      abortInFlightSilently();
      state.queue = [];
      state.activePostId = null;
      el('postIdsInput').value = '';
      addLog('Cleared queue.');
      render();
    }

    async function runAutoSequence(withWrite) {
      const range = resolveQueueRunRange();
      if (!range.ok) {
        alert(range.message);
        return;
      }
      if (state.inFlightAbort) {
        try {
          state.inFlightAbort.abort();
        } catch (_err) {}
        state.inFlightAbort = null;
      }
      state.inFlightAbort = new AbortController();
      const opSignal = state.inFlightAbort.signal;
      state.auto.running = true;
      state.auto.kind = withWrite ? 'preview_write' : 'preview';
      addLog(
        (withWrite ? 'Started auto preview + write queue.' : 'Started auto preview queue.') +
          ' Range: ' + (range.startIdx + 1) + '-' + (range.endIdx + 1) + '.'
      );
      render();
      try {
        for (let i = range.startIdx; i <= range.endIdx; i++) {
          const item = state.queue[i];
          if (!state.auto.running) break;
          setSelectedPost(item.postId);
          pushTopConsole(
            "queue progress: " + (i + 1) + "/" + state.queue.length,
            item.postId
          );
          try {
            if (state.auto.generateFastStarts) {
              if (withWrite) {
                await optimizeWriteItem(item, { signal: opSignal });
                continue;
              }
              await generateFastStartsForItem(item);
            } else {
              await previewItem(item);
            }
            if (withWrite) {
              if (normalizePreviewBlocking(item)) {
                item.status.write = 'skipped';
                item.lastMessage = 'Write skipped — live doc not compact OK and preview has blocking errors.';
                addLog(item.lastMessage, item.postId);
                render();
                continue;
              }
              await writeItem(item);
            }
          } catch (_error) {
            if (!state.auto.running) break;
          }
        }
      } finally {
        const stoppedEarly = !state.auto.running;
        state.auto.running = false;
        state.auto.kind = null;
        state.inFlightAbort = null;
        addLog(stoppedEarly ? 'Auto run stopped.' : 'Auto run finished.');
        render();
      }
    }

    el('queueList').addEventListener('click', function (event) {
      const card = event.target.closest('[data-post-id]');
      if (!card) return;
      const postId = card.getAttribute('data-post-id');
      if (postId) setSelectedPost(postId);
    });

    el('backupSelect').addEventListener('change', function () {
      const item = getActiveItem();
      if (!item) return;
      item.backupSelection = el('backupSelect').value;
      renderButtons();
    });

    el('manualMode').onclick = function () { setMode('manual'); };
    el('autoMode').onclick = function () { setMode('auto'); };
    el('loadIds').onclick = function () { loadIdsIntoQueue(); };
    el('clearQueue').onclick = function () { clearQueue(); };
    el('loadNewest').onclick = async function () {
      try {
        await loadNewestPosts();
      } catch (error) {
        addLog('Newest-post load failed: ' + (error.message || 'request_failed'));
      }
    };

    el('loadRawSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await loadRawForItem(item);
      } catch (_error) {}
    };
    el('previewSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await previewItem(item);
      } catch (_error) {}
    };
    el('generateFastStartsSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await generateFastStartsForItem(item);
      } catch (_error) {}
    };
    async function optimizeWriteItem(item, runOpts) {
      const externalSignal = runOpts && runOpts.signal;
      const ownsAbort = !externalSignal;
      if (ownsAbort) {
        if (state.inFlightAbort) {
          try {
            state.inFlightAbort.abort();
          } catch (_err) {}
        }
        state.inFlightAbort = new AbortController();
      }
      const signal = externalSignal || state.inFlightAbort.signal;
      setActionState(item, 'write', 'working', 'Optimize+Write (live progress)…');
      pushTopConsole('optimize+write NDJSON stream open', item.postId);
      try {
        const data = await fetchOptimizeWriteNdjson(item.postId, item, signal);
        if (data.status === 'post_not_found') {
          item.status.write = 'error';
          item.lastError = 'post_not_found';
          item.lastWriteOutcome = 'error';
          item.failureClassification = null;
          addLog('Optimize+Write: post not found.', item.postId);
          render();
          throw new Error('post_not_found');
        }
        if (data.status === 'already_compact_canonical') {
          item.status.write = 'skipped';
          item.lastWriteOutcome = 'already_compact';
          item.compactCheck = data.compactCheck || item.compactCheck;
          item.savedMediaUrlSanity = data.savedMediaUrlSanity || null;
          item.lastMessage = 'ALREADY COMPACT — WRITE SKIPPED (no backup, no Firestore write, no auto-preview).';
          item.lastBackupPath = '';
          item.lastDiagnosticsPath = '';
          item.mediaRepairHappened = false;
          item.failureClassification = null;
          if (data.byteEstimateBefore != null) {
            item.compactLivePreviewSummary = {
              byteEstimateBefore: data.byteEstimateBefore,
              byteEstimateAfter: data.byteEstimateAfter,
              removedPathsCount: 0
            };
          }
          pushTopConsole('optimize+write: already compact, skipped', item.postId);
          addLog(item.lastMessage, item.postId);
          render();
          return data;
        }
        if (data.status !== 'complete') {
          item.failureClassification = data.failureClassification || null;
          item.status.write = 'error';
          item.lastError = String(data.status || 'failed');
          item.lastWriteOutcome = 'error';
          item.faststartVerifyFailed =
            String(data.status || '').indexOf('verify') >= 0 ||
            String(data.status || '') === 'generation_failed' ||
            String(data.status || '') === 'post_write_verification_failed';
          item.generationFailureDetail = data.generationFailureDetail || null;
          if (data.generationFailureDetail && data.status === 'generation_failed') {
            const g = data.generationFailureDetail;
            const n = Array.isArray(g.perAsset) ? g.perAsset.length : 0;
            item.lastError =
              'generation_failed: ' +
              String(g.reason || 'strict_repair') +
              ' — blocking assets=' +
              String(n) +
              (Array.isArray(g.generationErrorsDistinct) && g.generationErrorsDistinct.length
                ? ' — errors: ' + g.generationErrorsDistinct.slice(0, 6).join('; ')
                : '');
          }
          if (data.savedMediaUrlSanity) item.savedMediaUrlSanity = data.savedMediaUrlSanity;
          if (data.savedCompactCheck) item.compactCheck = data.savedCompactCheck;
          if (data.savedRaw) item.raw = data.savedRaw;
          if (data.raw) item.raw = data.raw;
          if (data.canonicalPreview) item.canonicalPreview = data.canonicalPreview;
          if (data.validation) {
            item.validation = data.validation;
            item.counts = {
              warnings: Array.isArray(data.validation.warnings) ? data.validation.warnings.length : item.counts.warnings,
              blocking: Array.isArray(data.validation.blockingErrors) ? data.validation.blockingErrors.length : item.counts.blocking
            };
          }
          if (data.diffSummary) item.diffSummary = data.diffSummary;
          item.posterRepairApplied = Boolean(data.posterRepairApplied);
          item.posterRepairSource = data.posterRepairSource || '';
          item.posterRepairUrl = data.posterRepairUrl || '';
          if (data.selectedVideoUrlsAfterGeneration) {
            item.diffSummary = Object.assign({}, item.diffSummary || {}, {
              selectedVideoUrlsBefore: data.selectedVideoUrlsBefore || [],
              selectedVideoUrlsAfterGeneration: data.selectedVideoUrlsAfterGeneration
            });
          }
          const stageText = Array.isArray(data.stages) ? data.stages.join(' -> ') : '';
          if (stageText) pushTopConsole('failed @ ' + stageText, item.postId);
          addLog('Optimize+Write failed: ' + item.lastError + (stageText ? (' @ ' + stageText) : ''), item.postId);
          render();
          const err = new Error(item.lastError);
          err.body = data;
          throw err;
        }
        const stages = Array.isArray(data.stages) ? data.stages.join(' -> ') : 'complete';
        item.status.write = 'success';
        item.lastWriteOutcome = 'complete';
        item.failureClassification = null;
        item.generatedRepairPendingWrite = false;
        item.lastWrittenAt = nowLabel();
        item.mediaRepairHappened = Array.isArray(data.generatedAssets) && data.generatedAssets.length > 0;
        item.posterRepairApplied = Boolean(data.posterRepairApplied);
        item.posterRepairSource = data.posterRepairSource || '';
        item.posterRepairUrl = data.posterRepairUrl || '';
        item.lastBackupPath = data.backupPath || '';
        const backupTail = data.backupPath ? String(data.backupPath).split('/').pop() : '';
        item.lastDiagnosticsPath = backupTail ? ('postCanonicalDiagnostics/' + backupTail) : '';
        item.backupId = backupTail || item.backupId;
        item.lastMessage = 'WRITE OK — saved live doc passed compact + media URL checks. ' + stages;
        item.generationFailureDetail = null;
        item.faststartVerifyFailed = false;
        item.raw = data.savedRaw || data.raw || item.raw;
        if (data.savedRawHash) item.rawHash = data.savedRawHash;
        item.compactCheck = data.savedCompactCheck || item.compactCheck;
        item.savedMediaUrlSanity = data.savedMediaUrlSanity || null;
        item.canonicalPreview = data.canonicalPreview || item.canonicalPreview;
        item.validation = data.validation || item.validation;
        if (data.validation) {
          item.counts = {
            warnings: Array.isArray(data.validation.warnings) ? data.validation.warnings.length : 0,
            blocking: Array.isArray(data.validation.blockingErrors) ? data.validation.blockingErrors.length : 0
          };
        }
        item.diffSummary = data.diffSummary || item.diffSummary;
        if (data.selectedVideoUrlsSaved) {
          item.diffSummary = Object.assign({}, item.diffSummary || {}, {
            selectedVideoUrls: data.selectedVideoUrlsSaved,
            selectedVideoUrlsBefore: data.selectedVideoUrlsBefore || [],
            selectedVideoUrlsAfterGeneration: data.selectedVideoUrlsAfterGeneration || []
          });
        }
        if (data.byteEstimateBefore != null) {
          item.compactLivePreviewSummary = {
            byteEstimateBefore: data.byteEstimateBefore,
            byteEstimateAfter: data.byteEstimateAfter,
            removedPathsCount: Array.isArray(data.removedPaths) ? data.removedPaths.length : null
          };
        }
        const hydratePayload = Object.assign({}, data, { raw: item.raw });
        summarizeFromPreview(item, hydratePayload);
        hydratePreviewViews(item, hydratePayload);
        pushTopConsole('optimize+write stream complete', item.postId);
        addLog('Optimize+Write complete: ' + stages, item.postId);
        render();
        return data;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          item.status.write = 'idle';
          item.lastError = '';
          item.lastMessage = 'Optimize+Write canceled.';
          item.lastWriteOutcome = null;
          item.failureClassification = null;
          addLog('Optimize+Write canceled.', item.postId);
          pushTopConsole('aborted', item.postId);
          render();
          throw error;
        }
        item.status.write = 'error';
        item.lastWriteOutcome = 'error';
        item.failureClassification =
          (error.body && error.body.failureClassification) || item.failureClassification || null;
        item.lastError = error.message || 'optimize_write_failed';
        if (error.body && error.body.status) item.lastError = String(error.body.status);
        if (error.body && error.body.raw) item.raw = error.body.raw;
        if (error.body && error.body.canonicalPreview) item.canonicalPreview = error.body.canonicalPreview;
        if (error.body && error.body.validation) {
          item.validation = error.body.validation;
          item.counts = {
            warnings: Array.isArray(error.body.validation.warnings) ? error.body.validation.warnings.length : item.counts.warnings,
            blocking: Array.isArray(error.body.validation.blockingErrors) ? error.body.validation.blockingErrors.length : item.counts.blocking
          };
        }
        if (error.body && error.body.generationFailureDetail) {
          item.generationFailureDetail = error.body.generationFailureDetail;
        }
        if (error.body && error.body.savedMediaUrlSanity) item.savedMediaUrlSanity = error.body.savedMediaUrlSanity;
        if (error.body && error.body.savedCompactCheck) item.compactCheck = error.body.savedCompactCheck;
        if (error.body && error.body.diffSummary) item.diffSummary = error.body.diffSummary;
        item.posterRepairApplied = Boolean(error.body && error.body.posterRepairApplied);
        item.posterRepairSource = (error.body && error.body.posterRepairSource) || '';
        item.posterRepairUrl = (error.body && error.body.posterRepairUrl) || '';
        if (error.body && error.body.selectedVideoUrlsAfterGeneration) {
          item.diffSummary = Object.assign({}, item.diffSummary || {}, {
            selectedVideoUrlsBefore: error.body.selectedVideoUrlsBefore || [],
            selectedVideoUrlsAfterGeneration: error.body.selectedVideoUrlsAfterGeneration
          });
        }
        const stageText = error.body && Array.isArray(error.body.stages) ? error.body.stages.join(' -> ') : '';
        if (stageText) pushTopConsole('failed @ ' + stageText, item.postId);
        addLog('Optimize+Write failed: ' + item.lastError + (stageText ? (' @ ' + stageText) : ''), item.postId);
        render();
        throw error;
      } finally {
        if (ownsAbort) state.inFlightAbort = null;
      }
    }

    async function optimizeWriteQueueManualRun() {
      const range = resolveQueueRunRange();
      if (!range.ok) {
        alert(range.message);
        return;
      }
      if (state.manualQueue.running) return;

      const confirmStart = Boolean(
        el('manualConfirmQueueStart') && el('manualConfirmQueueStart').checked
      );
      if (confirmStart) {
        const ok = window.confirm(
          'Optimize + Write queue range ' + (range.startIdx + 1) + '-' + (range.endIdx + 1) +
            ' of ' + state.queue.length + ' posts in order?'
        );
        if (!ok) return;
      }

      if (state.inFlightAbort) {
        try {
          state.inFlightAbort.abort();
        } catch (_err) {}
        state.inFlightAbort = null;
      }
      state.inFlightAbort = new AbortController();
      const queueSignal = state.inFlightAbort.signal;
      state.manualQueue.running = true;
      addLog(
        'Manual queue optimize+write started. Range: ' +
          (range.startIdx + 1) + '-' + (range.endIdx + 1) + '.'
      );
      render();

      try {
        for (let i = range.startIdx; i <= range.endIdx; i++) {
          const item = state.queue[i];
          if (!state.manualQueue.running) break;
          setSelectedPost(item.postId);
          pushTopConsole(
            "queue progress: " + (i + 1) + "/" + state.queue.length,
            item.postId
          );
          try {
            await optimizeWriteItem(item, { signal: queueSignal });
          } catch (_error) {
            // optimizeWriteItem already updated the UI status for this post; move on.
          }
        }
      } finally {
        state.manualQueue.running = false;
        state.inFlightAbort = null;
        addLog('Manual queue optimize+write finished.');
        captureQueueRunFailureReport();
        render();
      }
    }
    el('writeSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await writeItem(item);
      } catch (_error) {}
    };
    el('optimizeWriteSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await optimizeWriteItem(item);
      } catch (_error) {}
    };
    el('optimizeWriteQueueManual').onclick = async function () {
      try {
        await optimizeWriteQueueManualRun();
      } catch (_error) {}
    };
    el('backupsSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await listBackupsForItem(item);
      } catch (_error) {}
    };
    el('revertSelected').onclick = async function () {
      const item = getActiveItem();
      if (!item) return;
      try {
        await revertItem(item);
      } catch (_error) {}
    };
    el('autoPreviewQueue').onclick = async function () {
      await runAutoSequence(false);
    };
    el('autoPreviewWriteQueue').onclick = async function () {
      if (!window.confirm('Run preview + write across the current queue?')) return;
      await runAutoSequence(true);
    };
    el('autoGenerateFastStarts').onchange = function () {
      state.auto.generateFastStarts = Boolean(el('autoGenerateFastStarts').checked);
      addLog(state.auto.generateFastStarts ? 'Auto run will generate missing fast starts first.' : 'Auto run will skip fast-start generation.');
    };
    el('stopAuto').onclick = function () {
      cancelInFlight();
    };
    el('cancelRunning').onclick = function () {
      cancelInFlight();
    };

    if (el('downloadFailureReport')) {
      el('downloadFailureReport').onclick = function () {
        const rep = state.lastFailureReport;
        if (!rep) return;
        const blob = new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = rep.filename || 'postRebuilderFailures.json';
        a.click();
        setTimeout(function () {
          try {
            URL.revokeObjectURL(a.href);
          } catch (_e) {}
        }, 4000);
        addLog('Downloaded failure report: ' + (rep.filename || 'postRebuilderFailures.json'));
      };
    }
    if (el('copyFailureReport')) {
      el('copyFailureReport').onclick = async function () {
        const rep = state.lastFailureReport;
        if (!rep) return;
        try {
          await navigator.clipboard.writeText(JSON.stringify(rep, null, 2));
          addLog('Failure report JSON copied to clipboard.');
        } catch (_e) {
          addLog('Clipboard copy failed — use Download instead.');
        }
      };
    }
    if (el('retryFailedRepairable')) {
      el('retryFailedRepairable').onclick = async function () {
        if (state.manualQueue.running || state.auto.running) return;
        const targets = state.queue.filter(function (item) {
          const fc = item.failureClassification;
          return item.lastWriteOutcome === 'error' && fc && fc.isRepairable === true;
        });
        if (!targets.length) {
          window.alert('No failed posts with isRepairable=true in the current queue.');
          return;
        }
        if (
          !window.confirm(
            'Retry Optimize+Write for ' + targets.length + ' repairable failed posts only (skips non-repairable)?'
          )
        ) {
          return;
        }
        if (state.inFlightAbort) {
          try {
            state.inFlightAbort.abort();
          } catch (_err) {}
          state.inFlightAbort = null;
        }
        state.inFlightAbort = new AbortController();
        const sig = state.inFlightAbort.signal;
        state.manualQueue.running = true;
        addLog('Retry repairable failures started (' + targets.length + ').');
        render();
        try {
          for (let j = 0; j < targets.length; j++) {
            if (!state.manualQueue.running) break;
            const item = targets[j];
            setSelectedPost(item.postId);
            try {
              await optimizeWriteItem(item, { signal: sig });
            } catch (_e) {}
          }
        } finally {
          state.manualQueue.running = false;
          state.inFlightAbort = null;
          addLog('Retry repairable failures finished.');
          captureQueueRunFailureReport();
          render();
        }
      };
    }

    addLog('System ready. No preview or write has been run yet.');
    pushTopConsole('System ready. No preview/write executed yet.');
    render();
  </script>
</body>
</html>`;

export async function registerPostRebuilderRoutes(app: FastifyInstance): Promise<void> {
  if (!app.config.ENABLE_POST_REBUILDER_DEBUG_ROUTES) {
    app.log.info("post rebuilder debug routes disabled (ENABLE_POST_REBUILDER_DEBUG_ROUTES!=true)");
    return;
  }

  app.get("/debug/post-rebuilder", async (_request, reply) => reply.type("text/html").send(htmlPage));

  app.get("/debug/post-rebuilder/posts", async (request, reply) => {
    const query = LoadNewestPostsQuerySchema.parse(request.query ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable", posts: [] });
    let q = db.collection("posts").orderBy("time", "desc");
    if (query.offset > 0) q = q.offset(query.offset);
    const snap = await q.limit(query.limit).get();
    return {
      order: "time_desc",
      offset: query.offset,
      limit: query.limit,
      count: snap.size,
      posts: snap.docs.map((doc) => summarizeQueueCandidate(doc.id, (doc.data() ?? {}) as UnknownRecord))
    };
  });

  app.get<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/raw", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return { postId: params.postId, exists: false, raw: null, rawHash: hashPostForRebuild(null) };
    const snap = await db.collection("posts").doc(params.postId).get();
    const raw = snap.exists ? ((snap.data() ?? {}) as UnknownRecord) : null;
    return { postId: params.postId, exists: snap.exists, raw, rawHash: hashPostForRebuild(raw) };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/preview", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const query = PreviewQuerySchema.parse(request.query ?? {});
    const db = getFirestoreSourceClient();
    if (!db)
      return {
        postId: params.postId,
        rawHash: "",
        raw: null,
        canonicalPreview: null,
        engagementSourceAudit: null,
        mediaProcessingDebugPreview: null,
        validation: {
          status: "invalid",
          blockingErrors: [{ code: "firestore_unavailable", message: "Firestore unavailable", blocking: true }],
          warnings: []
        },
        diffSummary: {},
        writeAllowed: false
      };
    const snap = await db.collection("posts").doc(params.postId).get();
    const raw = snap.exists ? ((snap.data() ?? {}) as UnknownRecord) : null;
    const rawHash = hashPostForRebuild(raw);
    if (!raw) {
      return {
        postId: params.postId,
        rawHash,
        raw: null,
        canonicalPreview: null,
        engagementSourceAudit: null,
        mediaProcessingDebugPreview: null,
        validation: {
          status: "invalid",
          blockingErrors: [{ code: "post_not_found", message: "Post does not exist", blocking: true }],
          warnings: []
        },
        diffSummary: {},
        writeAllowed: false
      };
    }
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, raw);
    const normalized = normalizeMasterPostV2(raw, { postId: params.postId, engagementSourceAudit });
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
    const mediaProcessingDebugPreview = extractMediaProcessingDebugV2(raw);
    const diffSummary = diffMasterPostPreview({
      raw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: [...normalized.warnings, ...validation.warnings],
      errors: [...normalized.errors, ...validation.blockingErrors],
      processingDebugExtracted: Boolean(mediaProcessingDebugPreview)
    });
    const previewChecks =
      query.dryRunMode === "singleVideoCheck"
        ? {
            mediaAssetCountAfterIsOne: normalized.canonical.media.assetCount === 1,
            mediaKindIsVideo: normalized.canonical.classification.mediaKind === "video",
            compatibilityStillExists:
              Boolean(normalized.canonical.compatibility.photoLink) &&
              Boolean(normalized.canonical.compatibility.displayPhotoLink) &&
              Boolean(normalized.canonical.compatibility.photoLinks2 ?? normalized.canonical.compatibility.fallbackVideoUrl),
            hasMp4ImageAssets: normalized.canonical.media.assets.some(
              (asset) => asset.type === "image" && /\.mp4(\?|$)/i.test(asset.image?.displayUrl ?? "")
            )
          }
        : null;
    const compactCheck = isCompactCanonicalPostV2(raw as Record<string, unknown>);
    let compactLivePreview: ReturnType<typeof compactCanonicalPostForLiveWrite> | null = null;
    try {
      compactLivePreview = compactCanonicalPostForLiveWrite({
        canonical: normalized.canonical,
        rawBefore: raw as Record<string, unknown>,
        postId: params.postId
      });
    } catch {
      compactLivePreview = null;
    }
    return {
      postId: params.postId,
      rawHash,
      raw,
      canonicalPreview: normalized.canonical,
      engagementSourceAudit,
      mediaProcessingDebugPreview,
      validation,
      diffSummary,
      previewChecks,
      compactCheck,
      compactLivePreview,
      writeAllowed: validation.blockingErrors.length === 0
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/analyze-fast-start", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const snap = await db.collection("posts").doc(params.postId).get();
    if (!snap.exists) return reply.status(404).send({ error: "post_not_found" });
    const raw = (snap.data() ?? {}) as UnknownRecord;
    const analyze = analyzeVideoFastStartNeeds(raw, { postId: params.postId });
    return { postId: params.postId, analyze };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/generate-fast-starts", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = GenerateFastStartBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const snap = await db.collection("posts").doc(params.postId).get();
    if (!snap.exists) return reply.status(404).send({ error: "post_not_found" });
    const raw = (snap.data() ?? {}) as UnknownRecord;
    const cfgUrlRepairFs = readWasabiConfigFromEnv();
    let workingRawFs = raw;
    if (cfgUrlRepairFs) {
      const repFs = await repairVideosLabDoublePostPrefixUrlsDeep(cfgUrlRepairFs, raw as Record<string, unknown>);
      workingRawFs = repFs.value as UnknownRecord;
    }
    const run = await generateMissingFastStartVariantsForPost(params.postId, workingRawFs, {
      generateMissingForAsset: defaultGenerateMissingForAsset,
      verifyGeneratedUrl: defaultVerifyGeneratedVideoUrl
    });
    const repairedRaw = mergePlaybackLabResultsIntoRawPost(workingRawFs, run.generationResults);
    const normalized = rebuildPostAfterFastStartRepair(repairedRaw, { postId: params.postId });
    const validation = validateMasterPostV2(normalized.canonical);
    const diffSummary = diffMasterPostPreview({
      raw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: [...normalized.warnings, ...validation.warnings],
      errors: [...normalized.errors, ...validation.blockingErrors],
      processingDebugExtracted: true
    });
    if (body.dryRun) {
      return {
        postId: params.postId,
        dryRun: true,
        analyze: run.analyze,
        generationResults: run.generationResults,
        repairedRaw,
        canonicalPreview: normalized.canonical,
        validation,
        diffSummary,
        firestoreWritten: false
      };
    }
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, repairedRaw);
    const normalizedWrite = normalizeMasterPostV2(repairedRaw, {
      postId: params.postId,
      strict: true,
      engagementSourceAudit
    });
    const validationWrite = validateMasterPostV2(normalizedWrite.canonical, { engagementSourceAudit });
    if (validationWrite.blockingErrors.length > 0) {
      return reply.status(422).send({ error: "blocking_validation_errors", validation: validationWrite });
    }
    await persistCompactCanonicalPost({
      db,
      postId: params.postId,
      rawBefore: raw,
      repairedRaw,
      canonical: normalizedWrite.canonical,
      engagementSourceAudit,
      actorRoute: "debug/post-rebuilder/generate-fast-starts"
    });
    const savedDataGen = (await db.collection("posts").doc(params.postId).get()).data() as Record<string, unknown>;
    const savedCheck = isCompactCanonicalPostV2(savedDataGen);
    if (!savedCheck.ok) {
      return reply.status(422).send({
        error: "write_failed_compact_validation",
        compactValidation: savedCheck,
        savedMediaUrlSanity: mediaUrlSanityCheckOnSavedCompactPost(savedDataGen as UnknownRecord)
      });
    }
    const savedMediaSanityGen = mediaUrlSanityCheckOnSavedCompactPost(savedDataGen as UnknownRecord);
    if (!savedMediaSanityGen.ok) {
      return reply.status(422).send({
        error: "write_failed_media_url_sanity",
        compactValidation: savedCheck,
        savedMediaUrlSanity: savedMediaSanityGen
      });
    }
    return {
      postId: params.postId,
      dryRun: false,
      analyze: run.analyze,
      generationResults: run.generationResults,
      repairedRaw,
      canonicalPreview: normalizedWrite.canonical,
      validation: validationWrite,
      diffSummary,
      firestoreWritten: true,
      compactVerified: savedCheck,
      savedMediaUrlSanity: savedMediaSanityGen
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/preview-after-fast-starts", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = GenerateFastStartBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const snap = await db.collection("posts").doc(params.postId).get();
    if (!snap.exists) return reply.status(404).send({ error: "post_not_found" });
    const raw = (snap.data() ?? {}) as UnknownRecord;
    const cfgUrlRepairPreview = readWasabiConfigFromEnv();
    let workingRawPreview = raw;
    if (cfgUrlRepairPreview) {
      const repPv = await repairVideosLabDoublePostPrefixUrlsDeep(cfgUrlRepairPreview, raw as Record<string, unknown>);
      workingRawPreview = repPv.value as UnknownRecord;
    }
    const run = await generateMissingFastStartVariantsForPost(params.postId, workingRawPreview, {
      generateMissingForAsset: defaultGenerateMissingForAsset,
      verifyGeneratedUrl: defaultVerifyGeneratedVideoUrl
    });
    const repairedRaw = mergePlaybackLabResultsIntoRawPost(workingRawPreview, run.generationResults);
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, repairedRaw);
    const normalized = normalizeMasterPostV2(repairedRaw, { postId: params.postId, engagementSourceAudit });
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
    const diffSummary = diffMasterPostPreview({
      raw: repairedRaw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: [...normalized.warnings, ...validation.warnings],
      errors: [...normalized.errors, ...validation.blockingErrors],
      processingDebugExtracted: true
    });
    let compactVerified: ReturnType<typeof isCompactCanonicalPostV2> | null = null;
    let savedMediaUrlSanityPreview: ReturnType<typeof mediaUrlSanityCheckOnSavedCompactPost> | null = null;
    const compactCheckPreview = isCompactCanonicalPostV2(repairedRaw as Record<string, unknown>);
    if (!body.dryRun) {
      if (validation.blockingErrors.length > 0) {
        return reply.status(422).send({ error: "blocking_validation_errors", validation });
      }
      const normalizedWrite = normalizeMasterPostV2(repairedRaw, {
        postId: params.postId,
        strict: true,
        engagementSourceAudit
      });
      const validationWrite = validateMasterPostV2(normalizedWrite.canonical, { engagementSourceAudit });
      if (validationWrite.blockingErrors.length > 0) {
        return reply.status(422).send({ error: "blocking_validation_errors", validation: validationWrite });
      }
      await persistCompactCanonicalPost({
        db,
        postId: params.postId,
        rawBefore: raw,
        repairedRaw,
        canonical: normalizedWrite.canonical,
        engagementSourceAudit,
        actorRoute: "debug/post-rebuilder/preview-after-fast-starts"
      });
      const savedDataPreview = (await db.collection("posts").doc(params.postId).get()).data() as UnknownRecord;
      compactVerified = isCompactCanonicalPostV2(savedDataPreview as Record<string, unknown>);
      if (!compactVerified.ok) {
        return reply.status(422).send({
          error: "write_failed_compact_validation",
          compactValidation: compactVerified,
          savedMediaUrlSanity: mediaUrlSanityCheckOnSavedCompactPost(savedDataPreview)
        });
      }
      savedMediaUrlSanityPreview = mediaUrlSanityCheckOnSavedCompactPost(savedDataPreview);
      if (!savedMediaUrlSanityPreview.ok) {
        return reply.status(422).send({
          error: "write_failed_media_url_sanity",
          compactValidation: compactVerified,
          savedMediaUrlSanity: savedMediaUrlSanityPreview
        });
      }
    }
    return {
      postId: params.postId,
      dryRun: body.dryRun,
      analyze: run.analyze,
      generationResults: run.generationResults,
      raw: repairedRaw,
      rawHash: hashPostForRebuild(repairedRaw),
      canonicalPreview: normalized.canonical,
      validation,
      diffSummary,
      writeAllowed: validation.blockingErrors.length === 0,
      firestoreWritten: !body.dryRun,
      compactVerified,
      compactCheckPreview,
      savedMediaUrlSanity: savedMediaUrlSanityPreview
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/optimize-and-write", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = OptimizeAndWriteBodySchema.parse(request.body ?? {});
    const query = OptimizeAndWriteQuerySchema.parse(request.query ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });

    if (query.stream === "1") {
      const stream = new PassThrough();
      void (async () => {
        const writeLine = (obj: unknown) => {
          stream.write(`${JSON.stringify(obj)}\n`);
        };
        try {
          const result = await optimizeAndWritePost({
            db,
            postId: params.postId,
            strict: body.strict,
            onProgress: (evt) => writeLine({ type: "progress", t: Date.now(), ...evt })
          });
          writeLine({ type: "done", result });
        } catch (error) {
          writeLine({
            type: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        } finally {
          stream.end();
        }
      })();
      reply.header("Content-Type", "application/x-ndjson; charset=utf-8");
      reply.header("Cache-Control", "no-store");
      reply.header("X-Accel-Buffering", "no");
      return reply.send(stream);
    }

    const result = await optimizeAndWritePost({ db, postId: params.postId, strict: body.strict });
    if (result.status === "post_not_found") return reply.status(404).send(result);
    if (result.status === "already_compact_canonical") return result;
    if (result.status !== "complete") return reply.status(422).send(result);
    return result;
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/write", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = WriteSchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const postRef = db.collection("posts").doc(params.postId);
    const snap = await postRef.get();
    if (!snap.exists) return reply.status(404).send({ error: "post_not_found" });
    const raw = (snap.data() ?? {}) as UnknownRecord;
    const rawHash = hashPostForRebuild(raw);
    if (rawHash !== body.expectedHash) {
      return reply
        .status(409)
        .send({
          error: "stale_hash",
          message: "Preview is stale. Reload/preview again, or use Optimize + Write Selected for one-step fresh optimize/write.",
          expectedHash: body.expectedHash,
          currentHash: rawHash
        });
    }
    const compactPre = isCompactCanonicalPostV2(raw as Record<string, unknown>);
    if (compactPre.canSkipWrite) {
      const savedMediaSanity = mediaUrlSanityCheckOnSavedCompactPost(raw);
      return {
        status: "already_compact_canonical",
        compactCheck: compactPre,
        savedCompactCheck: compactPre,
        savedMediaUrlSanity: savedMediaSanity,
        backupId: "",
        backupPath: "",
        validation: null,
        fieldsWritten: [],
        mediaProcessingDebugWritten: false
      };
    }
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, raw);
    const normalized = normalizeMasterPostV2(raw, { postId: params.postId, strict: true, engagementSourceAudit });
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
    if (validation.blockingErrors.length > 0 && !body.force) {
      return reply.status(422).send({ error: "blocking_validation_errors", validation });
    }
    const mediaProcessingDebugPreview = extractMediaProcessingDebugV2(raw);
    const persisted = await persistCompactCanonicalPost({
      db,
      postId: params.postId,
      rawBefore: raw,
      repairedRaw: raw,
      canonical: normalized.canonical,
      engagementSourceAudit,
      actorRoute: "debug/post-rebuilder/write"
    });
    if (mediaProcessingDebugPreview) {
      await postRef
        .collection("mediaProcessingDebug")
        .doc("masterPostV2")
        .set(mediaProcessingDebugPreview, { merge: true });
    }
    const savedData = (await postRef.get()).data() as Record<string, unknown>;
    const savedCheck = isCompactCanonicalPostV2(savedData);
    if (!savedCheck.ok) {
      return reply.status(422).send({
        error: "write_failed_compact_validation",
        compactValidation: savedCheck,
        savedMediaUrlSanity: mediaUrlSanityCheckOnSavedCompactPost(savedData as UnknownRecord),
        backupPath: persisted.backupPath
      });
    }
    const savedMediaSanity = mediaUrlSanityCheckOnSavedCompactPost(savedData as UnknownRecord);
    if (!savedMediaSanity.ok) {
      return reply.status(422).send({
        error: "write_failed_media_url_sanity",
        savedMediaUrlSanity: savedMediaSanity,
        compactValidation: savedCheck,
        backupPath: persisted.backupPath
      });
    }
    const fieldsWritten = [
      "schema",
      "lifecycle",
      "author",
      "text",
      "location",
      "classification",
      "media",
      "engagement",
      "engagementPreview",
      "ranking",
      "compatibility",
      "compact_top_level_mirrors",
      "assetsReady"
    ];
    return {
      status: "compacted_write_ok",
      backupId: persisted.backupId,
      backupPath: persisted.backupPath,
      canonical: normalized.canonical,
      validation,
      fieldsWritten,
      mediaProcessingDebugWritten: Boolean(mediaProcessingDebugPreview),
      byteEstimateBefore: persisted.byteEstimateBefore,
      byteEstimateAfter: persisted.byteEstimateAfter,
      removedPaths: persisted.removedPaths,
      savedCompactCheck: savedCheck,
      savedMediaUrlSanity: savedMediaSanity
    };
  });

  app.get<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/backups", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return { postId: params.postId, backups: [] };
    const snap = await db
      .collection("postCanonicalBackups")
      .where("postId", "==", params.postId)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();
    return {
      postId: params.postId,
      backups: snap.docs.map((doc) => ({ backupId: doc.id, ...(doc.data() ?? {}) }))
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/revert", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = RevertSchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const backupSnap = await db.collection("postCanonicalBackups").doc(body.backupId).get();
    if (!backupSnap.exists) return reply.status(404).send({ error: "backup_not_found" });
    const backup = (backupSnap.data() ?? {}) as Record<string, any>;
    if (backup.postId !== params.postId) return reply.status(400).send({ error: "backup_post_mismatch" });
    const rawBefore = backup.rawBefore;
    await db.collection("posts").doc(params.postId).set(rawBefore, { merge: false });
    await db
      .collection("posts")
      .doc(params.postId)
      .collection("mediaProcessingDebug")
      .doc("revertAudit")
      .set(
        {
          backupId: body.backupId,
          revertedAt: new Date().toISOString(),
          action: "restore_rawBefore_exact"
        },
        { merge: true }
      );
    return { success: true, postId: params.postId, backupId: body.backupId, restoredAt: new Date().toISOString() };
  });
}
