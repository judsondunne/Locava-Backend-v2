/**
 * Compact canonical live document builder + idempotency checks for Master Post V2.
 * Live /posts/{postId} should not carry migration/debug bloat — only production fields + mirrors.
 */

import type { MasterPostAssetV2, MasterPostV2 } from "../../../contracts/master-post-v2.types.js";
import { mediaUrlSanityCheckOnSavedCompactPost } from "./savedCompactPostHealth.js";
import {
  analyzeVideoFastStartNeeds,
  rawPostUsesLegacyAssetsBranch
} from "./videoFastStartRepair.js";
import type { FastStartAssetNeeds } from "./videoFastStartRepair.js";
import { evaluatePosterRepairNeed, type PosterRepairReason } from "./posterRepair.js";

export type VideoPlaybackIssue = {
  assetId: string;
  selectedReason: string | null;
  defaultUrl: string | null;
  primaryUrl: string | null;
  startupUrl: string | null;
  faststartVerified: boolean;
  instantPlaybackReady: boolean;
  assetsReady: boolean;
  missingVariants: string[];
  /** One-line explanation for queue / ops UI */
  summary: string;
};

export type PostRebuildReadiness = {
  /** Structural compact canonical (schema, forbidden keys, required groups). */
  compactOk: boolean;
  /** True when video ladder / readiness is not production-ready (ignored for deleted posts). */
  mediaNeedsRepair: boolean;
  /** Subset: at least one video asset failed strict fast-start readiness. */
  videoNeedsFaststart: boolean;
  /** Safe to skip optimize+write / treat as fully migrated (not for deleted-only shortcut on broken shape). */
  canSkipWrite: boolean;
  reasons: string[];
  warnings: string[];
  missingRequiredPaths: string[];
  forbiddenLivePathsPresent: string[];
  needsCompaction: boolean;
  videoIssues: VideoPlaybackIssue[];
  /** Same as `videoIssues.length` — explicit for NDJSON / migration gates. */
  videoIssueCount: number;
  /** Poster/thumbnail durability gate for video/mixed posts. */
  posterNeedsRepair: boolean;
  posterRepairReason: PosterRepairReason;
};

export type CompactCanonicalCheckResult = {
  /**
   * Same as `canSkipWrite`: document may remain untouched by the rebuilder without losing playback quality.
   * @deprecated Prefer `canSkipWrite` in new code.
   */
  ok: boolean;
  compactOk: boolean;
  canSkipWrite: boolean;
  videoNeedsFaststart: boolean;
  videoIssues: VideoPlaybackIssue[];
  reasons: string[];
  warnings: string[];
  mediaNeedsRepair: boolean;
  needsCompaction: boolean;
  missingRequiredPaths: string[];
  forbiddenLivePathsPresent: string[];
  /** Count of actionable video playback issues (mirrors `videoIssues.length`). */
  videoIssueCount: number;
  posterNeedsRepair: boolean;
  posterRepairReason: PosterRepairReason;
};

const ALLOWED_VARIANT_KEYS = new Set([
  "preview360",
  "preview360Avc",
  "main720",
  "main720Avc",
  "main1080",
  "main1080Avc",
  "hls",
  "poster",
  "startup540FaststartAvc",
  "startup720FaststartAvc",
  "startup1080FaststartAvc",
  "upgrade1080FaststartAvc"
]);

/** Top-level Firestore keys that must not exist on a compact live post. */
const FORBIDDEN_TOP_LEVEL = new Set([
  "audit",
  "normalizationDebug",
  "variantMetadata",
  "playbackLab",
  "mediaProcessingDebug",
  "legacy",
  "diffSummary",
  "migrationDiagnostics"
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function estimateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function nonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

function collectForbiddenTopLevel(doc: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const k of FORBIDDEN_TOP_LEVEL) {
    if (k in doc && doc[k] != null) found.push(k);
  }
  if (nonEmptyArray(doc.likes)) found.push("likes[]");
  if (nonEmptyArray(doc.comments)) found.push("comments[]");
  if (doc.rankingAggregates != null && asRecord(doc.ranking)?.aggregates != null) {
    found.push("rankingAggregates_dup");
  }
  if (doc.rankingRollup != null && asRecord(doc.ranking)?.rollup != null) {
    found.push("rankingRollup_dup");
  }
  return found;
}

function schemaOk(doc: Record<string, unknown>): boolean {
  const s = asRecord(doc.schema);
  return s?.name === "locava.post" && s?.version === 2;
}

function trimStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function isHttpsUrlString(v: unknown): boolean {
  const s = trimStr(v);
  return Boolean(s && /^https?:\/\//i.test(s));
}

/** Deleted posts do not require fast-start / playback ladder repair for skip-write decisions. */
export function isLifecycleDeletedPost(doc: Record<string, unknown>): boolean {
  const lc = asRecord(doc.lifecycle);
  const st = String(lc?.status ?? "").toLowerCase();
  if (st === "deleted") return true;
  if (lc?.isDeleted === true) return true;
  if (doc.deleted === true || doc.isDeleted === true) return true;
  if (trimStr(doc.deletedAt)) return true;
  if (trimStr(lc?.deletedAt)) return true;
  return false;
}

const VERIFIED_STARTUP_SELECTED_REASONS = new Set([
  "verified_startup_avc_faststart_720",
  "verified_startup_avc_faststart_540",
  "verified_startup_avc_faststart_1080"
]);

/**
 * True when `playbackLab` already contains a startup720 fast-start URL for a video asset, but
 * canonical `media.assets[].video.playback` still reflects an original / unverified fallback selection.
 */
export function detectPlaybackLabGeneratedNotPromoted(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc) return false;
  const lab = asRecord(doc.playbackLab);
  const labAssets = asRecord(lab?.assets) ?? {};
  const media = asRecord(doc.media);
  const legacyAssets = Array.isArray(doc.assets) ? (doc.assets as unknown[]) : [];
  const mediaAssets = media && Array.isArray(media.assets) ? (media.assets as unknown[]) : [];
  const assets = mediaAssets.length > 0 ? mediaAssets : legacyAssets;
  const lc = asRecord(doc.lifecycle);
  const lifeSt = String(lc?.status ?? "").toLowerCase();
  if (lifeSt === "deleted") return false;
  if (lifeSt !== "active" && lifeSt !== "processing") return false;

  for (const raw of assets) {
    const ar = asRecord(raw);
    if (!ar || String(ar.type).toLowerCase() !== "video") continue;
    const id = String(ar.id ?? "");
    const labNode = asRecord(labAssets[id]);
    const gen = asRecord(labNode?.generated);
    const rowGen = asRecord(asRecord(ar.playbackLab)?.generated);
    const lab720 =
      (typeof gen?.startup720FaststartAvc === "string" ? gen.startup720FaststartAvc.trim() : "") ||
      (typeof rowGen?.startup720FaststartAvc === "string" ? rowGen.startup720FaststartAvc.trim() : "");
    if (!lab720.startsWith("http")) continue;

    const v = asRecord(ar.video);
    const pb = asRecord(v?.playback);
    const sr = String(pb?.selectedReason ?? "");
    if (VERIFIED_STARTUP_SELECTED_REASONS.has(sr)) continue;

    const def = typeof pb?.defaultUrl === "string" ? pb.defaultUrl.trim() : "";
    const original =
      (typeof v?.originalUrl === "string" ? v.originalUrl.trim() : "") ||
      (typeof pb?.fallbackUrl === "string" ? pb.fallbackUrl.trim() : "") ||
      "";
    if (original && def === original) return true;
    if (sr.toLowerCase().includes("original_unverified") || sr.toLowerCase().includes("processing_fallback")) {
      return true;
    }
  }
  return false;
}

/**
 * Strict playback readiness for a single video asset (rebuilder / post-write gate).
 * Requires verified fast-start ladder URLs + readiness flags (not original-mp4 fallback).
 */
export function analyzeVideoAssetPlaybackReadiness(asset: Record<string, unknown>): VideoPlaybackIssue | null {
  if (asset.type !== "video") return null;
  const assetId = String(asset.id ?? "unknown");
  const v = asRecord(asset.video);
  if (!v) {
    return {
      assetId,
      selectedReason: null,
      defaultUrl: null,
      primaryUrl: null,
      startupUrl: null,
      faststartVerified: false,
      instantPlaybackReady: false,
      assetsReady: false,
      missingVariants: ["video"],
      summary: `Video asset ${assetId} has no video payload.`
    };
  }
  const pb = asRecord(v.playback) ?? {};
  const rd = asRecord(v.readiness) ?? {};
  const variants = asRecord(v.variants) ?? {};
  const pick = (k: string): string | null => {
    const u = variants[k];
    return typeof u === "string" && u.trim() ? u.trim() : null;
  };
  const u720 = pick("startup720FaststartAvc") ?? pick("startup720Faststart");
  const u540 = pick("startup540FaststartAvc") ?? pick("startup540Faststart");
  const has720 = Boolean(u720 && isHttpsUrlString(u720));
  const has540 = Boolean(u540 && isHttpsUrlString(u540));
  const hasStartupVariant = has720 || has540;
  const missingVariants: string[] = [];
  if (!has720) missingVariants.push("startup720FaststartAvc");
  if (!has540) missingVariants.push("startup540FaststartAvc");

  const def = trimStr(pb.defaultUrl);
  const pri = trimStr(pb.primaryUrl);
  const st = trimStr(pb.startupUrl);
  const defOk = isHttpsUrlString(def);
  const priOk = isHttpsUrlString(pri);
  const stOk = isHttpsUrlString(st);

  const sr = trimStr(pb.selectedReason) ?? "";
  const assetsReady = rd.assetsReady === true;
  const instantPlaybackReady = rd.instantPlaybackReady === true;
  const faststartVerified = rd.faststartVerified === true;
  const verifiedReason = VERIFIED_STARTUP_SELECTED_REASONS.has(sr);

  const fails: string[] = [];
  if (!defOk) fails.push("invalid_or_missing_defaultUrl");
  if (!priOk) fails.push("invalid_or_missing_primaryUrl");
  if (!stOk) fails.push("invalid_or_missing_startupUrl");
  if (!assetsReady) fails.push("assetsReady_false");
  if (!instantPlaybackReady) fails.push("instantPlaybackReady_false");
  if (!faststartVerified) fails.push("faststartVerified_false");
  if (!hasStartupVariant) fails.push("missing_startup720_and_startup540_faststart_urls");
  if (!verifiedReason) fails.push(`selectedReason_not_verified_startup(${sr || "empty"})`);

  if (fails.length === 0) return null;

  const fb =
    sr === "fallback_original_or_main" || sr.includes("fallback")
      ? " Uses fallback_original_or_main or other fallback selection without verified ladder."
      : "";

  const summary =
    `Video asset ${assetId}: selectedReason=${sr || "?"} faststartVerified=${faststartVerified} ` +
    `instantPlaybackReady=${instantPlaybackReady} assetsReady=${assetsReady}; ` +
    (hasStartupVariant ? "" : `missing verified startup720/540 URLs (${missingVariants.join(", ")}). `) +
    fails.join("; ") +
    fb;

  return {
    assetId,
    selectedReason: sr || null,
    defaultUrl: def,
    primaryUrl: pri,
    startupUrl: st,
    faststartVerified,
    instantPlaybackReady,
    assetsReady,
    missingVariants: hasStartupVariant ? [] : missingVariants,
    summary: summary.slice(0, 900)
  };
}

/** Map fast-start analyze row to the same `VideoPlaybackIssue` shape used by rebuilder / queue UI. */
export function fastStartNeedToVideoPlaybackIssue(need: FastStartAssetNeeds): VideoPlaybackIssue {
  const missing: string[] = [];
  if (!need.sourceUrl) missing.push("source_video");
  if (need.needs.startup540FaststartAvc) missing.push("startup540FaststartAvc");
  if (need.needs.startup720FaststartAvc) missing.push("startup720FaststartAvc");
  if (need.needs.posterHigh) missing.push("posterHigh");
  if (need.needs.preview360Avc) missing.push("preview360Avc");
  if (need.needs.main720Avc) missing.push("main720Avc");
  const sr = need.sourceUrl ? "faststart_lab_verify_or_encode_pending" : "";
  const summary =
    need.sourceUrl == null
      ? `Video asset ${need.assetId || "unknown"}: missing source URL; cannot verify or generate fast-start ladder.`
      : `Video asset ${need.assetId || "unknown"}: fast-start ladder still incomplete (verified lab outputs or encode required): ${missing.join(", ") || "see_skipReasons"}.`;
  return {
    assetId: need.assetId || "unknown",
    selectedReason: sr || null,
    defaultUrl: need.sourceUrl,
    primaryUrl: need.sourceUrl,
    startupUrl: need.sourceUrl,
    faststartVerified: false,
    instantPlaybackReady: false,
    assetsReady: false,
    missingVariants: missing.length ? missing : ["startup540FaststartAvc", "startup720FaststartAvc"],
    summary: summary.slice(0, 900)
  };
}

function collectStructuralCompact(doc: Record<string, unknown>): {
  reasons: string[];
  warnings: string[];
  missingRequiredPaths: string[];
  forbiddenLivePathsPresent: string[];
  needsCompaction: boolean;
  compactOk: boolean;
} {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const missingRequiredPaths: string[] = [];

  const forbiddenLivePathsPresent = collectForbiddenTopLevel(doc);
  if (forbiddenLivePathsPresent.length) {
    reasons.push(`forbidden_live_fields:${forbiddenLivePathsPresent.join(",")}`);
  }

  if (!schemaOk(doc)) {
    missingRequiredPaths.push("schema.name_version_2");
    reasons.push("invalid_schema");
  }

  const lifecycle = asRecord(doc.lifecycle);
  if (!lifecycle?.status) missingRequiredPaths.push("lifecycle.status");
  if (!lifecycle?.createdAt && lifecycle?.createdAtMs == null) missingRequiredPaths.push("lifecycle.createdAt_or_ms");

  const author = asRecord(doc.author);
  if (!author?.userId) missingRequiredPaths.push("author.userId");

  const text = asRecord(doc.text);
  if (!text?.title && !text?.searchableText) missingRequiredPaths.push("text.title_or_searchableText");

  const classification = asRecord(doc.classification);
  if (!classification?.mediaKind) missingRequiredPaths.push("classification.mediaKind");

  const mediaKind = classification?.mediaKind as string | undefined;
  const media = asRecord(doc.media);
  if (mediaKind === "video" || mediaKind === "mixed" || mediaKind === "image") {
    if (!media) missingRequiredPaths.push("media");
    else {
      const legacyAssetCount = Array.isArray(doc.assets) ? (doc.assets as unknown[]).length : 0;
      if ((!Array.isArray(media.assets) || media.assets.length === 0) && legacyAssetCount === 0) {
        missingRequiredPaths.push("media.assets");
      }
      const ac = typeof media.assetCount === "number" ? media.assetCount : null;
      const al = Array.isArray(media.assets) ? media.assets.length : 0;
      if (ac != null && al > 0 && ac !== al) {
        warnings.push(`media.assetCount_mismatch:${ac}_vs_${al}`);
      }
    }
  }

  const engagement = asRecord(doc.engagement);
  if (engagement) {
    if (typeof engagement.likeCount !== "number") missingRequiredPaths.push("engagement.likeCount");
    if (typeof engagement.commentCount !== "number") missingRequiredPaths.push("engagement.commentCount");
  } else {
    missingRequiredPaths.push("engagement");
  }

  const ep = asRecord(doc.engagementPreview);
  if (ep) {
    if (Array.isArray(ep.recentLikers) && ep.recentLikers.length > 5) {
      reasons.push("engagementPreview.recentLikers_unbounded");
    }
    if (Array.isArray(ep.recentComments) && ep.recentComments.length > 3) {
      reasons.push("engagementPreview.recentComments_unbounded");
    }
  }

  const loc = asRecord(doc.location);
  const coords = asRecord(loc?.coordinates);
  const hadLegacyGeo = doc.lat != null || doc.long != null || doc.lng != null;
  if (hadLegacyGeo || (coords && (coords.lat != null || coords.lng != null))) {
    if (coords?.lat == null || coords?.lng == null) {
      if (hadLegacyGeo) missingRequiredPaths.push("location.coordinates.lat_lng");
    }
  }

  if (missingRequiredPaths.length) {
    reasons.push("missing_required_fields");
  }

  const needsCompaction =
    forbiddenLivePathsPresent.length > 0 || reasons.some((r) => r.includes("unbounded"));

  const compactOk = reasons.length === 0 && missingRequiredPaths.length === 0;

  return {
    reasons,
    warnings,
    missingRequiredPaths,
    forbiddenLivePathsPresent,
    needsCompaction,
    compactOk
  };
}

/**
 * Separates structural compact canonical from playback / media readiness (rebuilder source of truth).
 */
export function evaluatePostRebuildReadiness(doc: Record<string, unknown> | null | undefined): PostRebuildReadiness {
  if (!doc) {
    return {
      compactOk: false,
      mediaNeedsRepair: false,
      videoNeedsFaststart: false,
      canSkipWrite: false,
      reasons: ["doc_null"],
      warnings: [],
      missingRequiredPaths: ["document"],
      forbiddenLivePathsPresent: [],
      needsCompaction: true,
      videoIssues: [],
      videoIssueCount: 0,
      posterNeedsRepair: false,
      posterRepairReason: "poster_missing"
    };
  }

  const structural = collectStructuralCompact(doc);
  const deleted = isLifecycleDeletedPost(doc);
  const classification = asRecord(doc.classification);
  const mediaKind = String(classification?.mediaKind ?? doc.mediaType ?? "")
    .trim()
    .toLowerCase();

  const videoIssues: VideoPlaybackIssue[] = [];
  const postIdForAnalyze = String(doc.id ?? doc.postId ?? "").trim() || "unknown";

  if (!deleted && (mediaKind === "video" || mediaKind === "mixed")) {
    const fast = analyzeVideoFastStartNeeds(doc as Record<string, unknown>, { postId: postIdForAnalyze });
    const addedFromFast = new Set<string>();
    const useLegacy = rawPostUsesLegacyAssetsBranch(doc as Record<string, unknown>);
    const media = asRecord(doc.media);
    const mediaAssets =
      !useLegacy && media && Array.isArray(media.assets) ? (media.assets as unknown[]) : [];

    for (const need of fast.assetNeeds) {
      if (!need.isVideo) continue;
      if (need.alreadyOptimized) continue;
      const id = String(need.assetId ?? "").trim();
      if (!id) continue;

      if (mediaAssets.length > 0) {
        const ar = mediaAssets
          .map((row) => asRecord(row))
          .find((row) => row && String(row.id ?? "").trim() === id && row.type === "video");
        if (ar) {
          const canonicalOk = !analyzeVideoAssetPlaybackReadiness(ar as unknown as MasterPostAssetV2);
          if (canonicalOk) continue;
        }
      }

      videoIssues.push(fastStartNeedToVideoPlaybackIssue(need));
      addedFromFast.add(id);
    }

    if (!useLegacy && media && Array.isArray(media.assets)) {
      for (const a of media.assets) {
        const ar = asRecord(a);
        if (!ar || ar.type !== "video") continue;
        const aid = String(ar.id ?? "").trim();
        if (addedFromFast.has(aid)) continue;
        const issue = analyzeVideoAssetPlaybackReadiness(ar as unknown as MasterPostAssetV2);
        if (issue) videoIssues.push(issue);
      }
    }
  }

  let videoNeedsFaststart = videoIssues.length > 0;
  let mediaNeedsRepair = videoNeedsFaststart;

  let mediaSanityOk = true;
  if (!deleted && structural.compactOk) {
    const sanity = mediaUrlSanityCheckOnSavedCompactPost(doc);
    mediaSanityOk = sanity.ok;
    if (!mediaSanityOk) {
      mediaNeedsRepair = true;
    }
  }

  const allReasons = [...structural.reasons];
  for (const vi of videoIssues) {
    allReasons.push(`video_playback_not_ready:${vi.assetId}`);
  }
  const promotionGap = !deleted && detectPlaybackLabGeneratedNotPromoted(doc);
  if (promotionGap) {
    allReasons.push("generated_variants_not_promoted_to_canonical_media");
    videoNeedsFaststart = true;
    mediaNeedsRepair = true;
  }
  if (!deleted && structural.compactOk && !mediaSanityOk) {
    allReasons.push("media_url_sanity_failed");
  }
  const posterEval = evaluatePosterRepairNeed(doc, {
    configuredPublicBases: [
      process.env.LOCAVA_PUBLIC_ASSET_BASE ?? "",
      process.env.WASABI_ENDPOINT ?? "",
      process.env.NEXT_PUBLIC_WASABI_ENDPOINT ?? ""
    ].filter(Boolean)
  });
  const posterNeedsRepair = !deleted && posterEval.needsPosterRepair;
  if (posterNeedsRepair) {
    allReasons.push(`poster_repair_required:${posterEval.reason}`);
    mediaNeedsRepair = true;
  }

  const canSkipWrite = deleted
    ? structural.compactOk
    : structural.compactOk && !videoNeedsFaststart && mediaSanityOk && !promotionGap && !posterNeedsRepair;

  return {
    compactOk: structural.compactOk,
    mediaNeedsRepair,
    videoNeedsFaststart,
    canSkipWrite,
    reasons: allReasons,
    warnings: structural.warnings,
    missingRequiredPaths: structural.missingRequiredPaths,
    forbiddenLivePathsPresent: structural.forbiddenLivePathsPresent,
    needsCompaction: structural.needsCompaction,
    videoIssues,
    videoIssueCount: videoIssues.length,
    posterNeedsRepair,
    posterRepairReason: posterEval.reason
  };
}

/**
 * Returns whether the Firestore-shaped document may be skipped by the rebuilder (`canSkipWrite`)
 * plus structural / media diagnostics.
 */
export function isCompactCanonicalPostV2(doc: Record<string, unknown> | null | undefined): CompactCanonicalCheckResult {
  const r = evaluatePostRebuildReadiness(doc);
  return {
    ok: r.canSkipWrite,
    compactOk: r.compactOk,
    canSkipWrite: r.canSkipWrite,
    videoNeedsFaststart: r.videoNeedsFaststart,
    videoIssues: r.videoIssues,
    videoIssueCount: r.videoIssueCount,
    posterNeedsRepair: r.posterNeedsRepair,
    posterRepairReason: r.posterRepairReason,
    reasons: r.reasons,
    warnings: r.warnings,
    mediaNeedsRepair: r.mediaNeedsRepair,
    needsCompaction: r.needsCompaction,
    missingRequiredPaths: r.missingRequiredPaths,
    forbiddenLivePathsPresent: r.forbiddenLivePathsPresent
  };
}

/** Compact canonical video post still in async encoding / fallback playback (Master Post V2). */
export function isCompactProcessingPostV2(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc) return false;
  if (!schemaOk(doc)) return false;
  const lc = asRecord(doc.lifecycle);
  if (String(lc?.status ?? "").toLowerCase() !== "processing") return false;
  const media = asRecord(doc.media);
  if (String(media?.status ?? "").toLowerCase() !== "processing") return false;
  return true;
}

/** Fully migrated live post: structural compact + rebuilder skip + active lifecycle + media ready. */
export function isCompactReadyPostV2(doc: Record<string, unknown> | null | undefined): boolean {
  const r = evaluatePostRebuildReadiness(doc);
  if (!r.compactOk || !r.canSkipWrite) return false;
  const lc = asRecord(doc?.lifecycle);
  if (String(lc?.status ?? "").toLowerCase() !== "active") return false;
  const media = asRecord(doc?.media);
  return String(media?.status ?? "").toLowerCase() === "ready";
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      const n = stripUndefinedDeep(v);
      if (n !== undefined) out[k] = n;
    }
    return out;
  }
  return value;
}

function compactVariants(variants: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!variants) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variants)) {
    if (!ALLOWED_VARIANT_KEYS.has(k)) continue;
    if (typeof v === "string" && v.trim()) out[k] = v;
    else if (v != null && typeof v !== "object") out[k] = v as unknown;
  }
  return out;
}

function applyCompactVideoPlayback(video: Record<string, unknown>): void {
  const pb = asRecord(video.playback) ?? {};
  const variants = asRecord(video.variants) ?? {};
  const pick = (k: string): string | null => {
    const v = variants[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const startup720 = pick("startup720FaststartAvc") ?? pick("startup720Faststart");
  const startup540 = pick("startup540FaststartAvc") ?? pick("startup540Faststart");
  const main720Avc = pick("main720Avc");
  const main720 = pick("main720");
  const preview360 = pick("preview360Avc") ?? pick("preview360");
  const hls = pick("hls");
  const original =
    (typeof video.originalUrl === "string" && video.originalUrl.trim()) ||
    (typeof pb.fallbackUrl === "string" && pb.fallbackUrl.trim()) ||
    null;

  let selected = startup720 ?? startup540 ?? main720Avc ?? main720 ?? original;
  let selectedReason = "fallback_original_or_main";
  if (startup720) {
    selected = startup720;
    selectedReason = "verified_startup_avc_faststart_720";
  } else if (startup540) {
    selected = startup540;
    selectedReason = "verified_startup_avc_faststart_540";
  } else if (main720Avc) {
    selected = main720Avc;
    selectedReason = "main720Avc";
  }

  const upgrade1080 = pick("upgrade1080FaststartAvc");

  video.playback = {
    ...pb,
    defaultUrl: selected,
    primaryUrl: selected,
    startupUrl: selected,
    goodNetworkUrl: startup720 ?? main720Avc ?? main720 ?? selected,
    weakNetworkUrl: startup720 ?? startup540 ?? main720Avc ?? selected,
    poorNetworkUrl: startup540 ?? startup720 ?? selected,
    highQualityUrl: upgrade1080 ?? startup720 ?? main720Avc ?? main720 ?? selected,
    upgradeUrl: upgrade1080 ?? startup720 ?? main720Avc ?? selected,
    fallbackUrl: original ?? pb.fallbackUrl ?? null,
    previewUrl: preview360 ?? pb.previewUrl ?? null,
    hlsUrl: hls ?? pb.hlsUrl ?? null,
    selectedReason
  };
}

function compactMediaAsset(asset: MasterPostAssetV2): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: asset.id,
    index: asset.index,
    type: asset.type,
    source: asset.source,
    presentation: asset.presentation
  };
  if (asset.image) {
    base.image = { ...asset.image };
  }
  if (asset.type === "video" && base.image) {
    const img = asRecord(base.image);
    const hasImagePayload =
      img &&
      Object.values(img).some((v) => v != null && !(typeof v === "string" && String(v).trim() === ""));
    if (!hasImagePayload) delete base.image;
  }
  if (asset.video && asset.type === "video") {
    const v = { ...(asset.video as unknown as Record<string, unknown>) };
    v.variants = compactVariants(asRecord(v.variants));
    applyCompactVideoPlayback(v);
    const tech = asRecord(v.technical) ?? {};
    v.technical = {
      sourceCodec: tech.sourceCodec ?? null,
      playbackCodec: tech.playbackCodec ?? null,
      audioCodec: tech.audioCodec ?? null
    };
    base.video = v;
  } else if (asset.type === "image" && "video" in base) {
    delete base.video;
  }
  return stripUndefinedDeep(base) as Record<string, unknown>;
}

export type CompactCanonicalWriteResult = {
  livePost: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  removedPaths: string[];
  preservedCompatibilityPaths: string[];
  byteEstimateBefore: number;
  byteEstimateAfter: number;
  warnings: string[];
};

/**
 * Build a production-safe live document from normalized canonical + raw (for mirrors).
 */
export function compactCanonicalPostForLiveWrite(input: {
  canonical: MasterPostV2;
  rawBefore: Record<string, unknown>;
  postId: string;
}): CompactCanonicalWriteResult {
  const { canonical, rawBefore, postId } = input;
  const warnings: string[] = [];
  const removedPaths: string[] = [
    "audit",
    "legacy",
    "normalizationDebug",
    "variantMetadata",
    "playbackLab",
    "top_level_likes",
    "top_level_comments",
    "duplicate_ranking_top_level"
  ];

  const diagnostics: Record<string, unknown> = {
    removedFieldList: [...removedPaths],
    backupHint: "postCanonicalBackups",
    legacy: canonical.legacy,
    audit: canonical.audit,
    rawPlaybackLab: rawBefore.playbackLab,
    rawVariantMetadata: rawBefore.variantMetadata,
    rawNormalizationDebug: rawBefore.normalizationDebug,
    embeddedLikesSample: Array.isArray(rawBefore.likes) ? (rawBefore.likes as unknown[]).slice(0, 5) : null,
    embeddedCommentsSample: Array.isArray(rawBefore.comments) ? (rawBefore.comments as unknown[]).slice(0, 3) : null,
    rankingAggregatesTopLevel: rawBefore.rankingAggregates ?? null,
    rankingRollupTopLevel: rawBefore.rankingRollup ?? null
  };

  const mediaAssets = (canonical.media.assets ?? []).map(compactMediaAsset);
  const livePost: Record<string, unknown> = {
    id: postId,
    schema: { ...canonical.schema },
    lifecycle: { ...canonical.lifecycle },
    author: { ...canonical.author },
    text: { ...canonical.text },
    location: { ...canonical.location },
    classification: { ...canonical.classification },
    media: {
      status: canonical.media.status,
      assetCount: mediaAssets.length,
      rawAssetCount: canonical.media.rawAssetCount,
      primaryAssetId: canonical.media.primaryAssetId,
      coverAssetId: canonical.media.coverAssetId,
      hasMultipleAssets: canonical.media.hasMultipleAssets,
      assetsReady: canonical.media.assetsReady,
      instantPlaybackReady: canonical.media.instantPlaybackReady,
      completeness: canonical.media.completeness,
      presentation: canonical.media.presentation ?? null,
      cover: { ...canonical.media.cover },
      assets: mediaAssets
    },
    engagement: { ...canonical.engagement },
    engagementPreview: {
      recentLikers: (canonical.engagementPreview.recentLikers ?? []).slice(0, 5),
      recentComments: (canonical.engagementPreview.recentComments ?? []).slice(0, 3)
    },
    ...(() => {
      const agg = canonical.ranking?.aggregates;
      const roll = canonical.ranking?.rollup;
      const hasMeaningful = (v: unknown) =>
        v != null &&
        typeof v === "object" &&
        Object.values(v as Record<string, unknown>).some((x) => x != null && x !== "");
      const hasAgg = hasMeaningful(agg);
      const hasRoll = hasMeaningful(roll);
      if (!hasAgg && !hasRoll) return {};
      const ranking: Record<string, unknown> = {};
      if (hasAgg) ranking.aggregates = agg;
      if (hasRoll) ranking.rollup = roll;
      return { ranking };
    })(),
    compatibility: (() => {
      const c = { ...canonical.compatibility } as Record<string, unknown>;
      if (canonical.classification.mediaKind === "image") {
        if (c.posterUrl == null || c.posterUrl === "") delete c.posterUrl;
        if (c.fallbackVideoUrl == null || c.fallbackVideoUrl === "") delete c.fallbackVideoUrl;
      }
      return c;
    })()
  };

  const mirrors: Record<string, unknown> = {};
  const m = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") mirrors[k] = v;
  };
  m("userId", canonical.author.userId ?? rawBefore.userId);
  m("userName", rawBefore.userName ?? canonical.author.displayName);
  m("userHandle", rawBefore.userHandle ?? canonical.author.handle);
  m("userPic", rawBefore.userPic ?? canonical.author.profilePicUrl);
  m("title", canonical.text.title ?? rawBefore.title);
  m("content", canonical.text.content ?? rawBefore.content);
  if (canonical.classification.activities?.length) {
    m("activities", canonical.classification.activities);
  } else if (Array.isArray(rawBefore.activities) && rawBefore.activities.length) {
    m("activities", rawBefore.activities);
  }
  m("privacy", rawBefore.privacy);
  m("settingType", canonical.classification.settingType ?? rawBefore.settingType);
  m("reel", canonical.classification.reel);
  m("isBoosted", canonical.classification.isBoosted);
  m("showLikes", canonical.engagement.showLikes ?? rawBefore.showLikes);
  m("showComments", canonical.engagement.showComments ?? rawBefore.showComments);
  m("time", canonical.lifecycle.createdAt ?? rawBefore.time);
  m("updatedAt", canonical.lifecycle.updatedAt ?? rawBefore.updatedAt);
  m("lat", canonical.location.coordinates.lat ?? rawBefore.lat);
  m("long", canonical.location.coordinates.lng ?? rawBefore.long ?? rawBefore.lng);
  m("geohash", canonical.location.coordinates.geohash ?? rawBefore.geohash);
  m("address", canonical.location.display.address ?? rawBefore.address);
  m("stateRegionId", canonical.location.regions.stateRegionId ?? rawBefore.stateRegionId);
  m("cityRegionId", canonical.location.regions.cityRegionId ?? rawBefore.cityRegionId);
  m("countryRegionId", canonical.location.regions.countryRegionId ?? rawBefore.countryRegionId);
  m("assetsReady", canonical.media.assetsReady);
  m("photoLink", canonical.compatibility.photoLink);
  m("displayPhotoLink", canonical.compatibility.displayPhotoLink);
  m("photoLinks2", canonical.compatibility.photoLinks2);
  m("photoLinks3", canonical.compatibility.photoLinks3);
  m("thumbUrl", canonical.compatibility.thumbUrl ?? rawBefore.thumbUrl);
  m("posterUrl", canonical.compatibility.posterUrl ?? rawBefore.posterUrl);
  m("fallbackVideoUrl", canonical.compatibility.fallbackVideoUrl);
  m("mediaType", canonical.compatibility.mediaType);

  Object.assign(livePost, mirrors);

  const byteEstimateBefore = estimateJsonBytes(rawBefore);
  const stripped = stripUndefinedDeep(livePost) as Record<string, unknown>;
  const byteEstimateAfter = estimateJsonBytes(stripped);

  diagnostics.byteEstimateBefore = byteEstimateBefore;
  diagnostics.byteEstimateAfter = byteEstimateAfter;
  diagnostics.compactionDiffBytes = byteEstimateBefore - byteEstimateAfter;

  return {
    livePost: stripped,
    diagnostics,
    removedPaths,
    preservedCompatibilityPaths: Object.keys(mirrors),
    byteEstimateBefore,
    byteEstimateAfter,
    warnings
  };
}
