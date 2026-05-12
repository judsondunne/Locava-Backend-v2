import type { AppEnv } from "../../config/env.js";
import type { StateContentFactoryRunConfig } from "./types.js";
import type { WikimediaMvpRunCaps } from "../wikimediaMvp/WikimediaMvpTypes.js";

export type StateContentWikimediaMode = "fast_preview" | "balanced" | "exhaustive";

export type WikimediaCollectEarlyStop = {
  enabled: boolean;
  /** After this many unique discovered titles, stop running lower-priority queries (higher rank index). */
  minDiscoveredTitles: number;
  /** Do not run plan entries with rank greater than this once early-stop triggers (0 = exact name only). */
  maxPlanRankWhileEarly: number;
};

export type ResolvedWikimediaPipelineConfig = {
  mode: StateContentWikimediaMode;
  fetchAll: boolean;
  perPlaceTimeoutMs: number;
  maxPostPreviewsPerPlace: number;
  capsOverride: Partial<WikimediaMvpRunCaps>;
  collectEarlyStop: WikimediaCollectEarlyStop;
  maxCommonsResultsPerPlace: number;
  maxHydratedAssetsPerPlace: number;
};

/**
 * Maps factory `wikimediaMode` + legacy `wikimediaFetchAllExhaustive` into runner caps and collect behavior.
 */
export function resolveWikimediaPipelineConfig(
  config: StateContentFactoryRunConfig,
  env: AppEnv,
): ResolvedWikimediaPipelineConfig {
  const explicit = config.wikimediaMode;
  const legacyExhaustive = config.wikimediaFetchAllExhaustive !== false;
  const mode: StateContentWikimediaMode =
    explicit ?? (legacyExhaustive ? "exhaustive" : "balanced");

  const perPlaceTimeoutMs = Math.min(
    config.perPlaceTimeoutMs,
    mode === "exhaustive" ? config.perPlaceTimeoutMs : mode === "balanced" ? 25_000 : 15_000,
  );

  if (mode === "exhaustive") {
    return {
      mode,
      fetchAll: true,
      perPlaceTimeoutMs: config.perPlaceTimeoutMs,
      maxPostPreviewsPerPlace: config.maxPostPreviewsPerPlace,
      capsOverride: {
        maxCandidatesPerPlace: env.WIKIMEDIA_MVP_FETCH_ALL_MAX_CANDIDATES_PER_PLACE,
        maxHydrateTitlesPerPlace: env.WIKIMEDIA_MVP_MAX_HYDRATE_TITLES_PER_PLACE,
        maxSearchPagesPerPlace: env.WIKIMEDIA_MVP_FETCH_ALL_MAX_SEARCH_PAGES,
        fetchAllMaxCandidatesPerPlace: env.WIKIMEDIA_MVP_FETCH_ALL_MAX_CANDIDATES_PER_PLACE,
        fetchAllMaxSearchPages: env.WIKIMEDIA_MVP_FETCH_ALL_MAX_SEARCH_PAGES,
        placeTimeoutMs: perPlaceTimeoutMs,
      },
      collectEarlyStop: { enabled: false, minDiscoveredTitles: 9999, maxPlanRankWhileEarly: 99 },
      maxCommonsResultsPerPlace: env.WIKIMEDIA_MVP_FETCH_ALL_MAX_CANDIDATES_PER_PLACE,
      maxHydratedAssetsPerPlace: env.WIKIMEDIA_MVP_MAX_HYDRATE_TITLES_PER_PLACE,
    };
  }

  if (mode === "balanced") {
    const maxCommons = 150;
    const maxHydrate = 75;
    const maxPages = 5;
    return {
      mode,
      fetchAll: false,
      perPlaceTimeoutMs,
      maxPostPreviewsPerPlace: Math.min(config.maxPostPreviewsPerPlace, 5),
      capsOverride: {
        maxCandidatesPerPlace: maxCommons,
        maxHydrateTitlesPerPlace: maxHydrate,
        maxSearchPagesPerPlace: maxPages,
        fetchAllMaxCandidatesPerPlace: maxCommons,
        fetchAllMaxSearchPages: maxPages,
        placeTimeoutMs: perPlaceTimeoutMs,
        maxAnalyzedCandidatesForGrouping: 20,
      },
      collectEarlyStop: {
        enabled: true,
        minDiscoveredTitles: 8,
        maxPlanRankWhileEarly: 2,
      },
      maxCommonsResultsPerPlace: maxCommons,
      maxHydratedAssetsPerPlace: maxHydrate,
    };
  }

  /* fast_preview */
  const maxCommons = 80;
  const maxHydrate = 40;
  const maxPages = 3;
  return {
    mode: "fast_preview",
    fetchAll: false,
    perPlaceTimeoutMs: Math.min(perPlaceTimeoutMs, 15_000),
    maxPostPreviewsPerPlace: Math.min(config.maxPostPreviewsPerPlace, 3),
    capsOverride: {
      maxCandidatesPerPlace: maxCommons,
      maxHydrateTitlesPerPlace: maxHydrate,
      maxSearchPagesPerPlace: maxPages,
      fetchAllMaxCandidatesPerPlace: maxCommons,
      fetchAllMaxSearchPages: maxPages,
      placeTimeoutMs: Math.min(perPlaceTimeoutMs, 15_000),
      maxAnalyzedCandidatesForGrouping: 12,
    },
    collectEarlyStop: {
      enabled: true,
      minDiscoveredTitles: 6,
      maxPlanRankWhileEarly: 1,
    },
    maxCommonsResultsPerPlace: maxCommons,
    maxHydratedAssetsPerPlace: maxHydrate,
  };
}
