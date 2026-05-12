import type { AppEnv } from "../../config/env.js";
import type { WikimediaMvpRunCaps } from "./WikimediaMvpTypes.js";

export function wikimediaMvpDevPageEnabled(env: AppEnv): boolean {
  if (String(env.ENABLE_WIKIMEDIA_MVP_DEV_PAGE ?? "").trim() !== "true") {
    return false;
  }
  if (env.NODE_ENV === "production" && String(env.ENABLE_WIKIMEDIA_MVP_DEV_PAGE ?? "").trim() !== "true") {
    return false;
  }
  return true;
}

export function wikimediaMvpWritesAllowed(env: AppEnv): boolean {
  return String(env.WIKIMEDIA_MVP_ALLOW_WRITES ?? "").trim() === "true";
}

export function wikimediaMvpFirestoreDedupeEnabled(env: AppEnv): boolean {
  return String(env.WIKIMEDIA_MVP_ENABLE_FIRESTORE_DEDUPE ?? "").trim() === "true";
}

export function wikimediaMvpRunCapsFromEnv(env: AppEnv, overrides: Partial<WikimediaMvpRunCaps> = {}): WikimediaMvpRunCaps {
  return {
    maxPlacesPerRun: overrides.maxPlacesPerRun ?? env.WIKIMEDIA_MVP_MAX_PLACES_PER_RUN,
    maxCandidatesPerPlace: overrides.maxCandidatesPerPlace ?? env.WIKIMEDIA_MVP_MAX_CANDIDATES_PER_PLACE,
    maxSearchPagesPerPlace: overrides.maxSearchPagesPerPlace ?? env.WIKIMEDIA_MVP_MAX_SEARCH_PAGES_PER_PLACE,
    maxHydrateTitlesPerPlace: overrides.maxHydrateTitlesPerPlace ?? env.WIKIMEDIA_MVP_MAX_HYDRATE_TITLES_PER_PLACE,
    fetchAllMaxCandidatesPerPlace:
      overrides.fetchAllMaxCandidatesPerPlace ?? env.WIKIMEDIA_MVP_FETCH_ALL_MAX_CANDIDATES_PER_PLACE,
    fetchAllMaxSearchPages: overrides.fetchAllMaxSearchPages ?? env.WIKIMEDIA_MVP_FETCH_ALL_MAX_SEARCH_PAGES,
    placeTimeoutMs: overrides.placeTimeoutMs ?? env.WIKIMEDIA_MVP_PLACE_TIMEOUT_MS,
    maxAnalyzedCandidatesForGrouping: overrides.maxAnalyzedCandidatesForGrouping,
  };
}
