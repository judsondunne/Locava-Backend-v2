import { shouldGenerate1080Ladder } from "../../../services/video/video-source-policy.js";
import { normalizeMasterPostV2, type NormalizeMasterPostV2Options } from "./normalizeMasterPostV2.js";

type RawPost = Record<string, any>;
type RawAsset = Record<string, any>;

export type FastStartSkipReason =
  | "no_video_assets"
  | "already_has_verified_startup1080"
  | "already_has_verified_startup720"
  | "already_has_verified_startup540"
  | "already_has_verified_preview360"
  | "source_missing"
  | "source_too_low_for_1080"
  | "verification_failed"
  | "generation_failed"
  | "asset_already_optimized";

export type FastStartAssetNeeds = {
  assetId: string;
  isVideo: boolean;
  sourceUrl: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  supports1080: boolean;
  needs: {
    posterHigh: boolean;
    preview360Avc: boolean;
    main720Avc: boolean;
    startup540FaststartAvc: boolean;
    startup720FaststartAvc: boolean;
    startup1080FaststartAvc: boolean;
    upgrade1080FaststartAvc: boolean;
  };
  skipReasons: FastStartSkipReason[];
  alreadyOptimized: boolean;
};

export type FastStartAnalyzeResult = {
  postId: string;
  videoAssetCount: number;
  alreadyOptimizedCount: number;
  needsGenerationCount: number;
  skippedCount: number;
  missingSourceCount: number;
  assetNeeds: FastStartAssetNeeds[];
  skipReasons: FastStartSkipReason[];
};

export type VerifyOutput = {
  label: string;
  url: string;
  ok: boolean;
  moovHint?: string;
  probe?: {
    head: {
      ok: boolean;
      status: number;
      contentType: string;
      acceptRanges: string;
    };
    moovHint?: string;
  };
};

export type GenerateAssetOutput = {
  generated: Record<string, string>;
  generationMetadata?: Record<string, unknown>;
  diagnosticsJson?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type FastStartRepairProgress = {
  phase: string;
  detail?: string;
  assetId?: string;
  index?: number;
  total?: number;
};

export type FastStartRepairOptions = {
  generateMissingForAsset?: (input: {
    postId: string;
    asset: RawAsset;
    needs: FastStartAssetNeeds["needs"];
    /** Forward to video encoder (download / ffmpeg / Wasabi) for live debug UI. */
    onEncoderProgress?: (evt: { phase: string; detail?: string }) => void;
  }) => Promise<GenerateAssetOutput>;
  verifyGeneratedUrl?: (input: { label: string; url: string; originalUrl: string | null }) => Promise<VerifyOutput>;
  /** Debug / long-running UI: called as work advances inside this module. */
  onProgress?: (evt: FastStartRepairProgress) => void;
};

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toTrimmed(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const next = value.trim();
    if (next.length > 0) return next;
  }
  return null;
}

function toNum(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function collectVerifyRows(rawPost: RawPost, asset: RawAsset): Array<Record<string, any>> {
  const postPlaybackLab = toObject(rawPost.playbackLab) ?? {};
  const assetPlaybackLab = toObject(asset.playbackLab) ?? {};
  const postAssetPlaybackLab = toObject(toObject(postPlaybackLab.assets)?.[String(asset.id ?? "")]) ?? {};
  return [
    ...(Array.isArray(postPlaybackLab.lastVerifyResults) ? postPlaybackLab.lastVerifyResults : []),
    ...(Array.isArray(assetPlaybackLab.lastVerifyResults) ? assetPlaybackLab.lastVerifyResults : []),
    ...(Array.isArray(toObject(assetPlaybackLab.generated)?.lastVerifyResults) ? (toObject(assetPlaybackLab.generated)?.lastVerifyResults as unknown[]) : []),
    ...(Array.isArray(postAssetPlaybackLab.lastVerifyResults) ? postAssetPlaybackLab.lastVerifyResults : []),
    ...(Array.isArray(toObject(postAssetPlaybackLab.generated)?.lastVerifyResults)
      ? (toObject(postAssetPlaybackLab.generated)?.lastVerifyResults as unknown[])
      : [])
  ]
    .map((row) => toObject(row))
    .filter((row): row is Record<string, any> => Boolean(row));
}

function isVerifiedRowForUrl(rows: Array<Record<string, any>>, url: string | null): boolean {
  if (!url) return false;
  const target = url.trim();
  if (!target) return false;
  const isHeadOk = (head: Record<string, any> | null): boolean => {
    if (!head) return false;
    if (head.ok === true) return true;
    const status = typeof head.status === "number" ? head.status : null;
    if (!status || status < 200 || status >= 300) return false;
    const contentType = String(head.contentType ?? head["content-type"] ?? "").toLowerCase();
    return contentType.includes("video/mp4");
  };
  for (const row of rows) {
    const rowUrl = toTrimmed(row.url, row.targetUrl, row.sourceUrl, toObject(row.result)?.url, toObject(row.probe)?.url);
    if (rowUrl !== target) continue;
    if (row.ok === true && toTrimmed(row.moovHint) === "moov_before_mdat_in_prefix") return true;
    const probe = toObject(row.probe);
    if (probe && isHeadOk(toObject(probe.head)) && toTrimmed(probe.moovHint) === "moov_before_mdat_in_prefix") return true;
  }
  return false;
}

type VideoAssetCandidates = {
  posterHigh: string | null;
  preview360Avc: string | null;
  main720Avc: string | null;
  startup540FaststartAvc: string | null;
  startup720FaststartAvc: string | null;
  startup1080FaststartAvc: string | null;
  upgrade1080FaststartAvc: string | null;
  original: string | null;
};

function resolveVideoAssetCandidates(asset: RawAsset): VideoAssetCandidates {
  const variants = toObject(asset.variants) ?? {};
  const generated = toObject(toObject(asset.playbackLab)?.generated) ?? {};
  return {
    posterHigh: toTrimmed(asset.posterHigh, generated.posterHigh),
    preview360Avc: toTrimmed(asset.preview360Avc, variants.preview360Avc, generated.preview360Avc, variants.preview360),
    main720Avc: toTrimmed(asset.main720Avc, variants.main720Avc, generated.main720Avc, variants.main720),
    startup540FaststartAvc: toTrimmed(
      asset.startup540FaststartAvc,
      variants.startup540FaststartAvc,
      generated.startup540FaststartAvc,
      variants.startup540Faststart
    ),
    startup720FaststartAvc: toTrimmed(
      asset.startup720FaststartAvc,
      variants.startup720FaststartAvc,
      generated.startup720FaststartAvc,
      variants.startup720Faststart
    ),
    startup1080FaststartAvc: toTrimmed(
      asset.startup1080FaststartAvc,
      variants.startup1080FaststartAvc,
      generated.startup1080FaststartAvc,
      variants.startup1080Faststart
    ),
    upgrade1080FaststartAvc: toTrimmed(
      asset.upgrade1080FaststartAvc,
      variants.upgrade1080FaststartAvc,
      generated.upgrade1080FaststartAvc,
      variants.upgrade1080Faststart
    ),
    original: toTrimmed(asset.original, asset.url)
  };
}

export function analyzeVideoFastStartNeeds(rawPost: RawPost, options?: { postId?: string }): FastStartAnalyzeResult {
  const assets = Array.isArray(rawPost.assets) ? rawPost.assets : [];
  const postId = options?.postId ?? toTrimmed(rawPost.id, rawPost.postId) ?? "unknown";
  const assetNeeds: FastStartAssetNeeds[] = [];
  const postSkipReasons = new Set<FastStartSkipReason>();

  for (const row of assets) {
    const asset = toObject(row) ?? {};
    const type = toTrimmed(asset.type, asset.mediaType)?.toLowerCase();
    const isVideo = type === "video";
    if (!isVideo) continue;
    const candidates = resolveVideoAssetCandidates(asset);
    const verifyRows = collectVerifyRows(rawPost, asset);
    const sourceWidth = toNum(asset.width, toObject(asset.variantMetadata)?.width);
    const sourceHeight = toNum(asset.height, toObject(asset.variantMetadata)?.height);
    const supports1080 = shouldGenerate1080Ladder(sourceWidth ?? 0, sourceHeight ?? 0);
    const needs = {
      posterHigh: !candidates.posterHigh,
      preview360Avc: !isVerifiedRowForUrl(verifyRows, candidates.preview360Avc),
      main720Avc: !isVerifiedRowForUrl(verifyRows, candidates.main720Avc),
      startup540FaststartAvc: !isVerifiedRowForUrl(verifyRows, candidates.startup540FaststartAvc),
      startup720FaststartAvc: !isVerifiedRowForUrl(verifyRows, candidates.startup720FaststartAvc),
      startup1080FaststartAvc: supports1080 ? !isVerifiedRowForUrl(verifyRows, candidates.startup1080FaststartAvc) : false,
      upgrade1080FaststartAvc: supports1080 ? !isVerifiedRowForUrl(verifyRows, candidates.upgrade1080FaststartAvc) : false
    };
    const skipReasons: FastStartSkipReason[] = [];
    if (!candidates.original) skipReasons.push("source_missing");
    if (!supports1080) skipReasons.push("source_too_low_for_1080");
    if (!needs.startup1080FaststartAvc) skipReasons.push("already_has_verified_startup1080");
    if (!needs.startup720FaststartAvc) skipReasons.push("already_has_verified_startup720");
    if (!needs.startup540FaststartAvc) skipReasons.push("already_has_verified_startup540");
    if (!needs.preview360Avc) skipReasons.push("already_has_verified_preview360");
    const alreadyOptimized =
      !needs.preview360Avc &&
      !needs.main720Avc &&
      !needs.startup540FaststartAvc &&
      !needs.startup720FaststartAvc &&
      (!supports1080 || !needs.startup1080FaststartAvc);
    if (alreadyOptimized) skipReasons.push("asset_already_optimized");
    for (const reason of skipReasons) postSkipReasons.add(reason);
    assetNeeds.push({
      assetId: String(asset.id ?? ""),
      isVideo,
      sourceUrl: candidates.original,
      sourceWidth,
      sourceHeight,
      supports1080,
      needs,
      skipReasons,
      alreadyOptimized
    });
  }

  if (assetNeeds.length === 0) postSkipReasons.add("no_video_assets");
  const missingSourceCount = assetNeeds.filter((row) => !row.sourceUrl).length;
  return {
    postId,
    videoAssetCount: assetNeeds.length,
    alreadyOptimizedCount: assetNeeds.filter((row) => row.alreadyOptimized).length,
    needsGenerationCount: assetNeeds.filter((row) => !row.alreadyOptimized && row.sourceUrl).length,
    skippedCount: assetNeeds.filter((row) => row.alreadyOptimized || !row.sourceUrl).length,
    missingSourceCount,
    assetNeeds,
    skipReasons: [...postSkipReasons]
  };
}

export async function generateMissingFastStartVariantsForAsset(
  postId: string,
  rawAsset: RawAsset,
  needs: FastStartAssetNeeds["needs"],
  options: FastStartRepairOptions
): Promise<{ generated: Record<string, string>; verifyResults: VerifyOutput[]; warnings: string[]; errors: string[] }> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const generator = options.generateMissingForAsset;
  const verifier = options.verifyGeneratedUrl;
  if (!generator) return { generated: {}, verifyResults: [], warnings, errors: ["generation_missing_implementation"] };
  if (!verifier) return { generated: {}, verifyResults: [], warnings, errors: ["verification_missing_implementation"] };
  const assetId = toTrimmed(rawAsset.id) ?? "unknown_asset";
  options.onProgress?.({
    phase: "encoder_dispatch",
    assetId,
    detail: "download_encode_upload_wasabi"
  });
  const output = await generator({
    postId,
    asset: rawAsset,
    needs,
    onEncoderProgress: (evt) =>
      options.onProgress?.({
        phase: evt.phase,
        detail: evt.detail,
        assetId
      })
  });
  const generated = output.generated ?? {};
  const verifyResults: VerifyOutput[] = [];
  const labels = Object.keys(generated).filter((k) => toTrimmed(generated[k]));
  if (labels.length) {
    options.onProgress?.({
      phase: "verify_generated_mp4s",
      assetId,
      detail: labels.join(",")
    });
  }
  for (const [label, url] of Object.entries(generated)) {
    const trimmed = toTrimmed(url);
    if (!trimmed) continue;
    options.onProgress?.({ phase: "verify_url", assetId, detail: label });
    const verify = await verifier({ label, url: trimmed, originalUrl: toTrimmed(rawAsset.original, rawAsset.url) });
    verifyResults.push(verify);
    if (!verify.ok) errors.push(`verification_failed:${label}`);
  }
  return { generated, verifyResults, warnings, errors };
}

export async function generateMissingFastStartVariantsForPost(
  postId: string,
  rawPost: RawPost,
  options: FastStartRepairOptions = {}
): Promise<{
  analyze: FastStartAnalyzeResult;
  generationResults: Array<{
    assetId: string;
    generated: Record<string, string>;
    verifyResults: VerifyOutput[];
    warnings: string[];
    errors: string[];
    skipped: boolean;
  }>;
}> {
  const analyze = analyzeVideoFastStartNeeds(rawPost, { postId });
  const generationResults: Array<{
    assetId: string;
    generated: Record<string, string>;
    verifyResults: VerifyOutput[];
    warnings: string[];
    errors: string[];
    skipped: boolean;
  }> = [];
  const assets = Array.isArray(rawPost.assets) ? rawPost.assets : [];
  const workable = analyze.assetNeeds.filter((need) => {
    const asset = assets.find((row: any) => String(row?.id ?? "") === need.assetId);
    return Boolean(asset && !need.alreadyOptimized && need.sourceUrl);
  });
  const totalWorkable = workable.length;
  options.onProgress?.({
    phase: "fast_start_plan",
    detail: `videos=${analyze.videoAssetCount} encode_jobs=${totalWorkable} skipped=${analyze.skippedCount}`,
    total: totalWorkable
  });
  let workIndex = 0;
  for (const need of analyze.assetNeeds) {
    const asset = assets.find((row: any) => String(row?.id ?? "") === need.assetId);
    if (!asset || need.alreadyOptimized || !need.sourceUrl) {
      generationResults.push({
        assetId: need.assetId,
        generated: {},
        verifyResults: [],
        warnings: need.sourceUrl ? [] : ["source_missing"],
        errors: [],
        skipped: true
      });
      continue;
    }
    workIndex += 1;
    options.onProgress?.({
      phase: "fast_start_asset",
      assetId: need.assetId,
      index: workIndex,
      total: totalWorkable,
      detail: "starting_encode_or_verify"
    });
    try {
      const result = await generateMissingFastStartVariantsForAsset(postId, asset, need.needs, options);
      generationResults.push({ assetId: need.assetId, ...result, skipped: false });
    } catch (error) {
      generationResults.push({
        assetId: need.assetId,
        generated: {},
        verifyResults: [],
        warnings: [],
        errors: [`generation_failed:${error instanceof Error ? error.message : String(error)}`],
        skipped: false
      });
    }
  }
  return { analyze, generationResults };
}

export function mergePlaybackLabResultsIntoRawPost(
  rawPost: RawPost,
  generationResults: Array<{
    assetId: string;
    generated: Record<string, string>;
    verifyResults: VerifyOutput[];
    errors: string[];
    skipped?: boolean;
  }>
): RawPost {
  const next = { ...rawPost };
  const assets = Array.isArray(rawPost.assets) ? [...rawPost.assets] : [];
  const postPlaybackLab = toObject(rawPost.playbackLab) ?? {};
  const postPlaybackLabAssets = { ...(toObject(postPlaybackLab.assets) ?? {}) };
  const postVerifyRows = [...(Array.isArray(postPlaybackLab.lastVerifyResults) ? postPlaybackLab.lastVerifyResults : [])];
  for (const result of generationResults) {
    const hasGenerated = Object.keys(result.generated ?? {}).length > 0;
    const hasVerifyRows = Array.isArray(result.verifyResults) && result.verifyResults.length > 0;
    const hasErrors = Array.isArray(result.errors) && result.errors.length > 0;
    // Preserve existing verified playback metadata when an asset was skipped
    // (already optimized / no source / no-op generation).
    if (!hasGenerated && !hasVerifyRows && !hasErrors) {
      continue;
    }
    const idx = assets.findIndex((row: any) => String(row?.id ?? "") === result.assetId);
    if (idx < 0) continue;
    const asset = { ...(toObject(assets[idx]) ?? {}) };
    const variants = { ...(toObject(asset.variants) ?? {}) };
    const verifiedLabels = new Set(
      (result.verifyResults ?? [])
        .filter((row) => row.ok)
        .map((row) => String(row.label ?? "").trim())
        .filter((label) => label.length > 0)
    );
    const verifiedGenerated: Record<string, string> = {};
    for (const [key, value] of Object.entries(result.generated ?? {})) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      if (!verifiedLabels.has(key)) continue;
      variants[key] = value;
      (asset as Record<string, unknown>)[key] = value;
      verifiedGenerated[key] = value;
    }
    asset.variants = variants;
    const nextAssetPlaybackLab = {
      ...(toObject(asset.playbackLab) ?? {}),
      generated: {
        ...(toObject(toObject(asset.playbackLab)?.generated) ?? {}),
        ...verifiedGenerated,
        lastVerifyResults: result.verifyResults
      },
      lastVerifyResults: result.verifyResults,
      lastVerifyAllOk: result.errors.length === 0
    };
    asset.playbackLab = nextAssetPlaybackLab;
    postPlaybackLabAssets[result.assetId] = {
      ...(toObject(postPlaybackLabAssets[result.assetId]) ?? {}),
      generated: {
        ...(toObject(toObject(postPlaybackLabAssets[result.assetId])?.generated) ?? {}),
        ...verifiedGenerated,
        lastVerifyResults: result.verifyResults
      },
      lastVerifyResults: result.verifyResults,
      lastVerifyAllOk: result.errors.length === 0
    };
    postVerifyRows.push(...result.verifyResults);
    assets[idx] = asset;
  }
  next.assets = assets;
  next.playbackLab = {
    ...postPlaybackLab,
    assets: postPlaybackLabAssets,
    lastVerifyResults: postVerifyRows,
    lastVerifyAllOk: generationResults.every((row) => row.errors.length === 0)
  };
  return next;
}

export function rebuildPostAfterFastStartRepair(
  rawPost: RawPost,
  options: NormalizeMasterPostV2Options = {}
): ReturnType<typeof normalizeMasterPostV2> {
  return normalizeMasterPostV2(rawPost, options);
}
