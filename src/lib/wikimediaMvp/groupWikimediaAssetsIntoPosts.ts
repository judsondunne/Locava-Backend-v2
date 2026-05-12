import { createHash } from "node:crypto";
import { hasRealAssetLocation } from "./hasRealAssetLocation.js";
import type {
  WikimediaAssetGroup,
  WikimediaMvpCandidateAnalysis,
  WikimediaMvpCandidateStatus,
  WikimediaMvpSeedPlace,
} from "./WikimediaMvpTypes.js";

export const WIKIMEDIA_MVP_MAX_IMAGES_PER_GROUP_POST = 5;

export type WikimediaAnalyzedCandidate = WikimediaMvpCandidateAnalysis & {
  candidateId: string;
  dayKey: string;
  capturedAtMs: number | null;
  assetLatitude: number | null;
  assetLongitude: number | null;
  hasRealAssetLocation: boolean;
  width: number;
  height: number;
  groupId?: string;
};

type TimeBucket = {
  method: WikimediaAssetGroup["groupMethod"];
  key: string;
  earliest?: string;
  latest?: string;
};

function candidateIdFromParts(sourceTitle: string, fullImageUrl: string): string {
  return createHash("sha1").update(`${sourceTitle}|${fullImageUrl}`).digest("hex").slice(0, 16);
}

export function toAnalyzedCandidate(
  analysis: WikimediaMvpCandidateAnalysis,
  asset: {
    dayKey: string;
    capturedAtMs: number | null;
    lat: number | null;
    lon: number | null;
    width: number;
    height: number;
  },
): WikimediaAnalyzedCandidate {
  const assetLatitude = asset.lat;
  const assetLongitude = asset.lon;
  return {
    ...analysis,
    candidateId: candidateIdFromParts(analysis.sourceTitle, analysis.fullImageUrl),
    dayKey: asset.dayKey,
    capturedAtMs: asset.capturedAtMs,
    assetLatitude,
    assetLongitude,
    hasRealAssetLocation: hasRealAssetLocation({ assetLatitude, assetLongitude }),
    width: asset.width,
    height: asset.height,
  };
}

function isExactDate(dayKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dayKey);
}

function monthKeyFromCandidate(candidate: WikimediaAnalyzedCandidate): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate.dayKey)) {
    return candidate.dayKey.slice(0, 7);
  }
  if (/^\d{4}-\d{2}$/.test(candidate.dayKey)) {
    return candidate.dayKey;
  }
  if (candidate.capturedAtMs != null && Number.isFinite(candidate.capturedAtMs)) {
    return new Date(candidate.capturedAtMs).toISOString().slice(0, 7);
  }
  return null;
}

function yearKeyFromCandidate(candidate: WikimediaAnalyzedCandidate): string | null {
  const month = monthKeyFromCandidate(candidate);
  if (month) return month.slice(0, 4);
  if (/^\d{4}$/.test(candidate.dayKey)) return candidate.dayKey;
  return null;
}

function timeBucketForCandidate(candidate: WikimediaAnalyzedCandidate): TimeBucket {
  if (isExactDate(candidate.dayKey)) {
    return { method: "exactDate", key: candidate.dayKey, earliest: candidate.dayKey, latest: candidate.dayKey };
  }
  const month = monthKeyFromCandidate(candidate);
  if (month) {
    return { method: "month", key: month, earliest: `${month}-01`, latest: `${month}-28` };
  }
  const year = yearKeyFromCandidate(candidate);
  if (year) {
    return { method: "year", key: year, earliest: `${year}-01-01`, latest: `${year}-12-31` };
  }
  return { method: "unknownDateSingleAsset", key: candidate.candidateId };
}

function compareCandidatesForGrouping(a: WikimediaAnalyzedCandidate, b: WikimediaAnalyzedCandidate): number {
  const ta = a.capturedAtMs;
  const tb = b.capturedAtMs;
  if (ta != null && tb != null && ta !== tb) return ta - tb;
  if (ta != null && tb == null) return -1;
  if (ta == null && tb != null) return 1;
  return b.qualityScore - a.qualityScore;
}

function chunkCandidates(candidates: WikimediaAnalyzedCandidate[], max: number): WikimediaAnalyzedCandidate[][] {
  if (candidates.length <= max) return [candidates];
  const out: WikimediaAnalyzedCandidate[][] = [];
  const sorted = [...candidates].sort(compareCandidatesForGrouping);
  for (let i = 0; i < sorted.length; i += max) {
    out.push(sorted.slice(i, i + max));
  }
  return out;
}

function pickRepresentativeCandidate(candidates: WikimediaAnalyzedCandidate[]): WikimediaAnalyzedCandidate {
  const located = candidates.filter((c) => c.hasRealAssetLocation);
  const pool = located.length > 0 ? located : candidates;
  return [...pool].sort((a, b) => {
    const scoreA = a.qualityScore + a.relevanceScore + (a.hasRealAssetLocation ? 2 : 0);
    const scoreB = b.qualityScore + b.relevanceScore + (b.hasRealAssetLocation ? 2 : 0);
    return scoreB - scoreA;
  })[0]!;
}

function mergeGroupStatus(candidates: WikimediaAnalyzedCandidate[]): WikimediaMvpCandidateStatus {
  if (candidates.some((c) => c.status === "REVIEW")) return "REVIEW";
  return "KEEP";
}

function buildGroup(input: {
  place: WikimediaMvpSeedPlace;
  bucket: TimeBucket;
  assets: WikimediaAnalyzedCandidate[];
}): WikimediaAssetGroup {
  const locatedAssetCount = input.assets.filter((c) => c.hasRealAssetLocation).length;
  const representative = pickRepresentativeCandidate(input.assets);
  const groupId = createHash("sha1")
    .update(`${input.place.placeName}|${input.bucket.key}|${input.assets.map((a) => a.candidateId).join(",")}`)
    .digest("hex")
    .slice(0, 16);
  for (const asset of input.assets) {
    asset.groupId = groupId;
  }
  const reasoning = [
    `groupMethod=${input.bucket.method}`,
    `groupKey=${input.bucket.key}`,
    `assetCount=${input.assets.length}`,
    `locatedAssetCount=${locatedAssetCount}`,
  ];
  if (locatedAssetCount === 0) {
    const placeLat = input.place.latitude;
    const placeLng = input.place.longitude;
    const placeHasCoords =
      placeLat != null && placeLng != null && Number.isFinite(Number(placeLat)) && Number.isFinite(Number(placeLng));
    const scores = input.assets.map((a) => a.mediaPlaceMatchScore ?? 0);
    const bestScore = scores.length ? Math.max(...scores) : 0;
    const hasExactPlaceTitle = input.assets.some((a) =>
      (a.mediaPlaceMatchReasons ?? []).includes("title_contains_full_place_name"),
    );
    if (placeHasCoords && (bestScore >= 45 || (hasExactPlaceTitle && bestScore >= 34))) {
      const useMethod: WikimediaAssetGroup["groupMethod"] =
        input.bucket.method === "unknownDateSingleAsset" ? "place_match_fallback" : input.bucket.method;
      return {
        groupId,
        placeName: input.place.placeName,
        groupKey: input.bucket.key,
        groupMethod: useMethod,
        dateRange: input.bucket.earliest || input.bucket.latest ? { earliest: input.bucket.earliest, latest: input.bucket.latest } : undefined,
        hasLocatedAsset: false,
        locatedAssetCount,
        assetCount: input.assets.length,
        assets: input.assets,
        representativeAssetId: representative.candidateId,
        generatedTitle: representative.generatedTitle,
        activities: [...new Set(input.assets.flatMap((a) => a.activities))].slice(0, 6),
        status: bestScore >= 70 ? mergeGroupStatus(input.assets) : "REVIEW",
        rejectionReasons: [],
        reasoning: [...reasoning, `place_candidate_location_fallback=1`, `bestMediaPlaceMatchScore=${bestScore}`],
        locationFallback: "place_candidate",
      };
    }
    return {
      groupId,
      placeName: input.place.placeName,
      groupKey: input.bucket.key,
      groupMethod: input.bucket.method,
      dateRange: input.bucket.earliest || input.bucket.latest ? { earliest: input.bucket.earliest, latest: input.bucket.latest } : undefined,
      hasLocatedAsset: false,
      locatedAssetCount,
      assetCount: input.assets.length,
      assets: input.assets,
      representativeAssetId: representative.candidateId,
      generatedTitle: representative.generatedTitle,
      activities: [...new Set(input.assets.flatMap((a) => a.activities))].slice(0, 6),
      status: "REJECT",
      rejectionReasons: ["group_has_no_located_assets"],
      reasoning,
      locationFallback: "none",
    };
  }
  return {
    groupId,
    placeName: input.place.placeName,
    groupKey: input.bucket.key,
    groupMethod: input.bucket.method,
    dateRange: input.bucket.earliest || input.bucket.latest ? { earliest: input.bucket.earliest, latest: input.bucket.latest } : undefined,
    hasLocatedAsset: true,
    locatedAssetCount,
    assetCount: input.assets.length,
    assets: input.assets,
    representativeAssetId: representative.candidateId,
    generatedTitle: representative.generatedTitle,
    activities: [...new Set(input.assets.flatMap((a) => a.activities))].slice(0, 6),
    status: mergeGroupStatus(input.assets),
    rejectionReasons: [],
    reasoning,
    locationFallback: "none",
  };
}

export function groupWikimediaAssetsIntoPosts(input: {
  place: WikimediaMvpSeedPlace;
  candidates: WikimediaAnalyzedCandidate[];
}): WikimediaAssetGroup[] {
  const pool = input.candidates.filter((c) => c.status !== "REJECT");
  const buckets = new Map<string, { bucket: TimeBucket; assets: WikimediaAnalyzedCandidate[] }>();
  for (const candidate of pool) {
    const bucket = timeBucketForCandidate(candidate);
    const mapKey = `${bucket.method}:${bucket.key}`;
    const row = buckets.get(mapKey) ?? { bucket, assets: [] };
    row.assets.push(candidate);
    buckets.set(mapKey, row);
  }

  const groups: WikimediaAssetGroup[] = [];
  for (const { bucket, assets } of buckets.values()) {
    if (bucket.method === "unknownDateSingleAsset") {
      for (const asset of assets) {
        groups.push(buildGroup({ place: input.place, bucket, assets: [asset] }));
      }
      continue;
    }
    for (const chunk of chunkCandidates(assets, WIKIMEDIA_MVP_MAX_IMAGES_PER_GROUP_POST)) {
      groups.push(buildGroup({ place: input.place, bucket, assets: chunk }));
    }
  }
  return groups;
}
