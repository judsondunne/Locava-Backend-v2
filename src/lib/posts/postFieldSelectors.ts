/**
 * Canonical-aware post field readers for algorithms (feed, search, mixes, map, rankers).
 * Firestore queries may still filter on legacy top-level fields; after fetch, prefer these selectors.
 */
import type { MasterPostMediaKindV2 } from "../../contracts/master-post-v2.types.js";

export type PostRecord = Record<string, unknown>;

export type PostAuthorSummary = {
  userId: string | null;
  displayName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
};

export type PostCoordinates = { lat: number | null; lng: number | null };

export type PostGeoRegions = {
  cityRegionId: string | null;
  stateRegionId: string | null;
  countryRegionId: string | null;
};

export type PostEngagementCounts = {
  likeCount: number;
  commentCount: number;
  saveCount?: number;
  shareCount?: number;
  viewCount?: number;
};

export type PostPlaybackSummary = {
  defaultUrl: string | null;
  primaryUrl: string | null;
  hlsUrl: string | null;
  fallbackUrl: string | null;
  posterUrl: string | null;
};

function asRecord(v: unknown): PostRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as PostRecord) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s.length ? s : null;
}

/** True when Firestore doc is Master Post V2 (canonical fields at root). */
export function isMasterPostV2(record: PostRecord | null | undefined): boolean {
  if (!record) return false;
  const schema = asRecord(record.schema);
  return str(schema?.name) === "locava.post" && num(schema?.version) === 2;
}

export function getPostSchemaVersion(record: PostRecord | null | undefined): number {
  if (!record) return 1;
  const schema = asRecord(record.schema);
  const v = num(schema?.version);
  if (v != null && v > 0) return Math.floor(v);
  return 1;
}

export function getPostId(record: PostRecord | null | undefined): string {
  if (!record) return "";
  return str(record.postId || record.id || record.postID);
}

function embeddedAppV2(record: PostRecord): PostRecord | null {
  return asRecord(record.appPostV2) ?? asRecord(record.appPost);
}

function classificationFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.classification);
  const emb = embeddedAppV2(record);
  const fromEmb = emb ? asRecord(emb.classification) : null;
  if (fromEmb && Object.keys(fromEmb).length) return fromEmb;
  return asRecord(record.classification);
}

function lifecycleFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.lifecycle);
  const emb = embeddedAppV2(record);
  const fromEmb = emb ? asRecord(emb.lifecycle) : null;
  if (fromEmb && Object.keys(fromEmb).length) return fromEmb;
  return asRecord(record.lifecycle);
}

function locationFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.location);
  const emb = embeddedAppV2(record);
  const fromEmb = emb ? asRecord(emb.location) : null;
  if (fromEmb && Object.keys(fromEmb).length) return fromEmb;
  return asRecord(record.location);
}

function textFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.text);
  const emb = embeddedAppV2(record);
  const fromEmb = emb ? asRecord(emb.text) : null;
  if (fromEmb && Object.keys(fromEmb).length) return fromEmb;
  return asRecord(record.text);
}

function mediaFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.media);
  const emb = embeddedAppV2(record);
  const fromEmb = emb ? asRecord(emb.media) : null;
  if (fromEmb && Object.keys(fromEmb).length) return fromEmb;
  return asRecord(record.media);
}

function engagementFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.engagement);
  const emb = embeddedAppV2(record);
  const fromEmb = emb ? asRecord(emb.engagement) : null;
  if (fromEmb && Object.keys(fromEmb).length) return fromEmb;
  return asRecord(record.engagement);
}

function rankingFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.ranking);
  const emb = embeddedAppV2(record);
  const fromEmb = emb ? asRecord(emb.ranking) : null;
  if (fromEmb && Object.keys(fromEmb).length) return fromEmb;
  return asRecord(record.ranking);
}

function compatibilityFrom(record: PostRecord): PostRecord | null {
  if (isMasterPostV2(record)) return asRecord(record.compatibility);
  return null;
}

function normalizeActivityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((e) => (typeof e === "string" ? e.trim().toLowerCase() : "")).filter(Boolean);
}

/** Prefer canonical classification.activities, then embedded app post, then legacy `activities`. */
export function getPostActivities(record: PostRecord | null | undefined): string[] {
  if (!record) return [];
  const cls = classificationFrom(record);
  const fromClass = normalizeActivityList(cls?.activities);
  if (fromClass.length) return fromClass;
  return normalizeActivityList(record.activities);
}

export function getPostPrimaryActivity(record: PostRecord | null | undefined): string | null {
  if (!record) return null;
  const cls = classificationFrom(record);
  const fromClass = strOrNull(cls?.primaryActivity);
  if (fromClass) return fromClass.toLowerCase();
  const legacy = strOrNull(record.primaryActivity);
  if (legacy) return legacy.toLowerCase();
  const acts = getPostActivities(record);
  return acts[0] ?? null;
}

export function getPostSettingType(record: PostRecord | null | undefined): string | null {
  const cls = record ? classificationFrom(record) : null;
  return strOrNull(cls?.settingType) ?? strOrNull(record?.settingType);
}

export function getPostVisibility(record: PostRecord | null | undefined): string {
  const cls = record ? classificationFrom(record) : null;
  const v = str(cls?.visibility).toLowerCase();
  if (v === "public" || v === "friends" || v === "private" || v === "unknown") return v;
  const privacy = str(record?.privacy).toLowerCase();
  if (privacy === "private" || privacy === "public" || privacy === "friends") return privacy === "public" ? "public" : privacy === "friends" ? "friends" : "private";
  return "public";
}

export function getPostPrivacyLabel(record: PostRecord | null | undefined): string | null {
  const cls = record ? classificationFrom(record) : null;
  return strOrNull(cls?.privacyLabel) ?? strOrNull(record?.privacy);
}

export function getPostIsDeleted(record: PostRecord | null | undefined): boolean {
  if (!record) return false;
  const life = lifecycleFrom(record);
  if (life?.isDeleted === true) return true;
  if (str(life?.status).toLowerCase() === "deleted") return true;
  return record.deleted === true || record.isDeleted === true;
}

export function getPostLifecycleStatus(record: PostRecord | null | undefined): string {
  const life = record ? lifecycleFrom(record) : null;
  const s = str(life?.status).toLowerCase();
  if (s) return s;
  if (getPostIsDeleted(record)) return "deleted";
  return "active";
}

export function getPostModerationTier(record: PostRecord | null | undefined): number | null {
  const cls = record ? classificationFrom(record) : null;
  const t = num(cls?.moderatorTier);
  if (t != null) return t;
  return num(record?.moderatorTier ?? record?.moderator_tier);
}

export function getPostAuthorId(record: PostRecord | null | undefined): string {
  if (!record) return "";
  const author = asRecord(record.author);
  const fromAuthor = strOrNull(author?.userId);
  if (fromAuthor) return fromAuthor;
  const emb = embeddedAppV2(record);
  const embAuthor = emb ? asRecord(emb.author) : null;
  const fromEmb = strOrNull(embAuthor?.userId);
  if (fromEmb) return fromEmb;
  return str(record.userId ?? record.ownerId);
}

export function getPostAuthorSummary(record: PostRecord | null | undefined): PostAuthorSummary {
  const author = record ? asRecord(record.author) : null;
  const emb = record ? embeddedAppV2(record) : null;
  const embAuthor = emb ? asRecord(emb.author) : null;
  return {
    userId: getPostAuthorId(record),
    displayName: strOrNull(author?.displayName) ?? strOrNull(embAuthor?.displayName) ?? strOrNull(record?.userName),
    handle: strOrNull(author?.handle) ?? strOrNull(embAuthor?.handle) ?? strOrNull(record?.userHandle)?.replace(/^@+/, "") ?? null,
    profilePicUrl: strOrNull(author?.profilePicUrl) ?? strOrNull(embAuthor?.profilePicUrl) ?? strOrNull(record?.userPic),
  };
}

export function getPostTitle(record: PostRecord | null | undefined): string {
  const t = record ? textFrom(record) : null;
  return str(t?.title) || str(record?.title);
}

export function getPostCaption(record: PostRecord | null | undefined): string {
  const t = record ? textFrom(record) : null;
  const c = str(t?.caption);
  if (c) return c;
  return str(record?.caption);
}

export function getPostDescription(record: PostRecord | null | undefined): string {
  const t = record ? textFrom(record) : null;
  const d = str(t?.description);
  if (d) return d;
  return str(record?.description);
}

export function getPostContent(record: PostRecord | null | undefined): string {
  const t = record ? textFrom(record) : null;
  const body = [str(t?.caption), str(t?.description), str(t?.content)].filter(Boolean).join(" ");
  if (body) return body;
  return [str(record?.caption), str(record?.description), str(record?.content)].filter(Boolean).join(" ");
}

export function getPostSearchableText(record: PostRecord | null | undefined): string {
  const t = record ? textFrom(record) : null;
  const canonical = str(t?.searchableText);
  if (canonical) return canonical;
  const legacy = str(record?.searchableText ?? record?.searchText);
  if (legacy) return legacy;
  const loc = record ? locationFrom(record) : null;
  const disp = loc ? asRecord(loc.display) : null;
  const place = loc ? asRecord(loc.place) : null;
  const geoBits = [str(disp?.address), str(disp?.name), str(place?.placeName)].filter(Boolean).join(" ");
  return normalizeSearchableCorpus(`${getPostTitle(record)} ${getPostContent(record)} ${geoBits} ${getPostActivities(record).join(" ")}`);
}

function normalizeSearchableCorpus(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function getPostCreatedAtMs(record: PostRecord | null | undefined): number {
  if (!record) return 0;
  const life = lifecycleFrom(record);
  const fromLife = num(life?.createdAtMs);
  if (fromLife != null && fromLife > 0) return Math.floor(fromLife);
  const direct = num(record.createdAtMs ?? record.time);
  if (direct != null && direct > 0) return Math.floor(direct);
  const created = str(record.createdAt);
  if (created) {
    const ms = Date.parse(created);
    if (Number.isFinite(ms)) return ms;
  }
  const updated = str(record.updatedAt);
  if (updated) {
    const ms = Date.parse(updated);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

export function getPostUpdatedAtMs(record: PostRecord | null | undefined): number {
  if (!record) return 0;
  const life = lifecycleFrom(record);
  const iso = str(life?.updatedAt);
  if (iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  const direct = num(record.updatedAtMs ?? record.time ?? record.createdAtMs);
  if (direct != null && direct > 0) return Math.floor(direct);
  const c = getPostCreatedAtMs(record);
  return c > 0 ? c : Date.now();
}

export function getPostCoordinates(record: PostRecord | null | undefined): PostCoordinates {
  if (!record) return { lat: null, lng: null };
  const loc = locationFrom(record);
  const coords = loc ? asRecord(loc.coordinates) : null;
  const lat = num(coords?.lat) ?? num(record.lat);
  const lng = num(coords?.lng) ?? num(record.lng ?? record.long);
  return {
    lat: lat != null && Number.isFinite(lat) ? lat : null,
    lng: lng != null && Number.isFinite(lng) ? lng : null,
  };
}

export function getPostGeohash(record: PostRecord | null | undefined): string | null {
  const loc = record ? locationFrom(record) : null;
  const coords = loc ? asRecord(loc.coordinates) : null;
  const fromCanon = strOrNull(coords?.geohash);
  if (fromCanon) return fromCanon;
  const gd = asRecord(record?.geoData);
  return strOrNull(record?.geohash) ?? strOrNull(gd?.geohash);
}

export function getPostGeoRegions(record: PostRecord | null | undefined): PostGeoRegions {
  const loc = record ? locationFrom(record) : null;
  const regions = loc ? asRecord(loc.regions) : null;
  return {
    cityRegionId: strOrNull(regions?.cityRegionId) ?? strOrNull(record?.cityRegionId),
    stateRegionId: strOrNull(regions?.stateRegionId) ?? strOrNull(record?.stateRegionId),
    countryRegionId: strOrNull(regions?.countryRegionId) ?? strOrNull(record?.countryRegionId),
  };
}

export function getPostCityRegionId(record: PostRecord | null | undefined): string | null {
  return getPostGeoRegions(record).cityRegionId;
}

export function getPostStateRegionId(record: PostRecord | null | undefined): string | null {
  return getPostGeoRegions(record).stateRegionId;
}

export function getPostCountryRegionId(record: PostRecord | null | undefined): string | null {
  return getPostGeoRegions(record).countryRegionId;
}

export function getPostMediaKind(record: PostRecord | null | undefined): MasterPostMediaKindV2 | string {
  const cls = record ? classificationFrom(record) : null;
  const mk = str(cls?.mediaKind).toLowerCase();
  if (mk === "image" || mk === "video" || mk === "mixed" || mk === "text" || mk === "unknown") return mk as MasterPostMediaKindV2;
  const legacy = str(record?.mediaType).toLowerCase();
  if (legacy === "video" || legacy === "reel") return "video";
  if (legacy === "image" || legacy === "photo") return "image";
  return legacy || "unknown";
}

export function getPostMediaAssetCount(record: PostRecord | null | undefined): number {
  const media = record ? mediaFrom(record) : null;
  const c = num(media?.assetCount);
  if (c != null && c >= 0) return Math.floor(c);
  const assets = record?.assets;
  if (Array.isArray(assets)) return assets.length;
  return 0;
}

export function getPostMediaAssets(record: PostRecord | null | undefined): unknown[] {
  const media = record ? mediaFrom(record) : null;
  const fromMedia = media?.assets;
  if (Array.isArray(fromMedia)) return fromMedia;
  const top = record?.assets;
  return Array.isArray(top) ? top : [];
}

export function getPostCover(record: PostRecord | null | undefined): PostRecord | null {
  const media = record ? mediaFrom(record) : null;
  const cover = media ? asRecord(media.cover) : null;
  if (cover && Object.keys(cover).length) return cover;
  return null;
}

export function getPostCoverDisplayUrl(record: PostRecord | null | undefined): string {
  const cover = getPostCover(record);
  const fromCover = str(cover?.url ?? cover?.thumbUrl ?? cover?.posterUrl);
  if (/^https?:\/\//i.test(fromCover)) return fromCover;
  const compat = record ? compatibilityFrom(record) : null;
  const chain = str(
    compat?.displayPhotoLink ??
      compat?.photoLink ??
      record?.displayPhotoLink ??
      record?.photoLink ??
      record?.thumbUrl
  );
  if (/^https?:\/\//i.test(chain)) return chain;
  const assets = getPostMediaAssets(record);
  const a0 = assets[0] as PostRecord | undefined;
  if (a0 && typeof a0 === "object") {
    const img = asRecord(a0.image);
    const vid = asRecord(a0.video);
    const poster = str(img?.displayUrl ?? img?.thumbnailUrl ?? vid?.posterUrl ?? vid?.posterHighUrl);
    if (/^https?:\/\//i.test(poster)) return poster;
  }
  return "";
}

export function getPostPlayback(record: PostRecord | null | undefined): PostPlaybackSummary {
  const assets = getPostMediaAssets(record);
  for (const raw of assets) {
    const a = asRecord(raw);
    const vid = a ? asRecord(a.video) : null;
    const pb = vid ? asRecord(vid.playback) : null;
    if (pb && vid) {
      return {
        defaultUrl: strOrNull(pb.defaultUrl),
        primaryUrl: strOrNull(pb.primaryUrl),
        hlsUrl: strOrNull(pb.hlsUrl),
        fallbackUrl: strOrNull(pb.fallbackUrl),
        posterUrl: strOrNull(vid.posterUrl ?? vid.posterHighUrl),
      };
    }
  }
  const compat = record ? compatibilityFrom(record) : null;
  const fb = strOrNull(compat?.fallbackVideoUrl ?? record?.fallbackVideoUrl);
  const poster = strOrNull(compat?.posterUrl ?? record?.posterUrl);
  return { defaultUrl: fb, primaryUrl: fb, hlsUrl: null, fallbackUrl: fb, posterUrl: poster };
}

export function getPostAssetsReady(record: PostRecord | null | undefined): boolean | null {
  const media = record ? mediaFrom(record) : null;
  if (typeof media?.assetsReady === "boolean") return media.assetsReady;
  if (typeof record?.assetsReady === "boolean") return record.assetsReady as boolean;
  return null;
}

export function getPostEngagementCounts(record: PostRecord | null | undefined): PostEngagementCounts {
  const eng = record ? engagementFrom(record) : null;
  return {
    likeCount: Math.max(0, Math.floor(num(eng?.likeCount) ?? num(record?.likesCount) ?? num(record?.likeCount) ?? 0)),
    commentCount: Math.max(0, Math.floor(num(eng?.commentCount) ?? num(record?.commentsCount) ?? num(record?.commentCount) ?? 0)),
    saveCount: num(eng?.saveCount) ?? undefined,
    shareCount: num(eng?.shareCount) ?? undefined,
    viewCount: num(eng?.viewCount) ?? undefined,
  };
}

export function getPostRankingAggregates(record: PostRecord | null | undefined): Record<string, unknown> | null {
  const r = record ? rankingFrom(record) : null;
  const fromRank = r?.aggregates;
  if (fromRank && typeof fromRank === "object" && !Array.isArray(fromRank)) return fromRank as Record<string, unknown>;
  const legacy = record?.rankingAggregates;
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) return legacy as Record<string, unknown>;
  return null;
}

export function getPostRankingRollup(record: PostRecord | null | undefined): Record<string, unknown> | null {
  const r = record ? rankingFrom(record) : null;
  const fromRank = r?.rollup;
  if (fromRank && typeof fromRank === "object" && !Array.isArray(fromRank)) return fromRank as Record<string, unknown>;
  const legacy = record?.rankingRollup;
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) return legacy as Record<string, unknown>;
  return null;
}

export function getPostRecordings(record: PostRecord | null | undefined): unknown[] {
  const rec = record?.recordings;
  return Array.isArray(rec) ? rec : [];
}

export function getPostLegacyCompatibility(record: PostRecord | null | undefined): PostRecord {
  const compat = record ? compatibilityFrom(record) : null;
  if (compat) return { ...compat };
  return {
    photoLink: strOrNull(record?.photoLink),
    displayPhotoLink: strOrNull(record?.displayPhotoLink),
    thumbUrl: strOrNull(record?.thumbUrl),
    posterUrl: strOrNull(record?.posterUrl),
    fallbackVideoUrl: strOrNull(record?.fallbackVideoUrl),
    mediaType: str(record?.mediaType),
  };
}

/** Mix/search/map pools: align with legacy `isVisiblePost` — exclude private, deleted, archived, hidden. */
export function isPostVisibleInPublicAlgorithmPools(record: PostRecord | null | undefined): boolean {
  if (!record) return false;
  if (getPostVisibility(record) === "private") return false;
  if (getPostIsDeleted(record)) return false;
  if (record.archived === true || record.hidden === true) return false;
  const st = getPostLifecycleStatus(record);
  if (st === "hidden") return false;
  return true;
}

export type PostAlgorithmFieldSource = {
  route?: string;
  algorithm?: string;
  postId: string;
  schemaVersion: number;
  activitySource: "canonical" | "legacy_top" | "embedded_app" | "none";
  locationSource: "canonical" | "legacy_top" | "none";
  mediaSource: "canonical" | "legacy_top" | "none";
  rankingSource: "canonical" | "legacy_top" | "none";
  visibilitySource: "canonical" | "legacy_top" | "none";
};

function detectSource(present: boolean, legacyPresent: boolean): "canonical" | "legacy_top" | "none" {
  if (present) return "canonical";
  if (legacyPresent) return "legacy_top";
  return "none";
}

/** For structured logs when diagnosing canonical vs legacy mismatches. */
export function buildPostAlgorithmFieldSource(
  record: PostRecord | null | undefined,
  meta?: { route?: string; algorithm?: string },
): PostAlgorithmFieldSource | null {
  if (!record) return null;
  const cls = classificationFrom(record);
  const actsCanon = normalizeActivityList(cls?.activities).length > 0;
  const actsLegacy = normalizeActivityList(record.activities).length > 0;
  const activitySource: PostAlgorithmFieldSource["activitySource"] = actsCanon
    ? "canonical"
    : actsLegacy
      ? "legacy_top"
      : embeddedAppV2(record)
        ? "embedded_app"
        : "none";
  const loc = locationFrom(record);
  const hasCanonLoc = Boolean(loc && (asRecord(loc.coordinates)?.lat != null || asRecord(loc.regions)?.cityRegionId));
  const hasLegacyLoc = record.lat != null || record.cityRegionId != null;
  const media = mediaFrom(record);
  const hasCanonMedia = Boolean(media && (num(media.assetCount) != null || Array.isArray(media.assets)));
  const hasLegacyMedia = Array.isArray(record.assets);
  const rank = rankingFrom(record);
  const hasCanonRank = Boolean(rank && (rank.aggregates != null || rank.rollup != null));
  const hasLegacyRank = record.rankingAggregates != null || record.rankingRollup != null;
  const visCanon = str(classificationFrom(record)?.visibility).length > 0;
  return {
    route: meta?.route,
    algorithm: meta?.algorithm,
    postId: getPostId(record),
    schemaVersion: getPostSchemaVersion(record),
    activitySource,
    locationSource: detectSource(Boolean(hasCanonLoc), Boolean(hasLegacyLoc)),
    mediaSource: detectSource(hasCanonMedia, hasLegacyMedia),
    rankingSource: detectSource(hasCanonRank, Boolean(hasLegacyRank)),
    visibilitySource: visCanon ? "canonical" : str(record.privacy).length > 0 ? "legacy_top" : "none",
  };
}

/** When canonical activities differ from legacy top-level `activities`, prefer canonical (caller should log). */
export function postActivitiesCanonicalLegacyMismatch(record: PostRecord | null | undefined): boolean {
  if (!record || !isMasterPostV2(record)) return false;
  const canon = new Set(getPostActivities(record));
  const legacy = new Set(normalizeActivityList(record.activities));
  if (legacy.size === 0) return false;
  if (canon.size === 0) return false;
  for (const a of legacy) {
    if (!canon.has(a)) return true;
  }
  for (const a of canon) {
    if (!legacy.has(a)) return true;
  }
  return false;
}
