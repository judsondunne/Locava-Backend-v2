import type { WikimediaAnalyzedCandidate } from "./groupWikimediaAssetsIntoPosts.js";
import type { WikimediaAssetHygieneFields } from "./WikimediaMvpHygieneTypes.js";
import { hammingDistanceHex64 } from "./visualHashFromImageUrl.js";

export type HygieneCandidate = WikimediaAnalyzedCandidate & WikimediaAssetHygieneFields;

function normalizeUrl(url: string | null | undefined): string {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\?.*$/, "");
}

function normalizeTitle(title: string): string {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/^file:/, "");
}

function metadataCompleteness(candidate: HygieneCandidate): number {
  let score = 0;
  if (candidate.license) score += 1;
  if (candidate.author) score += 1;
  if (candidate.credit) score += 1;
  return score;
}

export function compareCandidateKeepPriority(a: HygieneCandidate, b: HygieneCandidate): number {
  if (a.hasRealAssetLocation !== b.hasRealAssetLocation) return a.hasRealAssetLocation ? -1 : 1;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA !== areaB) return areaB - areaA;
  if (a.qualityScore !== b.qualityScore) return b.qualityScore - a.qualityScore;
  if (a.relevanceScore !== b.relevanceScore) return b.relevanceScore - a.relevanceScore;
  const metaA = metadataCompleteness(a);
  const metaB = metadataCompleteness(b);
  if (metaA !== metaB) return metaB - metaA;
  return a.candidateId.localeCompare(b.candidateId);
}

function exactDuplicateKeys(candidate: HygieneCandidate): string[] {
  const keys: string[] = [];
  const full = normalizeUrl(candidate.fullImageUrl);
  const thumb = normalizeUrl(candidate.thumbnailUrl);
  const source = normalizeUrl(candidate.sourceUrl);
  const title = normalizeTitle(candidate.sourceTitle);
  if (full) keys.push(`full:${full}`);
  if (thumb) keys.push(`thumb:${thumb}`);
  if (source) keys.push(`source:${source}`);
  if (title) keys.push(`title:${title}`);
  return keys;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(id: string): string {
    const parent = this.parent.get(id) ?? id;
    if (parent !== id) {
      const root = this.find(parent);
      this.parent.set(id, root);
      return root;
    }
    this.parent.set(id, id);
    return id;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

function timestampDeltaSeconds(a: HygieneCandidate, b: HygieneCandidate): number | null {
  if (a.capturedAtMs == null || b.capturedAtMs == null) return null;
  return Math.abs(a.capturedAtMs - b.capturedAtMs) / 1000;
}

function extremelySimilarTitle(a: HygieneCandidate, b: HygieneCandidate): boolean {
  const ta = normalizeTitle(a.sourceTitle);
  const tb = normalizeTitle(b.sourceTitle);
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  return ta.includes(tb) || tb.includes(ta);
}

function sameDimensionsAndAspect(a: HygieneCandidate, b: HygieneCandidate): boolean {
  return a.width === b.width && a.height === b.height;
}

function nearDuplicateReason(primary: HygieneCandidate, other: HygieneCandidate): string | null {
  const ts = timestampDeltaSeconds(primary, other);
  if (ts != null && ts <= 60) return "near_duplicate_visual_hash_and_close_timestamp";
  if (
    primary.hasRealAssetLocation &&
    other.hasRealAssetLocation &&
    primary.assetLatitude != null &&
    primary.assetLongitude != null &&
    other.assetLatitude != null &&
    other.assetLongitude != null &&
    haversineMeters(primary.assetLatitude, primary.assetLongitude, other.assetLatitude, other.assetLongitude) <= 20
  ) {
    return "near_duplicate_visual_hash_and_same_location";
  }
  if (
    primary.author &&
    other.author &&
    primary.author === other.author &&
    primary.dayKey === other.dayKey &&
    extremelySimilarTitle(primary, other) &&
    sameDimensionsAndAspect(primary, other)
  ) {
    return "near_duplicate_visual_hash_and_same_location";
  }
  if (extremelySimilarTitle(primary, other) && sameDimensionsAndAspect(primary, other)) {
    return "near_duplicate_visual_hash_and_same_location";
  }
  return null;
}

export function dedupeExactGroupAssets(candidates: HygieneCandidate[]): {
  kept: HygieneCandidate[];
  removed: HygieneCandidate[];
} {
  if (candidates.length <= 1) return { kept: [...candidates], removed: [] };
  const uf = new UnionFind();
  const keyToCandidateId = new Map<string, string>();
  for (const candidate of candidates) {
    uf.find(candidate.candidateId);
    for (const key of exactDuplicateKeys(candidate)) {
      const existingId = keyToCandidateId.get(key);
      if (existingId) uf.union(candidate.candidateId, existingId);
      else keyToCandidateId.set(key, candidate.candidateId);
    }
  }
  const clusters = new Map<string, HygieneCandidate[]>();
  for (const candidate of candidates) {
    const root = uf.find(candidate.candidateId);
    const row = clusters.get(root) ?? [];
    row.push(candidate);
    clusters.set(root, row);
  }
  const kept: HygieneCandidate[] = [];
  const removed: HygieneCandidate[] = [];
  for (const cluster of clusters.values()) {
    const sorted = [...cluster].sort(compareCandidateKeepPriority);
    const winner = sorted[0]!;
    winner.duplicateDecision = winner.duplicateDecision ?? "PRIMARY";
    kept.push(winner);
    for (const loser of sorted.slice(1)) {
      removed.push({
        ...loser,
        hygieneStatus: "REJECT",
        hygieneReasons: [...loser.hygieneReasons, "exact_duplicate_same_source"],
        duplicateDecision: "DUPLICATE_REJECTED",
        duplicateClusterId: winner.candidateId,
      });
    }
  }
  return { kept, removed };
}

export function dedupeNearGroupAssets(candidates: HygieneCandidate[]): {
  kept: HygieneCandidate[];
  removed: HygieneCandidate[];
} {
  const sorted = [...candidates].sort(compareCandidateKeepPriority);
  const kept: HygieneCandidate[] = [];
  const removed: HygieneCandidate[] = [];
  const primaries: HygieneCandidate[] = [];

  for (const candidate of sorted) {
    let matchedPrimary: HygieneCandidate | null = null;
    let bestDistance = 64;
    for (const primary of primaries) {
      if (!candidate.visualHash || !primary.visualHash) continue;
      const distance = hammingDistanceHex64(candidate.visualHash, primary.visualHash);
      if (distance < bestDistance) {
        bestDistance = distance;
        matchedPrimary = primary;
      }
    }
    if (!matchedPrimary || !candidate.visualHash || !matchedPrimary.visualHash) {
      candidate.duplicateDecision = candidate.duplicateDecision ?? "UNIQUE";
      primaries.push(candidate);
      kept.push(candidate);
      continue;
    }
    const distance = hammingDistanceHex64(candidate.visualHash, matchedPrimary.visualHash);
    candidate.visualHashDistanceToPrimary = distance;
    const reason = nearDuplicateReason(matchedPrimary, candidate);
    if (distance <= 6 && reason) {
      removed.push({
        ...candidate,
        hygieneStatus: "REJECT",
        hygieneReasons: [...candidate.hygieneReasons, reason],
        duplicateDecision: "DUPLICATE_REJECTED",
        duplicateClusterId: matchedPrimary.candidateId,
        visualHashDistanceToPrimary: distance,
      });
      continue;
    }
    if (distance >= 7 && distance <= 10) {
      candidate.duplicateDecision = "POSSIBLE_DUPLICATE_REVIEW";
      candidate.hygieneStatus = candidate.hygieneStatus === "REJECT" ? "REJECT" : "REVIEW";
      if (!candidate.hygieneReasons.includes("possible_duplicate_kept_conservative")) {
        candidate.hygieneReasons = [...candidate.hygieneReasons, "possible_duplicate_kept_conservative"];
      }
      primaries.push(candidate);
      kept.push(candidate);
      continue;
    }
    candidate.duplicateDecision = candidate.duplicateDecision ?? "UNIQUE";
    primaries.push(candidate);
    kept.push(candidate);
  }

  return { kept, removed };
}
