import type { GenerateStatePlaceCandidatesRequest, PlaceCandidateMode } from "./types.js";
import { FAST_TARGETED_BUCKET_CONCURRENCY } from "./wikidataFastTargetedBuckets.js";

export type ResolvedPlaceCandidateModeConfig = {
  mode: PlaceCandidateMode;
  limit: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  concurrency: number;
};

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function resolveMode(request: GenerateStatePlaceCandidatesRequest): PlaceCandidateMode {
  if (request.mode === "fast_smoke" || request.mode === "fast_targeted" || request.mode === "deep_discovery") {
    return request.mode;
  }
  return "fast_targeted";
}

export function resolvePlaceCandidateModeConfig(
  request: GenerateStatePlaceCandidatesRequest,
): ResolvedPlaceCandidateModeConfig {
  const mode = resolveMode(request);

  if (mode === "fast_smoke") {
    const limit = clampInt(request.limit ?? 25, 1, 100);
    const totalTimeoutMs = clampInt(request.totalTimeoutMs ?? 8_000, 1_000, 12_000);
    const perQueryTimeoutMs = clampInt(request.perQueryTimeoutMs ?? 5_000, 500, totalTimeoutMs);
    return { mode, limit, totalTimeoutMs, perQueryTimeoutMs, concurrency: 1 };
  }

  if (mode === "fast_targeted") {
    const limit = clampInt(request.limit ?? 50, 1, 200);
    const totalTimeoutMs = clampInt(request.totalTimeoutMs ?? 10_000, 2_000, 15_000);
    const perQueryTimeoutMs = clampInt(request.perQueryTimeoutMs ?? 2_500, 500, totalTimeoutMs);
    return {
      mode,
      limit,
      totalTimeoutMs,
      perQueryTimeoutMs,
      concurrency: FAST_TARGETED_BUCKET_CONCURRENCY,
    };
  }

  const limit = clampInt(request.limit ?? 250, 1, 1_000);
  const totalTimeoutMs = clampInt(request.totalTimeoutMs ?? 30_000, 5_000, 300_000);
  const perQueryTimeoutMs = clampInt(request.perQueryTimeoutMs ?? 15_000, 1_000, 60_000);
  return { mode, limit, totalTimeoutMs, perQueryTimeoutMs, concurrency: 3 };
}
