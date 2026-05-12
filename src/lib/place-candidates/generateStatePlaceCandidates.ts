import { applyTargetedPlaceCandidateQuality } from "./applyTargetedPlaceCandidateQuality.js";
import { aggregateFastTargetedBucketBreakdown } from "./aggregateFastTargetedBucketBreakdown.js";
import { totalsByPrimaryCategory, totalsByTier } from "./aggregatePlaceCandidateTotals.js";
import { dedupeReasonStrings } from "./dedupeReasonStrings.js";
import { enrichPlaceCandidatesWithMediaSignals } from "./placeCandidateMediaSignals.js";
import { evaluatePlaceCandidateRouting } from "./placeCandidatePriorityQueue.js";
import { createPlaceCandidateRunId, placeCandidateEvent } from "./placeCandidateRunEvents.js";
import { dedupePlaceCandidates } from "./dedupePlaceCandidates.js";
import { normalizeWikidataPlaceCandidate } from "./normalizePlaceCandidate.js";
import { resolvePlaceCandidateModeConfig } from "./placeCandidateModeConfig.js";
import { scorePlaceCandidate } from "./scorePlaceCandidate.js";
import { sortPlaceCandidates, sortPlaceCandidatesByScore } from "./sortPlaceCandidates.js";
import { resolveUsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import type {
  GenerateStatePlaceCandidatesRequest,
  GenerateStatePlaceCandidatesResponse,
  PlaceCandidate,
  PlaceCandidateBucketBreakdown,
  PlaceCandidatePartialReason,
  PlaceCandidateRejected,
  PlaceCandidateRunEvent,
  PlaceCandidateSourceTiming,
} from "./types.js";
import { fetchWikidataPlaceCandidatesDeepDiscovery } from "./wikidataPlaceCandidateSource.js";
import { fetchWikidataFastSmokePlaceCandidates } from "./wikidataFastSmokeSource.js";
import { fetchWikidataFastTargetedPlaceCandidates } from "./wikidataFastTargetedSource.js";
import type { FastTargetedBucketRunResult } from "./wikidataFastTargetedSource.js";

const PREFIX = "[PLACE_CANDIDATE_DEV]";

function log(message: string, extra?: Record<string, unknown>): void {
  if (extra && Object.keys(extra).length > 0) {
    console.info(`${PREFIX} ${message}`, extra);
    return;
  }
  console.info(`${PREFIX} ${message}`);
}

export async function generateStatePlaceCandidates(
  request: GenerateStatePlaceCandidatesRequest,
  hooks?: {
    runId?: string;
    onEvent?: (event: Omit<PlaceCandidateRunEvent, "runId" | "dryRun">) => void;
  },
): Promise<GenerateStatePlaceCandidatesResponse> {
  const runStartedAt = Date.now();
  const runId = hooks?.runId ?? createPlaceCandidateRunId();
  const dryRun = request.dryRun !== false;
  const modeConfig = resolvePlaceCandidateModeConfig(request);
  const { mode, limit, totalTimeoutMs, perQueryTimeoutMs, concurrency } = modeConfig;
  const defaultMinScore = mode === "fast_smoke" ? 0 : mode === "fast_targeted" ? 20 : 25;
  const minScore = Math.max(0, Math.min(request.minScore ?? defaultMinScore, 100));
  const includeRaw = request.includeRaw === true;
  const includeMediaSignals = mode === "fast_targeted" ? request.includeMediaSignals !== false : request.includeMediaSignals === true;
  const strictMinScore = request.strictMinScore === true;
  const sources = (request.sources?.length ? request.sources : ["wikidata"]).map((s) => s.toLowerCase());
  const events: PlaceCandidateRunEvent[] = [];
  const rejected: PlaceCandidateRejected[] = [];
  let partial = false;
  let timeout = false;
  let timeoutReason: string | undefined;
  let partialReason: PlaceCandidatePartialReason | undefined;
  let bucketTimeoutCount = 0;
  let bucketCompletedCount = 0;
  let bucketSkippedCount = 0;
  let limitReached = false;

  const pushEvent = (event: Omit<PlaceCandidateRunEvent, "runId" | "dryRun">) => {
    const normalizedEvent = {
      ...event,
      elapsedMs: event.elapsedMs ?? Date.now() - runStartedAt,
      totalTimeoutMs: event.totalTimeoutMs ?? totalTimeoutMs,
      perQueryTimeoutMs: event.perQueryTimeoutMs ?? perQueryTimeoutMs,
    };
    hooks?.onEvent?.(normalizedEvent);
    const row = placeCandidateEvent({ ...normalizedEvent, runId, dryRun });
    events.push(row);
    log(row.type, {
      runId,
      stateName: row.stateName,
      stateCode: row.stateCode,
      source: row.source,
      counts: row.counts,
      elapsedMs: row.elapsedMs,
      queryElapsedMs: row.queryElapsedMs,
      totalTimeoutMs: row.totalTimeoutMs,
      perQueryTimeoutMs: row.perQueryTimeoutMs,
      partial: row.partial,
      timeout: row.timeout,
      timeoutReason: row.timeoutReason,
      limit: row.limit,
      minScore: row.minScore,
    });
  };

  let state;
  try {
    state = resolveUsStatePlaceConfig({ stateName: request.stateName, stateCode: request.stateCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushEvent({
      type: "PLACE_CANDIDATE_RUN_FAILED",
      stateName: request.stateName,
      stateCode: request.stateCode,
      message,
      limit,
      minScore,
    });
    throw error;
  }

  pushEvent({
    type: "PLACE_CANDIDATE_RUN_STARTED",
    stateName: state.stateName,
    stateCode: state.stateCode,
    limit,
    minScore,
    elapsedMs: 0,
  });

  if (mode === "fast_smoke") {
    pushEvent({
      type: "PLACE_CANDIDATE_FAST_SMOKE_STARTED",
      stateName: state.stateName,
      stateCode: state.stateCode,
      limit,
      minScore,
      elapsedMs: 0,
    });
  } else if (mode === "fast_targeted") {
    pushEvent({
      type: "PLACE_CANDIDATE_FAST_TARGETED_STARTED",
      stateName: state.stateName,
      stateCode: state.stateCode,
      limit,
      minScore,
      elapsedMs: 0,
    });
  } else {
    pushEvent({
      type: "PLACE_CANDIDATE_DEEP_DISCOVERY_STARTED",
      stateName: state.stateName,
      stateCode: state.stateCode,
      limit,
      minScore,
      elapsedMs: 0,
    });
  }

  let rawCandidates = 0;
  const normalized: PlaceCandidate[] = [];
  const sourceTimings: PlaceCandidateSourceTiming[] = [];
  let targetedBucketRuns: FastTargetedBucketRunResult[] = [];

  for (const source of sources) {
    if (source !== "wikidata") {
      rejected.push({ source, reason: "unsupported_source_for_mvp", name: source });
      continue;
    }
    pushEvent({
      type: "PLACE_CANDIDATE_SOURCE_STARTED",
      stateName: state.stateName,
      stateCode: state.stateCode,
      source,
      limit,
      minScore,
    });

    const onQuery = (query: {
      event: "started" | "done" | "timeout";
      mode: string;
      typeQid?: string;
      typeLabel?: string;
      elapsedMs: number;
      queryElapsedMs?: number;
      totalTimeoutMs: number;
      perQueryTimeoutMs: number;
      fetched?: number;
    }) => {
      const type =
        query.event === "started"
          ? "PLACE_CANDIDATE_WIKIDATA_QUERY_STARTED"
          : query.event === "timeout"
            ? "PLACE_CANDIDATE_WIKIDATA_QUERY_TIMEOUT"
            : "PLACE_CANDIDATE_WIKIDATA_QUERY_DONE";
      pushEvent({
        type,
        stateName: state.stateName,
        stateCode: state.stateCode,
        source,
        message: `wikidata ${query.mode}${query.typeLabel ? ` type=${query.typeLabel}` : ""}${query.typeQid ? ` ${query.typeQid}` : ""} fetched=${query.fetched ?? 0}`,
        counts: {
          mode: query.mode,
          typeQid: query.typeQid ?? "",
          typeLabel: query.typeLabel ?? "",
          fetched: query.fetched ?? 0,
        },
        limit,
        minScore,
        elapsedMs: query.elapsedMs,
        queryElapsedMs: query.queryElapsedMs,
        totalTimeoutMs: query.totalTimeoutMs,
        perQueryTimeoutMs: query.perQueryTimeoutMs,
      });
    };

    let raw: Awaited<ReturnType<typeof fetchWikidataFastSmokePlaceCandidates>>["candidates"] = [];
    try {
      if (mode === "fast_smoke") {
        const fetched = await fetchWikidataFastSmokePlaceCandidates({
          state,
          limit,
          totalTimeoutMs,
          perQueryTimeoutMs,
          runStartedAt,
          onQuery,
        });
        raw = fetched.candidates;
        sourceTimings.push(...fetched.sourceTimings);
        partial = partial || fetched.partial;
        timeout = timeout || fetched.timeout;
        timeoutReason = timeoutReason ?? fetched.timeoutReason;
        if (fetched.timeout) {
          pushEvent({
            type: "PLACE_CANDIDATE_FAST_SMOKE_TIMEOUT",
            stateName: state.stateName,
            stateCode: state.stateCode,
            source,
            message: fetched.timeoutReason ?? "FAST_SMOKE_TOTAL_TIMEOUT",
            partial: true,
            timeout: true,
            timeoutReason: fetched.timeoutReason ?? "FAST_SMOKE_TOTAL_TIMEOUT",
            limit,
            minScore,
          });
        }
        if (fetched.partial) {
          pushEvent({
            type: "PLACE_CANDIDATE_FAST_SMOKE_PARTIAL_RETURNED",
            stateName: state.stateName,
            stateCode: state.stateCode,
            source,
            counts: { raw: raw.length },
            partial: true,
            timeout: fetched.timeout,
            timeoutReason: fetched.timeoutReason,
            limit,
            minScore,
          });
        }
      } else if (mode === "fast_targeted") {
        const fetched = await fetchWikidataFastTargetedPlaceCandidates({
          state,
          limit,
          totalTimeoutMs,
          perQueryTimeoutMs,
          concurrency,
          runStartedAt,
          onBucket: (bucketEvent) => {
            const isFallback = bucketEvent.bucketLabel.includes(":fallback");
            const type = isFallback
              ? bucketEvent.event === "timeout"
                ? "PLACE_CANDIDATE_BUCKET_FALLBACK_TIMEOUT"
                : bucketEvent.event === "started"
                  ? "PLACE_CANDIDATE_BUCKET_FALLBACK_STARTED"
                  : "PLACE_CANDIDATE_BUCKET_FALLBACK_DONE"
              : bucketEvent.event === "started"
                ? "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_STARTED"
                : bucketEvent.event === "timeout"
                  ? "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_TIMEOUT"
                  : "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_DONE";
            pushEvent({
              type,
              stateName: state.stateName,
              stateCode: state.stateCode,
              source,
              message: `${bucketEvent.bucketLabel} +${bucketEvent.fetched} in ${bucketEvent.queryElapsedMs}ms`,
              counts: {
                bucketId: bucketEvent.bucketId,
                bucketLabel: bucketEvent.bucketLabel,
                bucketPriority: bucketEvent.bucketPriority,
                fetched: bucketEvent.fetched,
                totalSoFar: bucketEvent.totalSoFar,
              },
              limit,
              minScore,
              elapsedMs: bucketEvent.elapsedMs,
              queryElapsedMs: bucketEvent.queryElapsedMs,
              totalTimeoutMs: bucketEvent.totalTimeoutMs,
              perQueryTimeoutMs: bucketEvent.perQueryTimeoutMs,
              partial: bucketEvent.partial,
              timeout: bucketEvent.timeout,
            });
          },
        });
        raw = fetched.candidates;
        sourceTimings.push(...fetched.sourceTimings);
        targetedBucketRuns = fetched.bucketRuns;
        partial = partial || fetched.partial;
        timeout = timeout || fetched.timeout;
        timeoutReason = timeoutReason ?? fetched.timeoutReason;
        partialReason = fetched.partialReason as PlaceCandidatePartialReason | undefined;
        bucketTimeoutCount = fetched.bucketTimeoutCount;
        bucketCompletedCount = fetched.bucketCompletedCount;
        bucketSkippedCount = fetched.bucketSkippedCount;
        limitReached = fetched.limitReached;
        if (fetched.partial) {
          pushEvent({
            type: "PLACE_CANDIDATE_FAST_TARGETED_PARTIAL_RETURNED",
            stateName: state.stateName,
            stateCode: state.stateCode,
            source,
            counts: { raw: raw.length },
            partial: true,
            timeout: fetched.timeout,
            timeoutReason: fetched.timeoutReason,
            limit,
            minScore,
          });
        }
      } else {
        const fetched = await fetchWikidataPlaceCandidatesDeepDiscovery({
          state,
          limit,
          totalTimeoutMs,
          perQueryTimeoutMs,
          runStartedAt,
          onProgress: (progress) => {
            pushEvent({
              type: "PLACE_CANDIDATE_SOURCE_PROGRESS",
              stateName: state.stateName,
              stateCode: state.stateCode,
              source,
              message: `wikidata type=${progress.typeLabel} ${progress.typeQid} +${progress.fetchedThisType} total=${progress.totalSoFar} (${progress.typeIndex}/${progress.typeCount})`,
              counts: {
                typeQid: progress.typeQid,
                typeLabel: progress.typeLabel,
                fetchedThisType: progress.fetchedThisType,
                totalSoFar: progress.totalSoFar,
                typeIndex: progress.typeIndex,
                typeCount: progress.typeCount,
              },
              limit,
              minScore,
              elapsedMs: progress.elapsedMs,
            });
          },
          onQuery,
        });
        raw = fetched.candidates;
        sourceTimings.push(...fetched.sourceTimings);
        partial = partial || fetched.partial;
        timeout = timeout || fetched.timeout;
        timeoutReason = timeoutReason ?? fetched.timeoutReason;
        if (fetched.timeout) {
          pushEvent({
            type: "PLACE_CANDIDATE_DEEP_DISCOVERY_TIMEOUT",
            stateName: state.stateName,
            stateCode: state.stateCode,
            source,
            message: fetched.timeoutReason ?? "DEEP_DISCOVERY_TOTAL_TIMEOUT",
            partial: true,
            timeout: true,
            timeoutReason: fetched.timeoutReason ?? "DEEP_DISCOVERY_TOTAL_TIMEOUT",
            limit,
            minScore,
          });
        }
        if (fetched.partial) {
          pushEvent({
            type: "PLACE_CANDIDATE_DEEP_DISCOVERY_PARTIAL_RETURNED",
            stateName: state.stateName,
            stateCode: state.stateCode,
            source,
            counts: { raw: raw.length },
            partial: true,
            timeout: fetched.timeout,
            timeoutReason: fetched.timeoutReason,
            limit,
            minScore,
          });
        }
        if (fetched.sourceTimings.some((row) => row.timedOut)) {
          pushEvent({
            type: "PLACE_CANDIDATE_WIKIDATA_PARTIAL_SOURCE_DONE",
            stateName: state.stateName,
            stateCode: state.stateCode,
            source,
            message: "wikidata partial source coverage after timeout",
            counts: { raw: raw.length },
            partial: true,
            limit,
            minScore,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushEvent({
        type: "PLACE_CANDIDATE_RUN_FAILED",
        stateName: state.stateName,
        stateCode: state.stateCode,
        source,
        message,
        limit,
        minScore,
      });
      throw error;
    }

    rawCandidates += raw.length;
    for (const row of raw) {
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
        rejected.push({ source, reason: "missing_coordinates", name: row.name, debug: row.qid });
        continue;
      }
      const candidate = normalizeWikidataPlaceCandidate(row, state, includeRaw);
      normalized.push(scorePlaceCandidate(candidate));
    }
    pushEvent({
      type: "PLACE_CANDIDATE_SOURCE_DONE",
      stateName: state.stateName,
      stateCode: state.stateCode,
      source,
      counts: { raw: raw.length, normalized: normalized.length },
      limit,
      minScore,
    });
  }

  if (mode === "fast_smoke") {
    pushEvent({
      type: "PLACE_CANDIDATE_FAST_SMOKE_DONE",
      stateName: state.stateName,
      stateCode: state.stateCode,
      counts: { rawCandidates },
      partial,
      timeout,
      timeoutReason,
      limit,
      minScore,
    });
  } else if (mode === "fast_targeted") {
    pushEvent({
      type: "PLACE_CANDIDATE_FAST_TARGETED_DONE",
      stateName: state.stateName,
      stateCode: state.stateCode,
      counts: { rawCandidates },
      partial,
      timeout,
      timeoutReason,
      limit,
      minScore,
    });
  }

  pushEvent({
    type: "PLACE_CANDIDATES_NORMALIZED",
    stateName: state.stateName,
    stateCode: state.stateCode,
    counts: { normalized: normalized.length },
    limit,
    minScore,
  });

  const deduped = dedupePlaceCandidates(normalized);
  pushEvent({
    type: "PLACE_CANDIDATES_DEDUPED",
    stateName: state.stateName,
    stateCode: state.stateCode,
    counts: { deduped: deduped.length },
    limit,
    minScore,
  });

  let scored = deduped.map((candidate) => scorePlaceCandidate(candidate));
  let mediaSignalSummary: GenerateStatePlaceCandidatesResponse["mediaSignalSummary"];
  if (mode === "fast_targeted") {
    scored = scored.map((candidate) => applyTargetedPlaceCandidateQuality(candidate));
    if (includeMediaSignals) {
      const media = await enrichPlaceCandidatesWithMediaSignals(scored, { enabled: true });
      mediaSignalSummary = media.summary;
      scored = media.candidates.map((candidate) => {
        const routing = evaluatePlaceCandidateRouting(candidate);
        return {
          ...candidate,
          locavaPriorityScore: routing.locavaPriorityScore,
          eligibleForMediaPipeline: routing.eligibleForMediaPipeline,
          blocked: routing.blocked,
          blockReasons: routing.blockReasons,
          priorityQueue: routing.priorityQueue,
          priorityReasons: routing.priorityReasons,
          recommendedAction: routing.recommendedAction,
          pipelineReady: routing.pipelineReady,
          pipelineReadyReasons: routing.pipelineReadyReasons,
          pipelineBlockReasons: routing.pipelineBlockReasons,
          debug: {
            ...candidate.debug,
            scoreReasons: dedupeReasonStrings([...candidate.debug.scoreReasons, ...routing.priorityReasons]),
          },
        };
      });
      if (media.summary.partial) {
        partial = true;
        partialReason = partialReason ?? "MEDIA_SIGNAL_PARTIAL";
      }
    }
  }
  pushEvent({
    type: "PLACE_CANDIDATES_SCORED",
    stateName: state.stateName,
    stateCode: state.stateCode,
    counts: { scored: scored.length },
    limit,
    minScore,
  });

  const filtered = scored.filter((candidate) => {
    if (candidate.candidateTier === "REJECTED") {
      rejected.push({
        source: candidate.rawSources[0] || "unknown",
        reason: candidate.debug.tierReasons[0] || "rejected_tier",
        name: candidate.name,
        debug: {
          locavaScore: candidate.locavaScore,
          tier: candidate.candidateTier,
          tierReasons: candidate.debug.tierReasons,
        },
      });
      return false;
    }
    if (strictMinScore && candidate.locavaScore < minScore) {
      rejected.push({
        source: candidate.rawSources[0] || "unknown",
        reason: "below_min_score",
        name: candidate.name,
        debug: { locavaScore: candidate.locavaScore, minScore, tier: candidate.candidateTier },
      });
      return false;
    }
    return true;
  });

  const candidates = sortPlaceCandidates(filtered).slice(0, limit);
  const eligibleCandidates =
    mode === "fast_targeted"
      ? sortPlaceCandidates(candidates.filter((candidate) => candidate.eligibleForMediaPipeline))
      : sortPlaceCandidatesByScore(
          candidates.filter((candidate) => candidate.candidateTier === "A" || candidate.candidateTier === "B"),
        );
  const blockedCandidates =
    mode === "fast_targeted" ? sortPlaceCandidates(candidates.filter((candidate) => candidate.blocked)) : [];
  const topPriorityCandidates =
    mode === "fast_targeted"
      ? eligibleCandidates.filter((candidate) => candidate.priorityQueue === "P0" || candidate.priorityQueue === "P1")
      : eligibleCandidates;
  const backlogCandidates =
    mode === "fast_targeted"
      ? eligibleCandidates.filter((candidate) => candidate.priorityQueue === "P2" || candidate.priorityQueue === "P3")
      : [];
  const topCandidatesForMediaPipeline = eligibleCandidates;
  const needsReviewCandidates =
    mode === "fast_targeted"
      ? backlogCandidates
      : candidates.filter((candidate) => !candidate.pipelineReady && candidate.candidateTier !== "REJECTED");
  const priorityTotals = {
    p0: candidates.filter((candidate) => candidate.priorityQueue === "P0").length,
    p1: candidates.filter((candidate) => candidate.priorityQueue === "P1").length,
    p2: candidates.filter((candidate) => candidate.priorityQueue === "P2").length,
    p3: candidates.filter((candidate) => candidate.priorityQueue === "P3").length,
  };
  const tierTotals = totalsByTier(candidates);
  const categoryTotals = totalsByPrimaryCategory(candidates);
  const bucketBreakdown: PlaceCandidateBucketBreakdown[] | undefined =
    mode === "fast_targeted" ? aggregateFastTargetedBucketBreakdown(targetedBucketRuns, candidates) : undefined;
  const warnings: string[] = [];
  if (mode === "fast_smoke") {
    warnings.push(
      "Fast smoke mode is for quickly listing places only. It does not fetch media or exhaustively discover every place.",
    );
  }
  if (mode === "fast_targeted" && eligibleCandidates.length === 0) {
    warnings.push("Targeted discovery returned no eligible candidates. Query/category mapping likely needs adjustment.");
  }
  if (timeout) {
    warnings.push(`Run timed out${timeoutReason ? ` (${timeoutReason})` : ""}; results may be partial.`);
  }
  if (partial && partialReason === "LIMIT_REACHED_BEFORE_ALL_BUCKETS") {
    warnings.push("Partial because enough candidates were found before all buckets completed.");
  } else if (partial && partialReason === "SOME_BUCKETS_TIMED_OUT") {
    warnings.push("Some buckets timed out, but run completed with enough candidates.");
  } else if (partial) {
    warnings.push("Partial candidate list returned before discovery completed.");
  }
  if (mode === "fast_targeted" && tierTotals.A === candidates.length && candidates.length > 0) {
    warnings.push("All returned candidates are Tier A; tiering may be too generous.");
  }
  if (mode === "fast_targeted" && blockedCandidates.some((row) => (row.blockReasons ?? []).includes("actual_type_cemetery"))) {
    warnings.push("Cemetery-like candidates were blocked from the eligible pipeline list.");
  }
  if (
    mode === "fast_targeted" &&
    eligibleCandidates.some((candidate) =>
      (candidate.blockReasons ?? []).includes("actual_type_cemetery") ||
      (candidate.debug.actualLabelNegativeSignals ?? []).includes("cemetery"),
    )
  ) {
    warnings.push("Cemetery-like candidate appears in the eligible pipeline list.");
  }
  if (mode === "fast_targeted" && topPriorityCandidates.length > 0) {
    const topSlice = topPriorityCandidates.slice(0, 20);
    const genericNature = topSlice.filter((candidate) =>
      /\b(hill|pond|river|brook|creek|stream)\b/i.test(candidate.name),
    ).length;
    if (genericNature >= 10) {
      warnings.push("Generic hills, ponds, or rivers dominate the top pipeline-ready candidates.");
    }
  }
  if (mode === "fast_targeted" && (mediaSignalSummary?.checked ?? 0) === 0 && includeMediaSignals) {
    warnings.push("No media signals were checked.");
  }
  if (
    mode === "fast_targeted" &&
    includeMediaSignals &&
    (mediaSignalSummary?.checked ?? 0) > 0 &&
    (mediaSignalSummary?.unknown ?? 0) >= Math.max(10, Math.floor((mediaSignalSummary?.checked ?? 0) * 0.6))
  ) {
    warnings.push("Many pipeline candidates still have unknown media availability.");
  }
  if (candidates.length < limit) {
    warnings.push(`Returned ${candidates.length} candidates, below requested limit ${limit}.`);
  }
  if (mode === "fast_smoke" && candidates.length === 0) {
    warnings.push("Fast smoke returned zero candidates.");
  }
  if (mode === "deep_discovery" && tierTotals.A < 10) {
    warnings.push(`Only ${tierTotals.A} A-tier candidates detected; media pipeline feed may be thin.`);
  }
  if (mode === "deep_discovery" && rejected.length === 0) {
    warnings.push("0 rejected candidates detected — quality gate may be too loose.");
  }
  const elapsedMs = Date.now() - runStartedAt;
  if (mode === "fast_smoke" && elapsedMs > 10_000) {
    warnings.push(`Fast smoke run took ${Math.round(elapsedMs / 1000)}s; expected under 10s.`);
  }
  if (mode === "fast_targeted" && elapsedMs > totalTimeoutMs + 500) {
    warnings.push(`Fast targeted run exceeded configured total timeout budget (${totalTimeoutMs}ms).`);
  }
  if (mode === "deep_discovery" && elapsedMs > 30_000) {
    warnings.push(`Run took ${Math.round(elapsedMs / 1000)}s — Wikidata source should be optimized before state-scale runs.`);
  }

  pushEvent({
    type: "PLACE_CANDIDATE_RUN_DONE",
    stateName: state.stateName,
    stateCode: state.stateCode,
    counts: {
      rawCandidates,
      normalizedCandidates: normalized.length,
      dedupedCandidates: deduped.length,
      rejectedCandidates: rejected.length,
      returnedCandidates: candidates.length,
      tierA: tierTotals.A,
      tierB: tierTotals.B,
      tierC: tierTotals.C,
    },
    partial,
    timeout,
    timeoutReason,
    limit,
    minScore,
    elapsedMs,
  });

  return {
    ok: true,
    dryRun: true,
    mode,
    sourceMode: mode,
    partial,
    timeout,
    timeoutReason,
    partialReason,
    bucketTimeoutCount: mode === "fast_targeted" ? bucketTimeoutCount : undefined,
    bucketCompletedCount: mode === "fast_targeted" ? bucketCompletedCount : undefined,
    bucketSkippedCount: mode === "fast_targeted" ? bucketSkippedCount : undefined,
    limitReached: mode === "fast_targeted" ? limitReached : undefined,
    mediaSignalSummary,
    blockedCandidates: mode === "fast_targeted" ? blockedCandidates : undefined,
    needsReviewCandidates: mode === "fast_targeted" ? needsReviewCandidates : undefined,
    eligibleCandidates: mode === "fast_targeted" ? eligibleCandidates : undefined,
    topPriorityCandidates: mode === "fast_targeted" ? topPriorityCandidates : undefined,
    backlogCandidates: mode === "fast_targeted" ? backlogCandidates : undefined,
    stateName: state.stateName,
    stateCode: state.stateCode,
    sourcesUsed: sources.filter((s) => s === "wikidata"),
    candidates,
    topCandidatesForMediaPipeline,
    rejected,
    totals: {
      rawCandidates,
      normalizedCandidates: normalized.length,
      dedupedCandidates: deduped.length,
      rejectedCandidates: rejected.length,
      returnedCandidates: candidates.length,
      eligibleCandidates: mode === "fast_targeted" ? eligibleCandidates.length : undefined,
      blockedCandidates: mode === "fast_targeted" ? blockedCandidates.length : undefined,
      p0: mode === "fast_targeted" ? priorityTotals.p0 : undefined,
      p1: mode === "fast_targeted" ? priorityTotals.p1 : undefined,
      p2: mode === "fast_targeted" ? priorityTotals.p2 : undefined,
      p3: mode === "fast_targeted" ? priorityTotals.p3 : undefined,
    },
    totalsByTier: tierTotals,
    totalsByPrimaryCategory: categoryTotals,
    bucketBreakdown,
    sourceTimings,
    warnings,
    totalTimeoutMs,
    perQueryTimeoutMs,
    elapsedMs,
    events,
  };
}
