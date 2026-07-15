import type {
  CollectedReelInput,
  ReelCreator,
  UndiscoveredReel,
} from "../../../contracts/surfaces/undiscovered-reels.contract.js";
import { assembleUndiscoveredReel } from "./assembleUndiscoveredReel.js";
import { extractReelLocation, type GeminiJsonCaller } from "./extractReelLocation.js";
import { matchReelToSpot, type SpotCandidate } from "./matchReelToSpot.js";

/**
 * Batch pipeline: caption → AI place extraction → match to an uploaded spot →
 * assembled record. All external calls injectable so the whole flow is testable
 * offline; the route wires the real Gemini caller + a spot-candidate loader.
 */
export type ReelGeolocationDeps = {
  apiKey: string;
  model?: string;
  geminiCaller?: GeminiJsonCaller;
  /** Load spot candidates near an AI-extracted place name (route supplies Firestore-backed impl). */
  loadSpotCandidates: (extractedName: string) => Promise<SpotCandidate[]>;
  /** Resolve the authoritative IG creator for a reel (wins over pasted top-level fields). */
  fetchCreator?: (reel: CollectedReelInput) => Promise<Partial<ReelCreator> | null>;
};

export type ReelGeolocationSummary = {
  records: UndiscoveredReel[];
  counts: {
    total: number;
    spotMatched: number;
    aiEstimate: number;
    noLocation: number;
    withCreator: number;
  };
};

export async function runReelGeolocation(
  reels: CollectedReelInput[],
  region: string,
  deps: ReelGeolocationDeps,
): Promise<ReelGeolocationSummary> {
  const records: UndiscoveredReel[] = [];
  const counts = { total: 0, spotMatched: 0, aiEstimate: 0, noLocation: 0, withCreator: 0 };

  for (const reel of reels) {
    counts.total += 1;
    const extraction = await extractReelLocation(reel.caption ?? "", {
      apiKey: deps.apiKey,
      model: deps.model,
      caller: deps.geminiCaller,
    });
    const candidates = extraction.placeName ? await deps.loadSpotCandidates(extraction.placeName) : [];
    const match = matchReelToSpot(extraction.placeName, candidates);
    let authoritativeCreator: Partial<ReelCreator> | null = null;
    if (deps.fetchCreator) {
      try {
        authoritativeCreator = await deps.fetchCreator(reel);
      } catch {
        authoritativeCreator = null; // best-effort — fall back to pasted fields
      }
    }
    const record = assembleUndiscoveredReel({ reel, extraction, match, region, authoritativeCreator });
    records.push(record);

    if (record.location.source === "spot_match") counts.spotMatched += 1;
    else if (record.location.source === "ai_estimate") counts.aiEstimate += 1;
    else counts.noLocation += 1;
    if (record.creator.username) counts.withCreator += 1;
  }

  return { records, counts };
}
