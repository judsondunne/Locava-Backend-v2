import type { AppEnv } from "../../config/env.js";

export function reelsMvpPublisherEnabledFromEnv(env: AppEnv): boolean {
  return String(env.REELS_MVP_PUBLISHER_ENABLED ?? "").trim() === "true";
}

export function reelsMvpPublisherWriteEnabledFromEnv(env: AppEnv): boolean {
  return String(env.REELS_MVP_PUBLISHER_WRITE_ENABLED ?? "").trim() === "true";
}

export function reelsMvpPublisherRequireReadyFromEnv(env: AppEnv): boolean {
  const raw = String(env.REELS_MVP_PUBLISHER_REQUIRE_READY ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

export function reelsMvpPublisherMaxBatchFromEnv(env: AppEnv): number {
  return env.REELS_MVP_PUBLISHER_MAX_BATCH;
}
