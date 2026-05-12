export type PlaceCandidateMediaSignalConfig = {
  topN: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  concurrency: number;
};

export function resolvePlaceCandidateMediaSignalConfig(env: NodeJS.ProcessEnv = process.env): PlaceCandidateMediaSignalConfig {
  const readInt = (key: string, fallback: number, min: number, max: number) => {
    const raw = Number(env[key]);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(min, Math.min(raw, max));
  };
  return {
    topN: readInt("PLACE_CANDIDATE_MEDIA_SIGNAL_TOP_N", 75, 1, 200),
    totalTimeoutMs: readInt("PLACE_CANDIDATE_MEDIA_SIGNAL_TOTAL_TIMEOUT_MS", 4_000, 500, 15_000),
    perQueryTimeoutMs: readInt("PLACE_CANDIDATE_MEDIA_SIGNAL_PER_QUERY_TIMEOUT_MS", 1_200, 200, 5_000),
    concurrency: readInt("PLACE_CANDIDATE_MEDIA_SIGNAL_CONCURRENCY", 5, 1, 10),
  };
}
