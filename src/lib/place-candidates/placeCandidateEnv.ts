import type { AppEnv } from "../../config/env.js";

export function placeCandidateDevPageEnabled(env: AppEnv): boolean {
  return String(env.ENABLE_PLACE_CANDIDATE_DEV_PAGE ?? "").trim() === "true";
}
