import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateStatePlaceCandidates } from "./generateStatePlaceCandidates.js";
import { normalizeWikidataPlaceCandidate } from "./normalizePlaceCandidate.js";
import { resolvePlaceCandidateModeConfig } from "./placeCandidateModeConfig.js";
import { scorePlaceCandidate } from "./scorePlaceCandidate.js";
import { resolveUsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import {
  FAST_TARGETED_EXCLUDED_CATEGORY_HINTS,
  WIKIDATA_FAST_TARGETED_BUCKETS,
  listFastTargetedBucketIds,
} from "./wikidataFastTargetedBuckets.js";
import * as wikidataFastSmokeSource from "./wikidataFastSmokeSource.js";
import * as wikidataFastTargetedSource from "./wikidataFastTargetedSource.js";
import * as wikidataPlaceCandidateSource from "./wikidataPlaceCandidateSource.js";
import * as placeCandidateMediaSignals from "./placeCandidateMediaSignals.js";

const state = resolveUsStatePlaceConfig({ stateName: "Vermont", stateCode: "VT" });

function rawFromBucket(bucketId: string, name: string) {
  const bucket = WIKIDATA_FAST_TARGETED_BUCKETS.find((row) => row.bucketId === bucketId);
  if (!bucket) throw new Error(`missing bucket ${bucketId}`);
  return {
    source: "wikidata" as const,
    qid: `Q_${bucketId}`,
    name,
    lat: 44.1,
    lng: -72.9,
    instanceLabels: [...bucket.categoryHints],
    sourceBucketIds: [bucket.bucketId],
    sourceBucketLabels: [bucket.label],
    targetedCategoryHints: [...bucket.categoryHints],
  };
}

describe("fast targeted mode config", () => {
  it("defaults to fast targeted limits and timeouts", () => {
    expect(resolvePlaceCandidateModeConfig({ stateName: "Vermont" })).toEqual({
      mode: "fast_targeted",
      limit: 50,
      totalTimeoutMs: 10_000,
      perQueryTimeoutMs: 2_500,
      concurrency: 4,
    });
  });
});

describe("fast targeted bucket mapping", () => {
  it("maps waterfall bucket to waterfall category and tier A", () => {
    const candidate = scorePlaceCandidate(normalizeWikidataPlaceCandidate(rawFromBucket("waterfall", "Moss Glen Falls"), state, false));
    expect(candidate.primaryCategory).toBe("waterfall");
    expect(candidate.candidateTier).toBe("A");
    expect(candidate.debug.targetedCategoryHints).toContain("waterfall");
  });

  it("maps cave bucket to cave category and tier A", () => {
    const candidate = scorePlaceCandidate(normalizeWikidataPlaceCandidate(rawFromBucket("cave", "Aeolus Cave"), state, false));
    expect(candidate.primaryCategory).toBe("cave");
    expect(candidate.candidateTier).toBe("A");
  });

  it("maps park bucket to park/nature and tier A", () => {
    const candidate = scorePlaceCandidate(
      normalizeWikidataPlaceCandidate(rawFromBucket("park_protected_area", "Camel's Hump State Park"), state, false),
    );
    expect(candidate.categories).toEqual(expect.arrayContaining(["park"]));
    expect(candidate.candidateTier).toBe("A");
  });

  it("maps museum bucket to tier B", () => {
    const candidate = scorePlaceCandidate(normalizeWikidataPlaceCandidate(rawFromBucket("museum", "Fairbanks Museum"), state, false));
    expect(candidate.primaryCategory).toBe("museum");
    expect(candidate.candidateTier).toBe("B");
  });

  it("does not collapse bucket hints to other", () => {
    const candidate = scorePlaceCandidate(normalizeWikidataPlaceCandidate(rawFromBucket("public_art", "Whale's Tails"), state, false));
    expect(candidate.primaryCategory).toBe("public_art");
    expect(candidate.primaryCategory).not.toBe("other");
  });

  it("does not query low-value categories in targeted buckets", () => {
    const bucketIds = listFastTargetedBucketIds();
    const bucketHints = WIKIDATA_FAST_TARGETED_BUCKETS.flatMap((bucket) => bucket.categoryHints.map((hint) => hint.toLowerCase()));
    for (const excluded of FAST_TARGETED_EXCLUDED_CATEGORY_HINTS) {
      expect(bucketHints).not.toContain(excluded);
    }
    expect(bucketIds).not.toContain("library");
    expect(bucketIds).not.toContain("memorial");
    expect(bucketIds).not.toContain("cemetery");
  });
});

describe("fast targeted orchestration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not call fast smoke or deep discovery sources", async () => {
    const smokeSpy = vi.spyOn(wikidataFastSmokeSource, "fetchWikidataFastSmokePlaceCandidates");
    const deepSpy = vi.spyOn(wikidataPlaceCandidateSource, "fetchWikidataPlaceCandidatesDeepDiscovery");
    const targetedSpy = vi.spyOn(wikidataFastTargetedSource, "fetchWikidataFastTargetedPlaceCandidates").mockResolvedValue({
      candidates: [rawFromBucket("waterfall", "Moss Glen Falls")],
      sourceTimings: [],
      bucketRuns: [
        {
          bucketId: "waterfall",
          label: "waterfall",
          priority: 1,
          fetched: 1,
          timedOut: false,
          elapsedMs: 100,
          queryElapsedMs: 100,
        },
      ],
      partial: false,
      timeout: false,
      bucketTimeoutCount: 0,
      bucketCompletedCount: 1,
      bucketSkippedCount: 0,
      limitReached: false,
    });

    const promise = generateStatePlaceCandidates({
      stateName: "Vermont",
      stateCode: "VT",
      mode: "fast_targeted",
      limit: 50,
      minScore: 0,
      dryRun: true,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(targetedSpy).toHaveBeenCalledTimes(1);
    expect(smokeSpy).not.toHaveBeenCalled();
    expect(deepSpy).not.toHaveBeenCalled();
    expect(result.sourceMode).toBe("fast_targeted");
  });

  it("continues when a bucket times out", async () => {
    vi.spyOn(wikidataFastTargetedSource, "fetchWikidataFastTargetedPlaceCandidates").mockResolvedValue({
      candidates: [rawFromBucket("beach", "North Beach")],
      sourceTimings: [],
      bucketRuns: [
        {
          bucketId: "waterfall",
          label: "waterfall",
          priority: 1,
          fetched: 0,
          timedOut: true,
          elapsedMs: 2_500,
          queryElapsedMs: 2_500,
        },
        {
          bucketId: "beach",
          label: "beach",
          priority: 3,
          fetched: 1,
          timedOut: false,
          elapsedMs: 900,
          queryElapsedMs: 900,
        },
      ],
      partial: true,
      partialReason: "SOME_BUCKETS_TIMED_OUT",
      timeout: false,
      bucketTimeoutCount: 1,
      bucketCompletedCount: 1,
      bucketSkippedCount: 0,
      limitReached: false,
    });

    const result = await generateStatePlaceCandidates({
      stateName: "Vermont",
      stateCode: "VT",
      mode: "fast_targeted",
      limit: 50,
      minScore: 0,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.partialReason).toBe("SOME_BUCKETS_TIMED_OUT");
    expect(result.totals.rawCandidates).toBe(1);
    expect(result.bucketBreakdown?.some((row) => row.bucketId === "waterfall" && row.timedOut)).toBe(true);
  });

  it("sets partialReason when limit is reached before all buckets finish", async () => {
    vi.spyOn(wikidataFastTargetedSource, "fetchWikidataFastTargetedPlaceCandidates").mockResolvedValue({
      candidates: Array.from({ length: 50 }, (_, index) => rawFromBucket("beach", `Beach ${index}`)),
      sourceTimings: [],
      bucketRuns: [],
      partial: true,
      partialReason: "LIMIT_REACHED_BEFORE_ALL_BUCKETS",
      timeout: false,
      bucketTimeoutCount: 0,
      bucketCompletedCount: 3,
      bucketSkippedCount: 4,
      limitReached: true,
    });

    const result = await generateStatePlaceCandidates({
      stateName: "Vermont",
      stateCode: "VT",
      mode: "fast_targeted",
      limit: 50,
      minScore: 0,
      dryRun: true,
    });

    expect(result.partialReason).toBe("LIMIT_REACHED_BEFORE_ALL_BUCKETS");
    expect(result.limitReached).toBe(true);
  });

  it("returns partial when total timeout is hit", async () => {
    vi.spyOn(wikidataFastTargetedSource, "fetchWikidataFastTargetedPlaceCandidates").mockResolvedValue({
      candidates: [],
      sourceTimings: [],
      bucketRuns: [],
      partial: true,
      timeout: true,
      timeoutReason: "FAST_TARGETED_TOTAL_TIMEOUT",
      bucketTimeoutCount: 0,
      bucketCompletedCount: 0,
      bucketSkippedCount: 0,
      limitReached: false,
    });

    const result = await generateStatePlaceCandidates({
      stateName: "Vermont",
      stateCode: "VT",
      mode: "fast_targeted",
      limit: 50,
      totalTimeoutMs: 10_000,
      perQueryTimeoutMs: 2_500,
      minScore: 0,
      dryRun: true,
    });

    expect(result.timeout).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.timeoutReason).toBe("FAST_TARGETED_TOTAL_TIMEOUT");
  });

  it("keeps topCandidatesForMediaPipeline eligible only", async () => {
    vi.spyOn(wikidataFastTargetedSource, "fetchWikidataFastTargetedPlaceCandidates").mockResolvedValue({
      candidates: [
        rawFromBucket("waterfall", "Moss Glen Falls"),
        rawFromBucket("museum", "Fairbanks Museum"),
        rawFromBucket("tourist_attraction", "Bennington Battle Monument"),
      ],
      sourceTimings: [],
      bucketRuns: [],
      partial: false,
      timeout: false,
      bucketTimeoutCount: 0,
      bucketCompletedCount: 1,
      bucketSkippedCount: 0,
      limitReached: false,
    });

    const result = await generateStatePlaceCandidates({
      stateName: "Vermont",
      stateCode: "VT",
      mode: "fast_targeted",
      limit: 50,
      minScore: 0,
      dryRun: true,
    });

    expect(result.topCandidatesForMediaPipeline.every((row) => row.eligibleForMediaPipeline)).toBe(true);
  });

  it("continues when media signal probing is partial", async () => {
    vi.spyOn(wikidataFastTargetedSource, "fetchWikidataFastTargetedPlaceCandidates").mockResolvedValue({
      candidates: [rawFromBucket("waterfall", "Moss Glen Falls")],
      sourceTimings: [],
      bucketRuns: [],
      partial: false,
      timeout: false,
      bucketTimeoutCount: 0,
      bucketCompletedCount: 1,
      bucketSkippedCount: 0,
      limitReached: false,
    });
    vi.spyOn(placeCandidateMediaSignals, "enrichPlaceCandidatesWithMediaSignals").mockImplementation(async (candidates) => ({
      candidates,
      summary: {
        checked: 1,
        strong: 0,
        medium: 0,
        weak: 0,
        none: 1,
        unknown: 0,
        timedOut: 1,
        elapsedMs: 4000,
        partial: true,
      },
    }));

    const result = await generateStatePlaceCandidates({
      stateName: "Vermont",
      stateCode: "VT",
      mode: "fast_targeted",
      limit: 50,
      minScore: 0,
      includeMediaSignals: true,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.partialReason).toBe("MEDIA_SIGNAL_PARTIAL");
    expect(result.mediaSignalSummary?.partial).toBe(true);
  });

  it("respects concurrency limit when scheduling buckets", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      return new Response(JSON.stringify({ results: { bindings: [] } }), {
        status: 200,
        headers: { "content-type": "application/sparql-results+json" },
      });
    }) as typeof fetch;

    try {
      const promise = wikidataFastTargetedSource.fetchWikidataFastTargetedPlaceCandidates({
        state,
        limit: 50,
        totalTimeoutMs: 10_000,
        perQueryTimeoutMs: 2_500,
        concurrency: 4,
        runStartedAt: Date.now(),
        buckets: WIKIDATA_FAST_TARGETED_BUCKETS.slice(0, 8),
      });
      await vi.advanceTimersByTimeAsync(500);
      await promise;
      expect(maxInFlight).toBeLessThanOrEqual(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
