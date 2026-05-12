import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateStatePlaceCandidates } from "./generateStatePlaceCandidates.js";
import { resolvePlaceCandidateModeConfig } from "./placeCandidateModeConfig.js";
import * as wikidataFastSmokeSource from "./wikidataFastSmokeSource.js";
import * as wikidataPlaceCandidateSource from "./wikidataPlaceCandidateSource.js";

describe("place candidate mode config", () => {
  it("defaults to fast targeted limits and timeouts", () => {
    expect(resolvePlaceCandidateModeConfig({ stateName: "Vermont" })).toEqual({
      mode: "fast_targeted",
      limit: 50,
      totalTimeoutMs: 10_000,
      perQueryTimeoutMs: 2_500,
      concurrency: 4,
    });
  });

  it("clamps fast smoke limits safely", () => {
    expect(
      resolvePlaceCandidateModeConfig({
        stateName: "Vermont",
        mode: "fast_smoke",
        limit: 500,
        totalTimeoutMs: 60_000,
        perQueryTimeoutMs: 90_000,
      }),
    ).toEqual({
      mode: "fast_smoke",
      limit: 100,
      totalTimeoutMs: 12_000,
      perQueryTimeoutMs: 12_000,
      concurrency: 1,
    });
  });
});

describe("fast smoke performance guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns timeout quickly without deep per-type fallback", async () => {
    const deepSpy = vi.spyOn(wikidataPlaceCandidateSource, "fetchWikidataPlaceCandidatesDeepDiscovery");
    const fastSpy = vi.spyOn(wikidataFastSmokeSource, "fetchWikidataFastSmokePlaceCandidates").mockImplementation(
      async (input) => {
        await new Promise((resolve) => setTimeout(resolve, input.perQueryTimeoutMs + 100));
        return {
          candidates: [],
          sourceTimings: [
            {
              source: "wikidata",
              mode: "fast_smoke",
              elapsedMs: input.perQueryTimeoutMs + 100,
              queryElapsedMs: input.perQueryTimeoutMs + 100,
              fetched: 0,
              timedOut: true,
            },
          ],
          partial: true,
          timeout: true,
          timeoutReason: "FAST_SMOKE_TOTAL_TIMEOUT",
        };
      },
    );

    const promise = generateStatePlaceCandidates({
      stateName: "Vermont",
      stateCode: "VT",
      mode: "fast_smoke",
      limit: 25,
      totalTimeoutMs: 8000,
      perQueryTimeoutMs: 100,
      minScore: 0,
      dryRun: true,
    });

    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(fastSpy).toHaveBeenCalledTimes(1);
    expect(deepSpy).not.toHaveBeenCalled();
    expect(result.timeout).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("fast_smoke");
    expect(result.elapsedMs).toBeLessThanOrEqual(8000 + 250);
    expect(result.events.some((event) => event.type === "PLACE_CANDIDATE_FAST_SMOKE_TIMEOUT")).toBe(true);
    expect(result.events.some((event) => event.counts?.mode === "per_type")).toBe(false);
  });
});
