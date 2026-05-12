import type { PlaceCandidate } from "./types.js";

function roundedCoordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

function normalizedNameKey(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeCandidates(primary: PlaceCandidate, other: PlaceCandidate): PlaceCandidate {
  const categories = [...new Set([...primary.categories, ...other.categories])];
  const winner = primary.locavaScore >= other.locavaScore ? primary : other;
  const loser = winner === primary ? other : primary;
  return {
    ...winner,
    categories,
    primaryCategory: winner.primaryCategory ?? other.primaryCategory,
    sourceIds: { ...loser.sourceIds, ...winner.sourceIds },
    sourceUrls: { ...loser.sourceUrls, ...winner.sourceUrls },
    rawSources: [...new Set([...winner.rawSources, ...other.rawSources])],
    sourceConfidence: Math.max(winner.sourceConfidence, other.sourceConfidence),
    locavaScore: Math.max(winner.locavaScore, other.locavaScore),
    candidateTier: winner.locavaScore >= other.locavaScore ? winner.candidateTier : other.candidateTier,
    signals: {
      ...winner.signals,
      hasWikipedia: winner.signals.hasWikipedia || other.signals.hasWikipedia,
      hasCommonsCategory: winner.signals.hasCommonsCategory || other.signals.hasCommonsCategory,
      hasImageField: winner.signals.hasImageField || other.signals.hasImageField,
      hasUsefulCategory: winner.signals.hasUsefulCategory || other.signals.hasUsefulCategory,
      isOutdoorLikely: winner.signals.isOutdoorLikely || other.signals.isOutdoorLikely,
      isLandmarkLikely: winner.signals.isLandmarkLikely || other.signals.isLandmarkLikely,
      isTourismLikely: winner.signals.isTourismLikely || other.signals.isTourismLikely,
      isTooGeneric: winner.signals.isTooGeneric && other.signals.isTooGeneric,
    },
    debug: {
      ...winner.debug,
      matchedSourceCategories: [...new Set([...winner.debug.matchedSourceCategories, ...other.debug.matchedSourceCategories])],
      normalizedFrom: [...new Set([...winner.debug.normalizedFrom, ...other.debug.normalizedFrom])],
      scoreReasons: [...new Set([...winner.debug.scoreReasons, ...other.debug.scoreReasons])],
      tierReasons: [...new Set([...winner.debug.tierReasons, ...other.debug.tierReasons])],
      dedupeKey: winner.sourceIds.wikidata || winner.debug.dedupeKey,
    },
  };
}

export function dedupePlaceCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const byQid = new Map<string, PlaceCandidate>();
  const out: PlaceCandidate[] = [];

  for (const candidate of candidates) {
    const qid = candidate.sourceIds.wikidata;
    if (qid) {
      const existing = byQid.get(qid);
      if (!existing) {
        byQid.set(qid, candidate);
        continue;
      }
      byQid.set(qid, mergeCandidates(existing, candidate));
      continue;
    }
    out.push(candidate);
  }

  const merged = [...byQid.values(), ...out];
  const byNameCoord = new Map<string, PlaceCandidate>();
  for (const candidate of merged) {
    const key = `${normalizedNameKey(candidate.name)}|${roundedCoordKey(candidate.lat, candidate.lng)}`;
    const existing = byNameCoord.get(key);
    if (!existing) {
      byNameCoord.set(key, candidate);
      continue;
    }
    byNameCoord.set(key, mergeCandidates(existing, candidate));
  }
  return [...byNameCoord.values()].sort((a, b) => b.locavaScore - a.locavaScore || a.name.localeCompare(b.name));
}

export function shouldMergeByNameAndCoords(a: PlaceCandidate, b: PlaceCandidate): boolean {
  return (
    normalizedNameKey(a.name) === normalizedNameKey(b.name) &&
    roundedCoordKey(a.lat, a.lng) === roundedCoordKey(b.lat, b.lng)
  );
}
