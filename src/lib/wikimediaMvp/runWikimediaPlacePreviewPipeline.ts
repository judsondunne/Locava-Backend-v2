import type { AppEnv } from "../../config/env.js";
import type {
  WikimediaMvpCollectEarlyStop,
  WikimediaMvpRunCaps,
  WikimediaMvpSeedPlace,
} from "./WikimediaMvpTypes.js";
import { runWikimediaMvpPlace } from "./WikimediaMvpRunner.js";

/**
 * Entrypoint string stored on State Content Factory runs for observability.
 * Matches the shared module used by `/dev/wikimedia-mvp/api/run-place` and the factory.
 */
export const WIKIMEDIA_PLACE_PREVIEW_PIPELINE_ENTRYPOINT = "runWikimediaPlacePreviewPipeline";

/**
 * Single-place Wikimedia MVP preview pipeline.
 *
 * When `matchStandaloneDevApi` is true (default), behavior matches
 * `POST /dev/wikimedia-mvp/api/run-place`: only `placeLabel` is sent; no custom `seed`
 * (runner uses `{ placeName: placeLabel, searchQuery: placeLabel }`).
 */
export async function runWikimediaPlacePreviewPipeline(input: {
  env: AppEnv;
  placeLabel: string;
  limit?: number;
  limitPerPlace?: number;
  fetchAll?: boolean;
  dryRun?: boolean;
  /** Default true: omit `seed` so Commons search matches the standalone dev API. */
  matchStandaloneDevApi?: boolean;
  seed?: WikimediaMvpSeedPlace;
  capsOverride?: Partial<WikimediaMvpRunCaps>;
  collectEarlyStop?: WikimediaMvpCollectEarlyStop;
  silencePerCandidateWikimediaEvents?: boolean;
}) {
  const match = input.matchStandaloneDevApi !== false;
  return runWikimediaMvpPlace({
    env: input.env,
    place: input.placeLabel.trim(),
    limit: input.limit,
    limitPerPlace: input.limitPerPlace,
    fetchAll: input.fetchAll,
    dryRun: input.dryRun,
    capsOverride: input.capsOverride,
    collectEarlyStop: input.collectEarlyStop,
    silencePerCandidateWikimediaEvents: input.silencePerCandidateWikimediaEvents,
    ...(match ? {} : { seed: input.seed }),
  });
}
