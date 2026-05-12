import type { PlaceCandidate } from "../place-candidates/types.js";
import type { WikimediaMvpSeedPlace } from "../wikimediaMvp/WikimediaMvpTypes.js";

export function buildWikimediaSearchLabelFromPlaceCandidate(candidate: PlaceCandidate): string {
  const stateLabel = candidate.stateCode ? `${candidate.state}, ${candidate.stateCode}` : candidate.state;
  return [candidate.name, stateLabel].filter(Boolean).join(", ").slice(0, 120);
}

export function buildWikimediaSeedFromPlaceCandidate(candidate: PlaceCandidate): WikimediaMvpSeedPlace {
  const searchQuery =
    candidate.primaryCategory === "manual"
      ? candidate.name
      : buildWikimediaSearchLabelFromPlaceCandidate(candidate);
  const themes = [candidate.primaryCategory, ...(candidate.categories ?? [])]
    .filter((value): value is string => Boolean(value))
    .slice(0, 8);
  const commonsCat =
    candidate.sourceIds?.commonsCategory?.trim() ||
    candidate.mediaSignals?.commonsCategory?.trim() ||
    candidate.sourceUrls?.commonsCategory?.trim()?.split("/").pop()?.trim();

  return {
    placeName: candidate.name,
    searchQuery,
    stateName: candidate.state,
    stateCode: candidate.stateCode,
    placeCategoryKeywords: candidate.categories ?? [],
    commonsCategoryFromWikidata: commonsCat,
    wikidataQid: candidate.sourceIds?.wikidata,
    wikipediaTitle: candidate.sourceIds?.wikipedia,
    latitude: candidate.lat ?? null,
    longitude: candidate.lng ?? null,
    rationale: candidate.priorityQueue ? `priorityQueue=${candidate.priorityQueue}` : undefined,
    themes,
  };
}
