const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

function uniqueEndpoints(): string[] {
  const fromEnv = process.env.OVERPASS_URL?.trim();
  const list = fromEnv ? [fromEnv, ...DEFAULT_OVERPASS_ENDPOINTS] : DEFAULT_OVERPASS_ENDPOINTS;
  return [...new Set(list)];
}

function isRetryableOverpassError(message: string): boolean {
  if (/overpass_http_40[0134]|overpass_http_404/.test(message)) return false;
  return /504|429|502|503|408|timeout|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|overpass_http/i.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type OverpassFetchInput = {
  query: string;
  userAgent: string;
};

/** POST an Overpass QL query with retries and mirror fallback. */
export async function fetchOverpassJson(input: OverpassFetchInput): Promise<unknown> {
  const delays = [0, 2500, 6000];
  let lastError: Error | null = null;

  for (const endpoint of uniqueEndpoints()) {
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt]! > 0) {
        await sleep(delays[attempt]!);
      }
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": input.userAgent,
          },
          body: `data=${encodeURIComponent(input.query)}`,
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) {
          throw new Error(`overpass_http_${res.status}@${new URL(endpoint).hostname}`);
        }
        return await res.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable = isRetryableOverpassError(lastError.message);
        if (!retryable && attempt === delays.length - 1) break;
        if (retryable && attempt < delays.length - 1) continue;
      }
    }
  }

  throw lastError ?? new Error("openstreetmap_overpass_failed");
}
