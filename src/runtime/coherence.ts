import type { AppEnv } from "../config/env.js";

export type CoherenceMode = AppEnv["COHERENCE_MODE"];

export function getCoherenceStatus(env: AppEnv): {
  mode: CoherenceMode;
  processLocalOnly: boolean;
  redisConfigured: boolean;
  warning: string | null;
} {
  const processLocalOnly = env.COHERENCE_MODE === "process_local";
  const redisConfigured = Boolean(env.REDIS_URL);
  let warning: string | null = null;
  if (processLocalOnly) {
    warning = "Process-local cache/dedupe/lock/invalidation assumptions remain. Use single-instance or implement external coordinator.";
  } else if (env.COHERENCE_MODE === "redis" && !redisConfigured) {
    warning = "Redis coherence mode is enabled without REDIS_URL; falling back to process-local coherence.";
  } else if (env.COHERENCE_MODE === "external_coordinator_stub") {
    warning = "External coordinator stub mode does not provide cross-instance coherence guarantees.";
  }
  return {
    mode: env.COHERENCE_MODE,
    processLocalOnly,
    redisConfigured,
    warning
  };
}
