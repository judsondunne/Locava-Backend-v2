import type {
  CanonicalizationError,
  CanonicalizationResult,
  CanonicalizationWarning,
  MasterPostAssetTypeV2,
  MasterPostLetterboxGradientV2,
  MasterPostLifecycleStatusV2,
  MasterPostMediaKindV2,
  MasterPostMediaStatusV2,
  MasterPostRecentCommentPreviewV2,
  MasterPostV2,
  PostEngagementSourceAuditV2
} from "../../../contracts/master-post-v2.types.js";
import { classifyMediaUrl, isVideoUrl } from "./mediaUrlClassifier.js";

type RawPost = Record<string, any>;

export type NormalizeMasterPostV2Options = {
  postId?: string;
  now?: Date;
  preserveRawLegacy?: boolean;
  strict?: boolean;
  /** Optional Firestore engagement audit (preview/write). When set, drives counts + recent liker preview. */
  engagementSourceAudit?: PostEngagementSourceAuditV2 | null;
  /**
   * Native `/v2/posting/finalize` path: stamp schema/audit for a first-write canonical Master Post V2 doc
   * (not a rebuilder backfill).
   */
  postingFinalizeV2?: boolean;
};

type NormalizeOptions = NormalizeMasterPostV2Options;

const toObject = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" ? (value as Record<string, any>) : null;

const toTrimmed = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const t = value.trim();
    if (t) return t;
  }
  return null;
};

const toStringPreserve = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return "";
};

const toNum = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
};

const toBool = (value: unknown, fallback = false): boolean => (typeof value === "boolean" ? value : fallback);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "toDate" in (value as Record<string, unknown>)) {
    try {
      return ((value as { toDate: () => Date }).toDate()).toISOString();
    } catch {
      return null;
    }
  }
  return null;
};

/** Milliseconds from Firestore / protobuf timestamp shapes, including sub-millisecond nanoseconds. */
function firestoreTimestampLikeToUnixMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value > 10_000_000_000 ? value : value * 1000;
    return Math.floor(normalized);
  }
  if (typeof value === "string" && value.trim()) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.toMillis === "function") {
    try {
      const v = (o as { toMillis: () => number }).toMillis();
      return Number.isFinite(v) ? Math.floor(v) : null;
    } catch {
      return null;
    }
  }
  if (typeof o.toDate === "function") {
    try {
      const d = (o as { toDate: () => Date }).toDate();
      const t = d.getTime();
      return Number.isFinite(t) ? Math.floor(t) : null;
    } catch {
      return null;
    }
  }
  const sec =
    typeof o.seconds === "number" && Number.isFinite(o.seconds)
      ? o.seconds
      : typeof o._seconds === "number" && Number.isFinite(o._seconds)
        ? o._seconds
        : null;
  if (sec === null) return null;
  const nanoRaw =
    typeof o.nanoseconds === "number"
      ? o.nanoseconds
      : typeof o._nanoseconds === "number"
        ? o._nanoseconds
        : 0;
  const nano = Number.isFinite(nanoRaw) ? nanoRaw : 0;
  return Math.floor(sec * 1000 + Math.floor(nano / 1_000_000));
}

type LifecycleCreatedAtMsDerivation = {
  ms: number | null;
  source: "createdAtMs" | "time" | "createdAt" | "time-created" | "updatedAt" | null;
};

function deriveLifecycleCreatedAtMs(rawPost: RawPost): LifecycleCreatedAtMsDerivation {
  const fromCreatedAtMs = pickNumericOrNull(rawPost.createdAtMs);
  if (fromCreatedAtMs !== null) {
    return { ms: Math.floor(fromCreatedAtMs), source: "createdAtMs" };
  }
  const timeMs = firestoreTimestampLikeToUnixMs(rawPost.time);
  if (timeMs !== null) return { ms: timeMs, source: "time" };
  const createdAtMs = firestoreTimestampLikeToUnixMs(rawPost.createdAt);
  if (createdAtMs !== null) return { ms: createdAtMs, source: "createdAt" };
  const timeCreatedMs = firestoreTimestampLikeToUnixMs(rawPost["time-created"]);
  if (timeCreatedMs !== null) return { ms: timeCreatedMs, source: "time-created" };
  const updatedMs = firestoreTimestampLikeToUnixMs(rawPost.updatedAt);
  if (updatedMs !== null) return { ms: updatedMs, source: "updatedAt" };
  return { ms: null, source: null };
}

function rawPostHasLifecycleTimestampCandidates(rawPost: RawPost): boolean {
  return (
    rawPost.createdAtMs != null ||
    rawPost.time != null ||
    rawPost.createdAt != null ||
    rawPost["time-created"] != null ||
    rawPost.updatedAt != null
  );
}

const pushWarning = (warnings: CanonicalizationWarning[], code: string, message: string, path?: string): void => {
  warnings.push({ code, message, path });
};
const pushError = (errors: CanonicalizationError[], code: string, message: string, blocking: boolean, path?: string): void => {
  errors.push({ code, message, blocking, path });
};

function classifyMediaKind(assets: Array<{ type: MasterPostAssetTypeV2 }>, mediaType: string | null): MasterPostMediaKindV2 {
  if (assets.length === 0) return mediaType === "text" ? "text" : "unknown";
  const hasImage = assets.some((a) => a.type === "image");
  const hasVideo = assets.some((a) => a.type === "video");
  if (hasImage && hasVideo) return "mixed";
  if (hasVideo) return "video";
  if (hasImage) return "image";
  return "unknown";
}

function normalizeVisibility(value: string | null): "public" | "friends" | "private" | "unknown" {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (["public", "public spot"].includes(normalized)) return "public";
  if (["friends", "friends spot"].includes(normalized)) return "friends";
  if (["private", "private spot"].includes(normalized)) return "private";
  return "unknown";
}

function resolvePostSource(rawPost: RawPost): "user" | "admin" | "imported" | "seeded" | "unknown" {
  if (toBool(rawPost.isAdminPost) || toBool(rawPost.adminCreated)) return "admin";
  if (toBool(rawPost.isImported) || toTrimmed(rawPost.importSource)) return "imported";
  if (toBool(rawPost.seeded) || toBool(rawPost.isSeedData)) return "seeded";
  if (toTrimmed(rawPost.userId, rawPost.authorId, rawPost.sessionId, rawPost.stagedSessionId)) return "user";
  return "unknown";
}

function pickNumericOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function uniqBy<T>(items: T[], key: (item: T) => string): { deduped: T[]; dedupedCount: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  let dedupedCount = 0;
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) {
      dedupedCount += 1;
      continue;
    }
    seen.add(k);
    out.push(item);
  }
  return { deduped: out, dedupedCount };
}

const RECENT_COMMENTS_PREVIEW = 5;

function inferMissingImageHeightFromAspect(
  width: number | null,
  height: number | null | undefined,
  aspectRatio: number | null | undefined
): number | null {
  if (height != null && typeof height === "number" && Number.isFinite(height)) return height;
  if (width == null || typeof width !== "number" || !Number.isFinite(width) || width <= 0) return null;
  if (aspectRatio == null || typeof aspectRatio !== "number" || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  return Math.round(width / aspectRatio);
}

function inferImageHeightsOnAssets(assets: MasterPostV2["media"]["assets"]): void {
  for (const asset of assets) {
    if (asset.type !== "image" || !asset.image) continue;
    if (asset.image.height != null && typeof asset.image.height === "number" && Number.isFinite(asset.image.height)) continue;
    const inferred = inferMissingImageHeightFromAspect(asset.image.width, asset.image.height, asset.image.aspectRatio);
    if (inferred !== null) asset.image.height = inferred;
  }
}

/** Maps embedded `comments[]`, Firestore subcollection payloads, or audit `recentComments` rows. */
function mapRawOrSubDocToRecentComment(entry: Record<string, unknown>): MasterPostRecentCommentPreviewV2 {
  const idRaw = entry.id ?? entry.commentId;
  const commentId = idRaw !== undefined && idRaw !== null ? String(idRaw) : "";
  const replies = Array.isArray(entry.replies) ? entry.replies : [];
  const replyCount =
    typeof entry.replyCount === "number" && Number.isFinite(entry.replyCount)
      ? Math.max(0, Math.floor(entry.replyCount))
      : replies.length;
  const contentRaw = entry.content ?? entry.text;
  const text = typeof contentRaw === "string" ? contentRaw : contentRaw != null ? String(contentRaw) : "";
  return {
    commentId,
    userId: toTrimmed(entry.userId, entry.uid) ?? "unknown",
    displayName: toTrimmed(entry.userName, entry.displayName, entry.name),
    handle: toTrimmed(entry.userHandle, entry.handle),
    profilePicUrl: toTrimmed(entry.userPic, entry.profilePicUrl, entry.photoUrl),
    text,
    createdAt: toIso(entry.time ?? entry.createdAt ?? entry.createdAtMs ?? entry.timestamp),
    replyCount
  };
}

function sortRecentCommentsPreviewDesc(rows: MasterPostRecentCommentPreviewV2[]): MasterPostRecentCommentPreviewV2[] {
  return [...rows].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const tb = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return tb - ta;
  });
}

function previewCommentsFromEmbedded(commentsRows: unknown[]): MasterPostRecentCommentPreviewV2[] {
  const mapped = commentsRows
    .map((c) => mapRawOrSubDocToRecentComment(toObject(c) ?? {}))
    .filter((row) => row.commentId.trim() !== "" || row.text !== "" || row.userId !== "unknown");
  return sortRecentCommentsPreviewDesc(mapped).slice(0, RECENT_COMMENTS_PREVIEW);
}

function previewCommentsFromAuditSubcollection(rows: Array<Record<string, unknown>>): MasterPostRecentCommentPreviewV2[] {
  const mapped = rows.map((row) => mapRawOrSubDocToRecentComment(row));
  return sortRecentCommentsPreviewDesc(mapped).slice(0, RECENT_COMMENTS_PREVIEW);
}

function normalizeGradientCandidate(value: unknown): MasterPostLetterboxGradientV2 | null {
  const row = toObject(value);
  if (!row) return null;
  const top = toTrimmed(row.top, row.letterboxGradientTop);
  const bottom = toTrimmed(row.bottom, row.letterboxGradientBottom);
  if (!top && !bottom) return null;
  const sourceRaw = row.source;
  const source = typeof sourceRaw === "string" && sourceRaw.trim() ? sourceRaw.trim() : null;
  const out: MasterPostLetterboxGradientV2 = { top: top ?? null, bottom: bottom ?? null };
  if (source) out.source = source;
  return out;
}

type CanonicalVideoSelectionInput = {
  playback: Record<string, string | null>;
  originalUrl: string | null;
  previewUrl: string | null;
  verifiedFaststartUrls: Set<string>;
};

type CanonicalVideoSelectionResult = {
  selectedGoodNetworkUrl: string | null;
  selectedWeakNetworkUrl: string | null;
  selectedPoorNetworkUrl: string | null;
  selectedPreviewUrl: string | null;
  fallbackUrl: string | null;
  selectedReason:
    | "verified_startup_avc_faststart_1080"
    | "verified_startup_avc_faststart_720"
    | "verified_avc_faststart_1080"
    | "verified_avc_faststart_720"
    | "verified_avc_faststart_540"
    | "verified_avc_faststart_preview360"
    | "verified_original_faststart_fallback"
    | "preview_emergency_fallback"
    | "original_unverified_fallback";
  hasVerifiedOptimizedPlayback: boolean;
  hasVerifiedPlayback: boolean;
  aliasStartup1080FromMain: boolean;
  aliasStartup720FromMain: boolean;
};

function normalizeVerifyUrl(...values: unknown[]): string | null {
  return toTrimmed(...values);
}

function isMoovPrefixFaststartHint(value: unknown): boolean {
  return (toTrimmed(value) ?? "").toLowerCase() === "moov_before_mdat_in_prefix";
}

function collectVerifiedFaststartUrls(
  rows: Array<Record<string, any>>,
  trustedContainers: Array<Record<string, any> | null>
): Set<string> {
  const verified = new Set<string>();
  const isProbeHeadOk = (head: Record<string, any> | null): boolean => {
    if (!head) return false;
    if (head.ok === true) return true;
    const status = typeof head.status === "number" ? head.status : null;
    if (status == null || status < 200 || status >= 300) return false;
    const contentType = (toTrimmed(head.contentType, head["content-type"]) ?? "").toLowerCase();
    const acceptRanges = (toTrimmed(head.acceptRanges, head["accept-ranges"]) ?? "").toLowerCase();
    return contentType.includes("video/mp4") && acceptRanges === "bytes";
  };
  const rowVerified = (row: Record<string, any>): boolean => {
    if (row.ok === true && isMoovPrefixFaststartHint(row.moovHint)) return true;
    const probe = toObject(row.probe);
    if (probe && isProbeHeadOk(toObject(probe.head)) && isMoovPrefixFaststartHint(probe.moovHint)) return true;
    return false;
  };
  for (const row of rows) {
    const url = normalizeVerifyUrl(row.url, row.targetUrl, row.sourceUrl, toObject(row.result)?.url, toObject(row.probe)?.url);
    if (!url) continue;
    if (!rowVerified(row)) continue;
    verified.add(url);
  }
  for (const container of trustedContainers) {
    if (!container) continue;
    const byUrl = toObject(container.byUrl) ?? toObject(container.urls) ?? null;
    if (!byUrl) continue;
    for (const [urlKey, rawValue] of Object.entries(byUrl)) {
      const url = normalizeVerifyUrl(urlKey);
      if (!url) continue;
      if (rawValue === true) {
        verified.add(url);
        continue;
      }
      const row = toObject(rawValue);
      if (!row) continue;
      if (rowVerified(row)) verified.add(url);
    }
  }
  return verified;
}

function selectCanonicalVideoPlaybackAsset(input: CanonicalVideoSelectionInput): CanonicalVideoSelectionResult {
  const pick = (...values: Array<string | null>) => values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
  const isVerified = (url: string | null): url is string => Boolean(url && input.verifiedFaststartUrls.has(url));
  const p = input.playback;

  const startup1080FaststartAvc = pick(p.startup1080FaststartAvc);
  const startup1080Faststart = pick(p.startup1080Faststart);
  const main1080Avc = pick(p.main1080Avc);
  const startup720FaststartAvc = pick(p.startup720FaststartAvc);
  const startup720Faststart = pick(p.startup720Faststart);
  const main720Avc = pick(p.main720Avc);
  const startup540FaststartAvc = pick(p.startup540FaststartAvc);
  const preview360Avc = pick(input.previewUrl, p.preview360Avc, p.preview360);
  const originalUrl = pick(input.originalUrl);

  const verified1080 = [startup1080FaststartAvc, startup1080Faststart, main1080Avc].find((url) => isVerified(url ?? null)) ?? null;
  const verified720 = [startup720FaststartAvc, startup720Faststart, main720Avc].find((url) => isVerified(url ?? null)) ?? null;
  const verified540 = [startup540FaststartAvc].find((url) => isVerified(url ?? null)) ?? null;
  const verifiedPreview = isVerified(preview360Avc) ? preview360Avc : null;
  const verifiedOriginal = isVerified(originalUrl) ? originalUrl : null;

  const selectedGoodNetworkUrl = verified1080 ?? verified720 ?? verified540 ?? verifiedPreview ?? originalUrl;
  const selectedWeakNetworkUrl = verified720 ?? verified1080 ?? verified540 ?? selectedGoodNetworkUrl;
  const selectedPoorNetworkUrl = verified540 ?? verifiedPreview ?? selectedWeakNetworkUrl ?? selectedGoodNetworkUrl;
  const hasVerifiedOptimizedPlayback = Boolean(verified1080 || verified720 || verified540 || verifiedPreview);
  const hasVerifiedPlayback = hasVerifiedOptimizedPlayback || Boolean(verifiedOriginal);

  const selectedReason: CanonicalVideoSelectionResult["selectedReason"] = verified1080
    ? selectedGoodNetworkUrl === startup1080FaststartAvc || selectedGoodNetworkUrl === startup1080Faststart
      ? "verified_startup_avc_faststart_1080"
      : "verified_avc_faststart_1080"
    : verified720
      ? selectedGoodNetworkUrl === startup720FaststartAvc || selectedGoodNetworkUrl === startup720Faststart
        ? "verified_startup_avc_faststart_720"
        : "verified_avc_faststart_720"
      : verified540
        ? "verified_avc_faststart_540"
        : verifiedPreview
          ? "verified_avc_faststart_preview360"
          : verifiedOriginal
            ? "verified_original_faststart_fallback"
            : preview360Avc
          ? "preview_emergency_fallback"
          : "original_unverified_fallback";

  return {
    selectedGoodNetworkUrl,
    selectedWeakNetworkUrl,
    selectedPoorNetworkUrl,
    selectedPreviewUrl: preview360Avc,
    fallbackUrl: originalUrl ?? selectedGoodNetworkUrl,
    selectedReason,
    hasVerifiedOptimizedPlayback,
    hasVerifiedPlayback,
    aliasStartup1080FromMain: Boolean(!startup1080FaststartAvc && main1080Avc && isVerified(main1080Avc)),
    aliasStartup720FromMain: Boolean(!startup720FaststartAvc && main720Avc && isVerified(main720Avc))
  };
}

function parseGeneratedOutputs(value: unknown): Record<string, unknown> {
  const direct = toObject(value);
  if (direct) return direct;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return toObject(parsed) ?? {};
  } catch {
    return {};
  }
}

export function normalizeMasterPostV2(rawPost: RawPost, options: NormalizeOptions = {}): CanonicalizationResult {
  const warnings: CanonicalizationWarning[] = [];
  const errors: CanonicalizationError[] = [];
  const now = options.now ?? new Date();
  const postId = toTrimmed(options.postId, rawPost.id, rawPost.postId) ?? "unknown-post";
  const legacy = toObject(rawPost.legacy) ?? {};
  const playbackLab = toObject(rawPost.playbackLab) ?? {};
  const mediaObj = toObject(rawPost.media) ?? {};

  const authorObj = toObject(rawPost.author) ?? {};
  const author = {
    userId: toTrimmed(rawPost.userId, authorObj.userId),
    displayName: toTrimmed(rawPost.userName, authorObj.displayName, authorObj.name),
    handle: toTrimmed(rawPost.userHandle, authorObj.handle),
    profilePicUrl: toTrimmed(rawPost.userPic, authorObj.profilePicUrl, authorObj.photoUrl)
  };

  const text = {
    title: toStringPreserve(rawPost.title),
    caption: toStringPreserve(rawPost.caption),
    description: toStringPreserve(rawPost.description),
    content: toStringPreserve(rawPost.content),
    searchableText: ""
  };
  const textArray = Array.isArray(rawPost.texts) ? rawPost.texts.filter((x: unknown) => typeof x === "string") : [];
  text.searchableText = [
    text.title,
    text.caption,
    text.description,
    text.content,
    ...textArray,
    ...(Array.isArray(rawPost.activities) ? rawPost.activities.map((v: unknown) => String(v)) : []),
    toTrimmed(rawPost.placeName, rawPost.place, rawPost.address, rawPost.locationLabel, rawPost.city, rawPost.state) ?? ""
  ]
    .filter((x): x is string => typeof x === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const geoData = toObject(rawPost.geoData) ?? {};
  const addressLine = toTrimmed(rawPost.address);
  const city = toTrimmed(geoData.city);
  const state = toTrimmed(geoData.state);
  const country = toTrimmed(geoData.country);
  const displaySubtitle =
    city && country
      ? `${city}, ${country}`
      : state && country
        ? `${state}, ${country}`
        : city && state
          ? `${city}, ${state}`
          : toTrimmed(rawPost.locationLabel);
  const locationDisplayName =
    toTrimmed(
      rawPost.addressDisplayName,
      rawPost.locationDisplayName,
      addressLine,
      rawPost.placeName,
      rawPost.place
    ) ?? null;
  const locationDisplayLabel =
    toTrimmed(rawPost.locationLabel, addressLine, locationDisplayName ?? undefined) ?? locationDisplayName;
  const location = {
    coordinates: {
      lat: toNum(rawPost.lat, geoData.lat),
      lng: toNum(rawPost.lng, rawPost.long, geoData.lng, geoData.long),
      geohash: toTrimmed(rawPost.geohash, geoData.geohash)
    },
    display: {
      address: addressLine,
      name: locationDisplayName,
      subtitle: displaySubtitle ?? null,
      label: locationDisplayLabel
    },
    place: {
      placeId: toTrimmed(rawPost.placeId),
      placeName: toTrimmed(rawPost.placeName, rawPost.place),
      source: (toTrimmed(rawPost.locationSource) as any) ?? "unknown",
      precision: (toTrimmed(rawPost.fallbackPrecision) as any) ?? "unknown"
    },
    regions: {
      city,
      state,
      country,
      cityRegionId: toTrimmed(rawPost.cityRegionId),
      stateRegionId: toTrimmed(rawPost.stateRegionId),
      countryRegionId: toTrimmed(rawPost.countryRegionId)
    }
  };

  const lifecycleCreatedAtMsDerivation = deriveLifecycleCreatedAtMs(rawPost);
  const lifecycle: MasterPostV2["lifecycle"] = {
    status: "active" as MasterPostLifecycleStatusV2,
    isDeleted: toBool(rawPost.deleted, false) || toBool(rawPost.isDeleted, false),
    deletedAt: toIso(rawPost.deletedAt),
    createdAt: toIso(rawPost.createdAt ?? rawPost.time),
    createdAtMs: lifecycleCreatedAtMsDerivation.ms,
    updatedAt: toIso(rawPost.updatedAt ?? rawPost.lastUpdated),
    lastMediaUpdatedAt: toIso(rawPost.reelUpdatedAt ?? rawPost.updatedAt),
    lastUserVisibleAt: toIso(rawPost.updatedAt ?? rawPost.time)
  };
  if (lifecycle.isDeleted) lifecycle.status = "deleted";
  else {
    const mediaStatus = toTrimmed(rawPost.mediaStatus, rawPost.videoProcessingStatus);
    if (mediaStatus === "processing") lifecycle.status = "processing";
    else if (mediaStatus === "failed") lifecycle.status = "failed";
  }

  const recoveredLegacyAssets: Array<{ type: MasterPostAssetTypeV2; url: string; source: string }> = [];
  const ignoredLegacyVariantUrls: string[] = [];
  const mergedVariantUrls: string[] = [];
  const suppressedDuplicateAssets: string[] = [];

  const rawAssets = Array.isArray(rawPost.assets) ? rawPost.assets : [];
  const mediaAssets = Array.isArray(mediaObj.assets) ? mediaObj.assets : [];
  const allAssets: Array<any> = rawAssets.length > 0 ? [...rawAssets] : [...mediaAssets];

  const posterFiles = toObject(rawPost.posterFiles) ?? {};
  const labAssets = toObject(playbackLab.assets) ?? {};
  const letterboxGradients = Array.isArray(rawPost.letterboxGradients) ? rawPost.letterboxGradients : [];
  const postLevelGradient =
    normalizeGradientCandidate(rawPost.letterboxGradient) ??
    normalizeGradientCandidate({
      top: rawPost.letterboxGradientTop,
      bottom: rawPost.letterboxGradientBottom
    });

  const allowedVideoVariantKeys = new Set([
    "poster",
    "posterHigh",
    "preview360",
    "preview360Avc",
    "main720",
    "main720Avc",
    "main1080",
    "main1080Avc",
    "startup540Faststart",
    "startup540FaststartAvc",
    "startup720Faststart",
    "startup720FaststartAvc",
    "startup1080Faststart",
    "startup1080FaststartAvc",
    "upgrade1080Faststart",
    "upgrade1080FaststartAvc",
    "hls",
    "hlsAvcMaster"
  ]);

  const stableVariantKeys = [
    "poster",
    "posterHigh",
    "preview360",
    "preview360Avc",
    "main720",
    "main720Avc",
    "main1080",
    "main1080Avc",
    "startup540Faststart",
    "startup540FaststartAvc",
    "startup720Faststart",
    "startup720FaststartAvc",
    "startup1080Faststart",
    "startup1080FaststartAvc",
    "upgrade1080Faststart",
    "upgrade1080FaststartAvc",
    "hls",
    "hlsAvcMaster"
  ] as const;

  const normalizedAssets: any[] = allAssets.map((asset, index) => {
    const row = toObject(asset) ?? {};
    const declaredType = toTrimmed(row.type, row.mediaType);
    const fromLab = toObject(labAssets[row.id]) ?? {};
    const variants = toObject(row.variants) ?? {};
    const generated = toObject(fromLab.generated) ?? {};
    const rowPlaybackLab = toObject(row.playbackLab) ?? {};
    const rowPlaybackLabGenerated = toObject(rowPlaybackLab.generated) ?? {};
    const postPlaybackLabAsset = toObject(toObject(playbackLab.assets)?.[toTrimmed(row.id) ?? ""]) ?? {};
    const postPlaybackLabAssetGenerated = toObject(postPlaybackLabAsset.generated) ?? {};
    const generatedOutputs = parseGeneratedOutputs(generated.outputs ?? generated.diagnosticsJson);
    const rowGeneratedOutputs = parseGeneratedOutputs(rowPlaybackLabGenerated.outputs ?? rowPlaybackLabGenerated.diagnosticsJson);
    const postAssetGeneratedOutputs = parseGeneratedOutputs(
      postPlaybackLabAssetGenerated.outputs ?? postPlaybackLabAssetGenerated.diagnosticsJson
    );
    const pickPlaybackUrl = (...values: unknown[]): string | null => toTrimmed(...values);
    const displayImage =
      toTrimmed(
        toObject(variants.lg)?.webp,
        toObject(variants.md)?.webp,
        toObject(variants.fallbackJpg)?.jpg,
        row.original,
        row.url
      ) ?? null;
    const thumbImage =
      toTrimmed(toObject(variants.thumb)?.webp, toObject(variants.sm)?.webp, toObject(variants.md)?.webp, row.original) ?? null;
    const fallbackVideo = toTrimmed(rawPost.fallbackVideoUrl);
    const explicitMain1080 = toTrimmed(row.main1080, variants.main1080);
    const explicitMain1080Avc = toTrimmed(row.main1080Avc, variants.main1080Avc);
    const playback = {
      startup540Faststart: pickPlaybackUrl(
        row.startup540Faststart,
        variants.startup540Faststart,
        generated.startup540Faststart,
        rowPlaybackLabGenerated.startup540Faststart,
        postPlaybackLabAssetGenerated.startup540Faststart,
        generatedOutputs.startup540Faststart,
        rowGeneratedOutputs.startup540Faststart,
        postAssetGeneratedOutputs.startup540Faststart
      ),
      startup720FaststartAvc: pickPlaybackUrl(
        row.startup720FaststartAvc,
        variants.startup720FaststartAvc,
        generated.startup720FaststartAvc,
        rowPlaybackLabGenerated.startup720FaststartAvc,
        postPlaybackLabAssetGenerated.startup720FaststartAvc,
        generatedOutputs.startup720FaststartAvc,
        rowGeneratedOutputs.startup720FaststartAvc,
        postAssetGeneratedOutputs.startup720FaststartAvc
      ),
      startup720Faststart: pickPlaybackUrl(
        row.startup720Faststart,
        variants.startup720Faststart,
        generated.startup720Faststart,
        rowPlaybackLabGenerated.startup720Faststart,
        postPlaybackLabAssetGenerated.startup720Faststart,
        generatedOutputs.startup720Faststart,
        rowGeneratedOutputs.startup720Faststart,
        postAssetGeneratedOutputs.startup720Faststart
      ),
      startup1080FaststartAvc: pickPlaybackUrl(
        row.startup1080FaststartAvc,
        variants.startup1080FaststartAvc,
        generated.startup1080FaststartAvc,
        rowPlaybackLabGenerated.startup1080FaststartAvc,
        postPlaybackLabAssetGenerated.startup1080FaststartAvc,
        generatedOutputs.startup1080FaststartAvc,
        rowGeneratedOutputs.startup1080FaststartAvc,
        postAssetGeneratedOutputs.startup1080FaststartAvc
      ),
      startup1080Faststart: pickPlaybackUrl(
        row.startup1080Faststart,
        variants.startup1080Faststart,
        generated.startup1080Faststart,
        rowPlaybackLabGenerated.startup1080Faststart,
        postPlaybackLabAssetGenerated.startup1080Faststart,
        generatedOutputs.startup1080Faststart,
        rowGeneratedOutputs.startup1080Faststart,
        postAssetGeneratedOutputs.startup1080Faststart
      ),
      startup540FaststartAvc: pickPlaybackUrl(
        row.startup540FaststartAvc,
        variants.startup540FaststartAvc,
        generated.startup540FaststartAvc,
        rowPlaybackLabGenerated.startup540FaststartAvc,
        postPlaybackLabAssetGenerated.startup540FaststartAvc,
        generatedOutputs.startup540FaststartAvc,
        rowGeneratedOutputs.startup540FaststartAvc,
        postAssetGeneratedOutputs.startup540FaststartAvc
      ),
      main720Avc: pickPlaybackUrl(
        row.main720Avc,
        variants.main720Avc,
        generated.main720Avc,
        rowPlaybackLabGenerated.main720Avc,
        postPlaybackLabAssetGenerated.main720Avc,
        generatedOutputs.main720Avc,
        rowGeneratedOutputs.main720Avc,
        postAssetGeneratedOutputs.main720Avc
      ),
      hlsAvcMaster: pickPlaybackUrl(
        row.hlsAvcMaster,
        variants.hlsAvcMaster,
        generated.hlsAvcMaster,
        rowPlaybackLabGenerated.hlsAvcMaster,
        postPlaybackLabAssetGenerated.hlsAvcMaster
      ),
      hls: pickPlaybackUrl(row.hls, variants.hls, generated.hls, rowPlaybackLabGenerated.hls, postPlaybackLabAssetGenerated.hls),
      main1080Avc: explicitMain1080Avc,
      main720: pickPlaybackUrl(row.main720, variants.main720, generated.main720, rowPlaybackLabGenerated.main720, postPlaybackLabAssetGenerated.main720),
      original: toTrimmed(row.original, row.url, fallbackVideo),
      preview360Avc: pickPlaybackUrl(
        row.preview360Avc,
        variants.preview360Avc,
        generated.preview360Avc,
        rowPlaybackLabGenerated.preview360Avc,
        postPlaybackLabAssetGenerated.preview360Avc,
        generatedOutputs.preview360Avc,
        rowGeneratedOutputs.preview360Avc,
        postAssetGeneratedOutputs.preview360Avc
      ),
      preview360: pickPlaybackUrl(
        row.preview360,
        variants.preview360,
        generated.preview360,
        rowPlaybackLabGenerated.preview360,
        postPlaybackLabAssetGenerated.preview360,
        generatedOutputs.preview360,
        rowGeneratedOutputs.preview360,
        postAssetGeneratedOutputs.preview360
      ),
      upgrade1080FaststartAvc: pickPlaybackUrl(
        row.upgrade1080FaststartAvc,
        variants.upgrade1080FaststartAvc,
        generated.upgrade1080FaststartAvc,
        rowPlaybackLabGenerated.upgrade1080FaststartAvc,
        postPlaybackLabAssetGenerated.upgrade1080FaststartAvc
      ),
      upgrade1080Faststart: pickPlaybackUrl(
        row.upgrade1080Faststart,
        variants.upgrade1080Faststart,
        generated.upgrade1080Faststart,
        rowPlaybackLabGenerated.upgrade1080Faststart,
        postPlaybackLabAssetGenerated.upgrade1080Faststart
      ),
      main1080: explicitMain1080
    };
    const rawCodecs = toObject(row.codecs);
    const preservedVariants: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ ...variants, ...generated })) {
      if (!allowedVideoVariantKeys.has(key)) continue;
      preservedVariants[key] = value;
    }
    for (const key of stableVariantKeys) {
      if (!(key in preservedVariants)) preservedVariants[key] = null;
    }

    // main1080* must never be merged from playbackLab.generated (or stray variant maps) — only explicit asset fields.
    const upgradeVariants = [
      preservedVariants.upgrade1080FaststartAvc,
      preservedVariants.upgrade1080Faststart
    ]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
    const upgradeUrls = new Set(upgradeVariants);
    let canonMain1080 = explicitMain1080 ?? null;
    let canonMain1080Avc = explicitMain1080Avc ?? null;
    if (canonMain1080 && upgradeUrls.has(canonMain1080.trim())) canonMain1080 = null;
    if (canonMain1080Avc && upgradeUrls.has(canonMain1080Avc.trim())) canonMain1080Avc = null;
    preservedVariants.main1080 = canonMain1080 ?? null;
    preservedVariants.main1080Avc = canonMain1080Avc ?? null;

    const fromLabGenerated = toObject(fromLab.generated) ?? {};
    const verifyRows = [
      ...(Array.isArray(rowPlaybackLab.lastVerifyResults) ? rowPlaybackLab.lastVerifyResults : []),
      ...(Array.isArray(postPlaybackLabAsset.lastVerifyResults) ? postPlaybackLabAsset.lastVerifyResults : []),
      ...(Array.isArray(fromLab.lastVerifyResults) ? fromLab.lastVerifyResults : []),
      ...(Array.isArray(fromLabGenerated.lastVerifyResults) ? fromLabGenerated.lastVerifyResults : []),
      ...(Array.isArray(rowPlaybackLabGenerated.lastVerifyResults) ? rowPlaybackLabGenerated.lastVerifyResults : []),
      ...(Array.isArray(postPlaybackLabAssetGenerated.lastVerifyResults) ? postPlaybackLabAssetGenerated.lastVerifyResults : []),
      ...(Array.isArray(playbackLab.lastVerifyResults) ? playbackLab.lastVerifyResults : [])
    ]
      .map((entry) => toObject(entry))
      .filter((entry): entry is Record<string, any> => Boolean(entry));
    const verifiedFaststartUrls = collectVerifiedFaststartUrls(verifyRows, [
      toObject(playbackLab.verification),
      toObject(fromLab.verification)
    ]);
    const selectedPlayback = selectCanonicalVideoPlaybackAsset({
      playback,
      originalUrl: playback.original,
      previewUrl: playback.preview360Avc ?? playback.preview360,
      verifiedFaststartUrls
    });
    if (selectedPlayback.aliasStartup1080FromMain && preservedVariants.startup1080FaststartAvc == null) {
      preservedVariants.startup1080FaststartAvc = playback.main1080Avc ?? null;
    }
    if (selectedPlayback.aliasStartup720FromMain && preservedVariants.startup720FaststartAvc == null) {
      preservedVariants.startup720FaststartAvc = playback.main720Avc ?? null;
    }
    const playbackReady = selectedPlayback.hasVerifiedOptimizedPlayback && Boolean(playback.original || row.poster || rawPost.displayPhotoLink);
    const hasVideoHints = [
      row.hls,
      row.hlsAvcMaster,
      row.main720Avc,
      row.main1080Avc,
      row.preview360Avc,
      row.startup720FaststartAvc,
      generated.hls,
      generated.hlsAvcMaster,
      generated.main720Avc,
      generated.main1080Avc,
      generated.preview360Avc,
      generated.startup720FaststartAvc
    ].some(Boolean);
    const resolvedType: MasterPostAssetTypeV2 =
      declaredType === "video" ||
      (declaredType !== "image" &&
        (hasVideoHints ||
          isVideoUrl(toTrimmed(row.original, row.url)) ||
          isVideoUrl(toTrimmed(playback.original, playback.hls, playback.main720Avc))))
        ? "video"
        : "image";
    if (!playbackReady && resolvedType === "video") {
      pushWarning(
        warnings,
        "video_instant_playback_not_verified_faststart",
        `Video asset ${toTrimmed(row.id) ?? generatedId} has no verified fast-start optimized AVC URL (reason=${selectedPlayback.selectedReason})`,
        "media.assets.video.readiness"
      );
    }
    const generatedId = `${resolvedType}_${postId}_${index}`;
    const gradientByIndex = normalizeGradientCandidate(letterboxGradients[index]);
    const gradientFromSingleArrayEntry =
      letterboxGradients.length === 1 ? normalizeGradientCandidate(letterboxGradients[0]) : null;
    const presRow = toObject(row.presentation) ?? {};
    const gradient =
      normalizeGradientCandidate(presRow.letterboxGradient) ??
      normalizeGradientCandidate(row.letterboxGradient) ??
      gradientByIndex ??
      gradientFromSingleArrayEntry ??
      postLevelGradient;
    const carouselFitWidthAsset =
      typeof presRow.carouselFitWidth === "boolean"
        ? presRow.carouselFitWidth
        : typeof rawPost.carouselFitWidth === "boolean"
          ? rawPost.carouselFitWidth
          : null;
    const resizeFromRow = presRow.resizeMode;
    const resizeModeAsset =
      resizeFromRow === "contain" || resizeFromRow === "cover"
        ? (resizeFromRow as "contain" | "cover")
        : carouselFitWidthAsset === true
          ? "contain"
          : carouselFitWidthAsset === false
            ? "cover"
            : null;
    return {
      id: toTrimmed(row.id) ?? generatedId,
      index,
      type: resolvedType,
      source: {
        kind: rawAssets.length > 0 ? "assets" : "media.assets",
        originalAssetId: toTrimmed(row.id, row.assetId),
        primarySources: Array.from(
          new Set([
            rawAssets.length > 0 ? "assets" : "media.assets",
            fromLab && Object.keys(fromLab).length > 0 ? "playbackLab" : null
          ].filter(Boolean))
        ),
        legacySourcesConsidered: [],
        legacyVariantUrlsMerged: false
      },
      image:
        resolvedType === "image"
          ? {
              originalUrl: toTrimmed(row.original, row.url),
              displayUrl: displayImage,
              thumbnailUrl: thumbImage,
              blurhash: toTrimmed(row.blurhash),
              width: toNum(row.width),
              height: toNum(row.height),
              aspectRatio: toNum(row.aspectRatio),
              orientation: toTrimmed(row.orientation)
            }
          : null,
      video:
        resolvedType === "video"
          ? {
              originalUrl: playback.original,
              posterUrl:
                toTrimmed(
                  generated.posterHigh,
                  row.posterHigh,
                  row.poster,
                  row.posterUrl,
                  row.thumbnail,
                  posterFiles.newPosterUrl,
                  rawPost.displayPhotoLink
                ) ?? null,
              posterHighUrl: toTrimmed(generated.posterHigh, row.posterHigh),
              playback: {
                defaultUrl: selectedPlayback.selectedGoodNetworkUrl,
                primaryUrl: selectedPlayback.selectedGoodNetworkUrl,
                startupUrl: selectedPlayback.selectedGoodNetworkUrl,
                highQualityUrl: selectedPlayback.selectedGoodNetworkUrl,
                upgradeUrl: selectedPlayback.selectedGoodNetworkUrl,
                hlsUrl: playback.hlsAvcMaster ?? playback.hls ?? null,
                fallbackUrl: selectedPlayback.fallbackUrl,
                previewUrl: selectedPlayback.selectedPreviewUrl,
                ...( {
                  goodNetworkUrl: selectedPlayback.selectedGoodNetworkUrl,
                  weakNetworkUrl: selectedPlayback.selectedWeakNetworkUrl,
                  poorNetworkUrl: selectedPlayback.selectedPoorNetworkUrl,
                  selectedReason: selectedPlayback.selectedReason
                } as Record<string, string | null> )
              },
              variants: preservedVariants,
              durationSec: pickNumericOrNull(row.durationSec),
              hasAudio: typeof row.hasAudio === "boolean" ? row.hasAudio : null,
              codecs: rawCodecs ?? (toTrimmed(row.codecs) ? { value: toTrimmed(row.codecs) } : null),
              technical: {
                sourceCodec: toTrimmed(rawCodecs?.video, rawCodecs?.codec, rawCodecs?.sourceCodec),
                playbackCodec: toTrimmed(rawCodecs?.video, rawCodecs?.playbackCodec),
                audioCodec: toTrimmed(rawCodecs?.audio, rawCodecs?.audioCodec, row.hasAudio === false ? "none" : null)
              },
              bitrateKbps: pickNumericOrNull(row.bitrateKbps),
              sizeBytes: pickNumericOrNull(row.sizeBytes),
              readiness: {
                assetsReady: playbackReady,
                instantPlaybackReady: playbackReady,
                faststartVerified: selectedPlayback.hasVerifiedPlayback,
                processingStatus: playbackReady
                  ? toTrimmed(rawPost.videoProcessingStatus, playbackLab.status, rawPost.mediaStatus) ?? "completed"
                  : toTrimmed(rawPost.videoProcessingStatus, playbackLab.status, rawPost.mediaStatus)
              }
            }
          : null,
      presentation: {
        letterboxGradient: gradient ?? null,
        ...(carouselFitWidthAsset !== null ? { carouselFitWidth: carouselFitWidthAsset } : {}),
        ...(resizeModeAsset ? { resizeMode: resizeModeAsset } : {})
      }
    };
  });

  const legacyCandidates = [
    { url: toTrimmed(rawPost.photoLink), source: "photoLink" },
    { url: toTrimmed(rawPost.photoLinks2), source: "photoLinks2" },
    { url: toTrimmed(rawPost.photoLinks3), source: "photoLinks3" },
    { url: toTrimmed(rawPost.playbackUrl), source: "playbackUrl" },
    { url: toTrimmed(rawPost.fallbackVideoUrl), source: "fallbackVideoUrl" },
    { url: toTrimmed(rawPost.posterUrl), source: "posterUrl" },
    { url: toTrimmed(rawPost.posterHigh), source: "posterHigh" },
    { url: toTrimmed(rawPost.thumbUrl), source: "thumbUrl" },
    { url: toTrimmed(rawPost.displayPhotoLink), source: "displayPhotoLink" },
    { url: toTrimmed(legacy.photoLink), source: "legacy.photoLink" },
    { url: toTrimmed(legacy.photoLinks2), source: "legacy.photoLinks2" },
    { url: toTrimmed(legacy.photoLinks3), source: "legacy.photoLinks3" }
  ].filter((entry): entry is { url: string; source: string } => Boolean(entry.url));

  const existingVideo = normalizedAssets.find((asset) => asset.type === "video");
  const defaultLegacySourcesConsidered = [
    "photoLinks2",
    "photoLinks3",
    "legacy.photoLinks2",
    "legacy.photoLinks3"
  ];
  if (existingVideo) {
    existingVideo.source.legacySourcesConsidered = Array.from(
      new Set([...(existingVideo.source.legacySourcesConsidered ?? []), ...defaultLegacySourcesConsidered])
    );
  }
  const existingAssetUrls = new Set(
    normalizedAssets.flatMap((asset) => [
      asset.image?.displayUrl,
      asset.image?.thumbnailUrl,
      asset.image?.originalUrl,
      asset.video?.playback?.primaryUrl,
      asset.video?.playback?.startupUrl,
      asset.video?.playback?.upgradeUrl,
      asset.video?.playback?.hlsUrl,
      asset.video?.playback?.fallbackUrl,
      asset.video?.playback?.previewUrl,
      asset.video?.posterUrl,
      asset.video?.posterHighUrl,
      asset.video?.originalUrl
    ].filter(Boolean))
  );

  for (const candidate of legacyCandidates) {
    if (existingAssetUrls.has(candidate.url)) {
      suppressedDuplicateAssets.push(candidate.url);
      continue;
    }
    const kind = classifyMediaUrl(candidate.url);
    if (existingVideo) {
      if (kind === "video") {
        existingVideo.video.playback.fallbackUrl = existingVideo.video.playback.fallbackUrl ?? candidate.url;
        if (!existingVideo.video.playback.primaryUrl) existingVideo.video.playback.primaryUrl = candidate.url;
        if (!existingVideo.video.playback.previewUrl && /preview360/i.test(candidate.url)) {
          existingVideo.video.playback.previewUrl = candidate.url;
        }
        // Keep aliases/debug in audit+legacy, not app-facing variant map.
        mergedVariantUrls.push(candidate.url);
        existingVideo.source.legacyVariantUrlsMerged = true;
        if (!existingVideo.source.legacySourcesConsidered.includes(candidate.source)) {
          existingVideo.source.legacySourcesConsidered.push(candidate.source);
        }
      } else {
        ignoredLegacyVariantUrls.push(candidate.url);
      }
      continue;
    }
    if (kind === "video") {
      recoveredLegacyAssets.push({ type: "video", url: candidate.url, source: candidate.source });
      continue;
    }
    if (kind === "image") {
      recoveredLegacyAssets.push({ type: "image", url: candidate.url, source: candidate.source });
      continue;
    }
  }

  if (normalizedAssets.length === 0) {
    for (const entry of recoveredLegacyAssets) {
      const idx = normalizedAssets.length;
      if (entry.type === "image") {
        normalizedAssets.push({
          id: `legacy_${postId}_${idx}`,
          index: idx,
          type: "image",
          source: {
            kind: "legacy",
            originalAssetId: null,
            primarySources: [],
            legacySourcesConsidered: [entry.source],
            recoveredFrom: [entry.source],
            legacyVariantUrlsMerged: false
          },
          image: {
            originalUrl: entry.url,
            displayUrl: entry.url,
            thumbnailUrl: entry.url,
            blurhash: null,
            width: null,
            height: null,
            aspectRatio: null,
            orientation: null
          },
          video: null,
          presentation: { letterboxGradient: null }
        });
      } else {
        normalizedAssets.push({
          id: `legacy_${postId}_${idx}`,
          index: idx,
          type: "video",
          source: {
            kind: "legacy",
            originalAssetId: null,
            primarySources: [],
            legacySourcesConsidered: [entry.source],
            recoveredFrom: [entry.source],
            legacyVariantUrlsMerged: false
          },
          image: null,
          video: {
            originalUrl: entry.url,
            posterUrl: toTrimmed(rawPost.displayPhotoLink),
            posterHighUrl: toTrimmed(rawPost.posterHigh),
            playback: {
              defaultUrl: entry.url,
              primaryUrl: entry.url,
              startupUrl: entry.url,
              highQualityUrl: entry.url,
              upgradeUrl: entry.url,
              hlsUrl: isVideoUrl(entry.url) && entry.url.endsWith(".m3u8") ? entry.url : null,
              fallbackUrl: entry.url,
              previewUrl: null
            },
            variants: {
              poster: null,
              posterHigh: null,
              preview360: null,
              preview360Avc: null,
              main720: null,
              main720Avc: null,
              main1080: null,
              main1080Avc: null,
              startup540Faststart: null,
              startup540FaststartAvc: null,
              startup720Faststart: null,
              startup720FaststartAvc: null,
              startup1080Faststart: null,
              startup1080FaststartAvc: null,
              upgrade1080Faststart: null,
              upgrade1080FaststartAvc: null,
              hls: null,
              hlsAvcMaster: null
            },
            durationSec: null,
            hasAudio: null,
            codecs: null,
            technical: {
              sourceCodec: null,
              playbackCodec: null,
              audioCodec: null
            },
            bitrateKbps: null,
            sizeBytes: null,
            readiness: {
              assetsReady: null,
              instantPlaybackReady: null,
              faststartVerified: null,
              processingStatus: toTrimmed(rawPost.videoProcessingStatus, rawPost.mediaStatus)
            }
          },
          presentation: { letterboxGradient: null }
        });
      }
    }
  } else if (recoveredLegacyAssets.length > 0) {
    ignoredLegacyVariantUrls.push(...recoveredLegacyAssets.map((a) => a.url));
  }

  const dedupe = uniqBy(normalizedAssets, (a) => `${a.type}:${a.image?.displayUrl ?? a.video?.playback.primaryUrl ?? a.id}`);
  dedupe.deduped.forEach((asset, index) => {
    asset.index = index;
  });
  inferImageHeightsOnAssets(dedupe.deduped);

  const coverAsset = dedupe.deduped.find((a) => a.type === "image" || a.type === "video") ?? null;
  const coverRawAsset = coverAsset ? toObject(allAssets[coverAsset.index]) ?? null : null;
  const coverRawVariantMetadata = toObject(coverRawAsset?.variantMetadata) ?? {};
  const coverRawPosterMetadata = toObject(coverRawVariantMetadata.poster) ?? {};
  const coverUrl = (coverAsset?.type === "image" ? coverAsset.image?.displayUrl : coverAsset?.video?.posterUrl) ?? null;
  const coverThumb = (coverAsset?.type === "image" ? coverAsset.image?.thumbnailUrl : coverAsset?.video?.posterUrl) ?? null;
  const coverPoster = (coverAsset?.type === "video" ? coverAsset.video?.posterUrl : null) ?? null;
  const coverWidth =
    (toNum(
      coverRawPosterMetadata.width,
      toObject(toObject(rawPost.variantMetadata)?.poster)?.width,
      toObject(toObject(rawPost.variantMetadata)?.posterHigh)?.width
    ) ??
      (coverAsset?.type === "image" ? coverAsset.image?.width : null) ??
      null);
  const coverHeight =
    (toNum(
      coverRawPosterMetadata.height,
      toObject(toObject(rawPost.variantMetadata)?.poster)?.height,
      toObject(toObject(rawPost.variantMetadata)?.posterHigh)?.height
    ) ??
      (coverAsset?.type === "image" ? coverAsset.image?.height : null) ??
      null);
  let coverAspectRatio =
    toNum(coverRawPosterMetadata.aspectRatio, toObject(toObject(rawPost.variantMetadata)?.poster)?.aspectRatio) ??
    (coverWidth && coverHeight ? Number((coverWidth / coverHeight).toFixed(4)) : null) ??
    (coverAsset?.type === "image" ? coverAsset.image?.aspectRatio : null) ??
    (coverAsset?.type === "video" ? toNum(coverAsset.video?.variants?.posterAspectRatio) : null) ??
    null;
  let coverHeightOut = coverHeight;
  const inferredCoverH = inferMissingImageHeightFromAspect(coverWidth, coverHeightOut, coverAspectRatio);
  if (inferredCoverH !== null && (coverHeightOut == null || !Number.isFinite(coverHeightOut))) {
    coverHeightOut = inferredCoverH;
    if (
      (coverAspectRatio == null || !Number.isFinite(coverAspectRatio)) &&
      coverWidth != null &&
      typeof coverWidth === "number" &&
      coverWidth > 0 &&
      coverHeightOut > 0
    ) {
      coverAspectRatio = Number((coverWidth / coverHeightOut).toFixed(6));
    }
  }

  const mediaKind = classifyMediaKind(dedupe.deduped, toTrimmed(rawPost.mediaType));
  const mediaStatus: MasterPostMediaStatusV2 =
    toTrimmed(rawPost.mediaStatus, rawPost.videoProcessingStatus) === "processing"
      ? "processing"
      : dedupe.deduped.length === 0
        ? "none"
        : dedupe.deduped.some((a) => a.type === "video" && !a.video?.playback.primaryUrl)
          ? "partial"
          : "ready";

  const rollupObj = toObject(rawPost.rankingRollup);

  const engagementAudit = options.engagementSourceAudit ?? null;
  const engagementRec = engagementAudit?.recommendedCanonical ?? null;

  const likes = Array.isArray(rawPost.likes) ? rawPost.likes : [];
  const comments = Array.isArray(rawPost.comments) ? rawPost.comments : [];

  const legacyRecentLikers = likes
    .slice(-5)
    .reverse()
    .map((entry: unknown) => {
      const row = toObject(entry) ?? {};
      const likedAtCandidate = row.createdAt ?? row.likedAt ?? row.timestamp ?? row.time ?? row.updatedAt;
      const profilePicCandidate = row.userPic ?? row.profilePicUrl ?? row.photoUrl ?? row.avatarUrl;
      return {
        userId: (toTrimmed(row.userId, entry as string | undefined) ?? "unknown").trim(),
        displayName: toTrimmed(row.userName, row.name, row.displayName),
        handle: toTrimmed(row.userHandle, row.handle),
        profilePicUrl: toTrimmed(profilePicCandidate),
        likedAt: toIso(likedAtCandidate)
      };
    });

  let recentLikers = legacyRecentLikers;
  const subRecentLikers = engagementAudit?.subcollections.recentLikers ?? [];
  if (engagementAudit?.selectedSource.likes === "subcollection") {
    if (subRecentLikers.length > 0) {
      recentLikers = [...subRecentLikers];
    } else if (legacyRecentLikers.length > 0) {
      recentLikers = legacyRecentLikers;
      pushWarning(
        warnings,
        "engagement_preview_fallback_legacy_likes_array",
        "Prefer Firestore likes subcollection for counts but recent-doc query was empty — preserved embedded likers (displayName/handle/profilePicUrl/likedAt) from legacy post.likes[]",
        "engagementPreview.recentLikers"
      );
    }
  }

  const fallbackLikeCount = pickNumericOrNull(rawPost.likeCount, rawPost.likesCount, likes.length, rollupObj?.likes) ?? 0;
  const fallbackCommentCount =
    pickNumericOrNull(rawPost.commentsCount, rawPost.commentCount, comments.length, rollupObj?.comments) ?? 0;
  const canonicalLikeCount = typeof engagementRec?.likeCount === "number" ? engagementRec.likeCount : fallbackLikeCount;
  const canonicalCommentCount =
    typeof engagementRec?.commentCount === "number" ? engagementRec.commentCount : fallbackCommentCount;
  const likesVersionCanon =
    pickNumericOrNull(rawPost.likesVersion) ?? engagementRec?.likesVersion ?? canonicalLikeCount ?? 0;
  const commentsVersionCanon =
    pickNumericOrNull(rawPost.commentsVersion) ?? engagementRec?.commentsVersion ?? canonicalCommentCount ?? 0;

  const selectedCommentsSrc = engagementAudit?.selectedSource.comments;
  let recentComments: MasterPostRecentCommentPreviewV2[] = [];
  const subAuditComments = engagementAudit?.subcollections.recentComments ?? [];
  if (selectedCommentsSrc === "subcollection" && (engagementRec?.commentCount ?? 0) > 0 && subAuditComments.length > 0) {
    recentComments = previewCommentsFromAuditSubcollection(subAuditComments as Array<Record<string, unknown>>);
  } else if (selectedCommentsSrc === "postDocArray" && comments.length > 0) {
    recentComments = previewCommentsFromEmbedded(comments);
  } else if (!engagementAudit && comments.length > 0) {
    recentComments = previewCommentsFromEmbedded(comments);
  }

  for (const c of comments) {
    const row = toObject(c) ?? {};
    const replies = Array.isArray(row.replies) ? row.replies : [];
    const replyCountExplicit =
      typeof row.replyCount === "number" && Number.isFinite(row.replyCount) ? Math.floor(row.replyCount) : null;
    if (replies.length > 0 && replyCountExplicit !== null && replyCountExplicit !== replies.length) {
      pushWarning(
        warnings,
        "legacy_comment_reply_count_vs_replies_length_mismatch",
        "Embedded post.comments[] entry has replyCount that does not match replies.length",
        "legacy.comments"
      );
      break;
    }
  }

  const firstVideo = dedupe.deduped.find((a) => a.type === "video");
  const firstVideoPlaybackReady = firstVideo?.video?.readiness?.instantPlaybackReady === true;
  const firstVideoAssetsReady = firstVideo?.video?.readiness?.assetsReady === true;

  const mediaPresentationCarousel =
    typeof rawPost.carouselFitWidth === "boolean" ? rawPost.carouselFitWidth : null;
  const mediaPresentationResizeMode: string | null =
    mediaPresentationCarousel === true ? "contain" : mediaPresentationCarousel === false ? "cover" : null;

  const canonical: MasterPostV2 = {
    id: postId,
    schema: {
      name: "locava.post",
      version: 2,
      canonicalizedAt: now.toISOString(),
      canonicalizedBy: "backend_v2_post_rebuilder",
      sourceShape:
        dedupe.deduped.length === 0
          ? "legacy_links_only"
          : dedupe.deduped.some((a) => a.type === "video") && dedupe.deduped.some((a) => a.type === "image")
            ? "legacy_assets_mixed"
            : dedupe.deduped.some((a) => a.type === "video")
              ? "legacy_assets_video"
              : dedupe.deduped.some((a) => a.type === "image")
                ? "legacy_assets_image"
                : "unknown",
      migrationRunId: null
    },
    lifecycle,
    author,
    text,
    location,
    classification: {
      activities: Array.isArray(rawPost.activities) ? rawPost.activities.map((v: unknown) => String(v)) : [],
      primaryActivity: Array.isArray(rawPost.activities) ? (rawPost.activities[0] ?? null) : null,
      mediaKind,
      visibility: normalizeVisibility(toTrimmed(rawPost.privacy, rawPost.visibility)),
      isBoosted: toBool(rawPost.isBoosted, false),
      reel: toBool(rawPost.reel, false),
      settingType: toTrimmed(rawPost.settingType),
      moderatorTier: pickNumericOrNull(rawPost.moderatorTier),
      source: resolvePostSource(rawPost),
      privacyLabel: toTrimmed(rawPost.privacy, rawPost.visibility)
    },
    media: {
      status: firstVideo && firstVideoPlaybackReady ? "ready" : mediaStatus,
      assetsReady: firstVideo ? firstVideoAssetsReady : typeof rawPost.assetsReady === "boolean" ? rawPost.assetsReady : false,
      instantPlaybackReady: firstVideo
        ? firstVideoPlaybackReady
        : typeof rawPost.instantPlaybackReady === "boolean"
          ? rawPost.instantPlaybackReady
          : false,
      completeness:
        dedupe.deduped.length === 0
          ? "missing"
          : allAssets.length === 0 && (mergedVariantUrls.length > 0 || ignoredLegacyVariantUrls.length > 0)
            ? "legacy_recovered"
            : "complete",
      assetCount: dedupe.deduped.length,
      rawAssetCount: allAssets.length,
      hasMultipleAssets: dedupe.deduped.length > 1,
      primaryAssetId: dedupe.deduped[0]?.id ?? null,
      coverAssetId: coverAsset?.id ?? null,
      presentation:
        mediaPresentationCarousel !== null
          ? {
              carouselFitWidth: mediaPresentationCarousel,
              resizeMode: mediaPresentationResizeMode
            }
          : null,
      assets: dedupe.deduped,
      cover: {
        assetId: coverAsset?.id ?? null,
        type: coverAsset?.type ?? null,
        url: coverUrl,
        thumbUrl: coverThumb,
        posterUrl: coverPoster,
        width: coverWidth,
        height: coverHeightOut,
        aspectRatio: coverAspectRatio,
        gradient: coverAsset?.presentation?.letterboxGradient ?? null
      }
    },
    engagement: {
      likeCount: canonicalLikeCount,
      commentCount: canonicalCommentCount,
      saveCount: pickNumericOrNull(rawPost.saveCount, toObject(rawPost.rankingRollup)?.saves) ?? 0,
      shareCount: pickNumericOrNull(rawPost.shareCount, toObject(rawPost.rankingRollup)?.shares) ?? 0,
      viewCount: pickNumericOrNull(rawPost.viewCount) ?? 0,
      likesVersion: likesVersionCanon,
      commentsVersion: commentsVersionCanon,
      savesVersion: pickNumericOrNull(rawPost.savesVersion, toObject(rawPost.rankingRollup)?.savesVersion) ?? 0,
      showLikes: typeof rawPost.showLikes === "boolean" ? rawPost.showLikes : null,
      showComments: typeof rawPost.showComments === "boolean" ? rawPost.showComments : null
    },
    engagementPreview: {
      recentLikers,
      recentComments
    },
    ranking: {
      aggregates: toObject(rawPost.rankingAggregates),
      rollup: toObject(rawPost.rankingRollup)
    },
    compatibility: {
      photoLink: coverUrl ?? null,
      photoLinks2: firstVideo?.video?.playback.primaryUrl ?? toTrimmed(rawPost.photoLinks2) ?? null,
      photoLinks3: firstVideo?.video?.playback.upgradeUrl ?? toTrimmed(rawPost.photoLinks3) ?? null,
      displayPhotoLink: coverUrl ?? null,
      thumbUrl: coverThumb ?? null,
      posterUrl: coverPoster ?? null,
      fallbackVideoUrl: firstVideo?.video?.playback.fallbackUrl ?? toTrimmed(rawPost.fallbackVideoUrl) ?? null,
      mediaType: mediaKind
    },
    legacy: {
      preserved: true,
      rawFieldNames: Object.keys(rawPost).sort(),
      originalMediaFields: {
        photoLink: rawPost.photoLink ?? null,
        photoLinks2: rawPost.photoLinks2 ?? null,
        photoLinks3: rawPost.photoLinks3 ?? null,
        displayPhotoLink: rawPost.displayPhotoLink ?? null,
        fallbackVideoUrl: rawPost.fallbackVideoUrl ?? null,
        mediaType: rawPost.mediaType ?? null
      },
      originalEngagementFields: {
        likesCount: rawPost.likesCount ?? null,
        likeCount: rawPost.likeCount ?? null,
        likesVersion: rawPost.likesVersion ?? null,
        likesArrayLen: likes.length ?? null,
        commentsCount: rawPost.commentsCount ?? null,
        commentCount: rawPost.commentCount ?? null,
        commentsVersion: rawPost.commentsVersion ?? null,
        commentsArrayLen: comments.length ?? null,
        commentsPreserved: comments.length > 0,
        commentsEmbeddedNote:
          comments.length > 0
            ? "Full post.comments[] preserved only in backup/legacy — canonical carries counts + engagementPreview.recentComments; migrate to posts/{postId}/comments/{commentId} when ready."
            : null,
        rankingRollup: rawPost.rankingRollup ?? null,
        rankingAggregates: rawPost.rankingAggregates ?? null,
        likesSubcollectionNotes: "truth often in posts/{postId}/likes; see audit.engagementSourceAuditSummary when preview/write runs"
      },
      originalLocationFields: {
        lat: rawPost.lat ?? null,
        lng: rawPost.lng ?? rawPost.long ?? null,
        address: rawPost.address ?? null,
        addressDisplayName: rawPost.addressDisplayName ?? null,
        locationDisplayName: rawPost.locationDisplayName ?? null,
        geoData: rawPost.geoData ?? null
      },
      originalModerationFields: {
        privacy: rawPost.privacy ?? null,
        moderatorTier: rawPost.moderatorTier ?? null,
        deleted: rawPost.deleted ?? null,
        isDeleted: rawPost.isDeleted ?? null
      },
      originalPosterMigration: {
        posterFiles: rawPost.posterFiles ?? null,
        playbackLabStatus: toTrimmed(playbackLab.status),
        preserveRawLegacy: options.preserveRawLegacy ?? false
      }
    },
    audit: {
      canonicalValidationStatus: "valid",
      warnings,
      errors,
      rebuiltFromRawAt: options.postingFinalizeV2 ? null : now.toISOString(),
      createdFromPostingFinalizeAt: options.postingFinalizeV2 ? now.toISOString() : null,
      reversible: options.postingFinalizeV2 ? false : true,
      backupDocPath: null,
      engagementSourceAuditSummary: engagementAudit ?? null,
      normalizationDebug: {
        ignoredLegacyVariantUrls: [...new Set(ignoredLegacyVariantUrls)],
        mergedVariantUrls: [...new Set(mergedVariantUrls)],
        suppressedDuplicateAssets: [...new Set(suppressedDuplicateAssets)],
        assetCountBefore: allAssets.length,
        assetCountAfter: dedupe.deduped.length,
        rawLetterboxGradientsCount: letterboxGradients.length,
        rawHasPostLevelLetterboxGradient: Boolean(postLevelGradient),
        lifecycleCreatedAtMsSource: lifecycleCreatedAtMsDerivation.source,
        lifecycleCreatedAtMsMissingDespiteRawFields:
          lifecycleCreatedAtMsDerivation.ms === null && rawPostHasLifecycleTimestampCandidates(rawPost)
      }
    }
  };

  if (!canonical.author.userId) pushWarning(warnings, "missing_author_user_id", "Author userId is missing", "author.userId");
  if (!canonical.lifecycle.createdAt && !canonical.lifecycle.createdAtMs) {
    pushError(errors, "missing_created_at", "Post does not include a created timestamp", true, "lifecycle.createdAt");
  }
  if (canonical.media.assetCount === 0) pushWarning(warnings, "missing_media_assets", "No media assets were recovered", "media.assets");
  if (canonical.media.cover.url === null && canonical.classification.mediaKind !== "text") {
    pushWarning(warnings, "missing_cover_url", "Visual post has no cover URL", "media.cover.url");
  }
  if (options.strict && canonical.media.assetCount === 0) {
    pushError(errors, "strict_missing_assets", "Strict mode requires at least one media asset", true, "media.assets");
  }
  if (dedupe.dedupedCount > 0) pushWarning(warnings, "deduped_assets", `Deduped ${dedupe.dedupedCount} assets`, "media.assets");

  const rawHadLetterbox = letterboxGradients.length > 0 || Boolean(postLevelGradient);
  const nd = canonical.audit.normalizationDebug;
  if (nd) {
    nd.rawHasLetterboxButCoverGradientMissing = rawHadLetterbox && canonical.media.cover.gradient == null;
    nd.rawHasLetterboxButAllAssetGradientsMissing =
      rawHadLetterbox && canonical.media.assets.every((asset) => asset.presentation?.letterboxGradient == null);
  }

  canonical.audit.canonicalValidationStatus = errors.some((e) => e.blocking)
    ? "invalid"
    : warnings.length > 0
      ? "warning"
      : "valid";

  if (options.postingFinalizeV2) {
    canonical.schema.canonicalizedBy = "posting_finalize_v2";
    canonical.schema.sourceShape = "native_posting_v2";
  }

  return {
    canonical,
    warnings,
    errors,
    recoveredLegacyAssets: recoveredLegacyAssets.length,
    dedupedAssets: dedupe.dedupedCount
  };
}
