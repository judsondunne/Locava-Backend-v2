import type { PlaceCandidate } from "../place-candidates/types.js";
import { buildWikimediaSearchLabelFromPlaceCandidate } from "./buildWikimediaSeedFromPlaceCandidate.js";

export function mapPlaceCandidateToWikimediaPlace(candidate: PlaceCandidate): string {
  return buildWikimediaSearchLabelFromPlaceCandidate(candidate);
}
