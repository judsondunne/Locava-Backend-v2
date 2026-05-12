import type { AppEnv } from "../../config/env.js";
import type { PlaceCandidateRunEvent } from "../place-candidates/types.js";
import { generateStatePlaceCandidates } from "../place-candidates/generateStatePlaceCandidates.js";
import { assertNoPublicPublish } from "./assertNoPublicPublish.js";
import {
  processStateContentFactoryPlace,
  STATE_CONTENT_WIKIMEDIA_POST_GENERATION_ENTRYPOINT,
} from "./processStateContentFactoryPlace.js";
import { buildPostOnlyPlaceCandidate } from "./buildPostOnlyPlaceCandidate.js";
import { selectPlaceCandidates } from "./selectPlaceCandidates.js";
import {
  createStagedGeneratedPost,
  persistStateContentFactoryRun,
  stagingWritesEnabled,
  upsertPlaceCandidateRegistry,
} from "./stateContentFactoryFirestore.js";
import {
  budgetExceededReason,
  createStateContentFactoryBudget,
  externalRequestBudgetWarning,
  firestoreReadBudgetWarning,
  firestoreWriteBudgetWarning,
} from "./stateContentFactoryBudget.js";
import { appendStateContentFactoryRunEvent } from "./stateContentFactoryRunStore.js";
import { resolveWikimediaPipelineConfig } from "./resolveWikimediaPipelineConfig.js";
import type {
  StateContentFactoryDevRunState,
  StateContentFactoryEvaluatedPost,
  StateContentFactoryRunConfig,
  StateContentFactoryRunResult,
  StateContentFactoryWriteCounts,
  StateContentPlaceProcessResult,
} from "./types.js";

function emptyWriteCounts(): StateContentFactoryWriteCounts {
  return {
    stateContentRuns: 0,
    placeCandidates: 0,
    stagedGeneratedPosts: 0,
    publicPosts: 0,
  };
}

function resolveStrictMinScore(config: StateContentFactoryRunConfig): boolean {
  return config.qualityThreshold !== "loose";
}

function resolveMinScore(config: StateContentFactoryRunConfig): number {
  if (config.qualityThreshold === "strict") return 30;
  if (config.qualityThreshold === "normal") return 20;
  return 0;
}

function wikimediaEnvForPlace(env: AppEnv, config: StateContentFactoryRunConfig): AppEnv {
  return {
    ...env,
    WIKIMEDIA_MVP_PLACE_TIMEOUT_MS: config.perPlaceTimeoutMs,
  };
}

/** Human-readable line for the State Content Factory dev UI (live status banner). */
export function formatPlaceDiscoveryUiMessage(
  stateLabel: string,
  event: Omit<PlaceCandidateRunEvent, "runId" | "dryRun">,
): string {
  const bucket = event.counts?.bucketLabel ?? event.counts?.bucketId;
  switch (event.type) {
    case "PLACE_CANDIDATE_RUN_STARTED":
      return `Step 1 — Building place list for ${stateLabel} (Wikidata + buckets)…`;
    case "PLACE_CANDIDATE_FAST_TARGETED_STARTED":
    case "PLACE_CANDIDATE_FAST_SMOKE_STARTED":
    case "PLACE_CANDIDATE_DEEP_DISCOVERY_STARTED":
      return `Step 1 — Discovering outdoor place names for ${stateLabel}…`;
    case "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_STARTED":
      return `Step 1 — Finding names in category “${String(bucket ?? "bucket")}”…`;
    case "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_DONE":
      return `Step 1 — Category “${String(bucket ?? "?")}”: fetched ${String(event.counts?.fetched ?? "?")} raw places`;
    case "PLACE_CANDIDATE_FAST_TARGETED_BUCKET_TIMEOUT":
      return `Step 1 — Category “${String(bucket ?? "?")}” hit per-bucket timeout (partial results kept)`;
    case "PLACE_CANDIDATE_FAST_TARGETED_PARTIAL_RETURNED":
    case "PLACE_CANDIDATE_FAST_SMOKE_PARTIAL_RETURNED":
    case "PLACE_CANDIDATE_DEEP_DISCOVERY_PARTIAL_RETURNED":
      return `Step 1 — Partial place list for ${stateLabel} (timeout or limit)`;
    case "PLACE_CANDIDATE_DEEP_DISCOVERY_TIMEOUT":
      return `Step 1 — Deep discovery timed out for ${stateLabel} (partial list may still be used)`;
    case "PLACE_CANDIDATE_FAST_TARGETED_DONE":
    case "PLACE_CANDIDATE_FAST_SMOKE_DONE":
      return `Step 1 — Finished place-name discovery for ${stateLabel}`;
    case "PLACE_CANDIDATE_SOURCE_STARTED":
      return `Step 1 — Querying source: ${String(event.source ?? "wikidata")}…`;
    case "PLACE_CANDIDATE_SOURCE_DONE":
      return `Step 1 — Source query done: ${String(event.source ?? "")}`;
    case "PLACE_CANDIDATE_RUN_DONE":
      return `Step 1 — Scored & ranked ${stateLabel} candidates; selecting up to N places next`;
    case "PLACE_CANDIDATE_RUN_FAILED":
      return `Step 1 — Place discovery failed: ${String(event.message ?? event.timeoutReason ?? "error")}`;
    default:
      return `Step 1 — ${event.type.replace(/^PLACE_CANDIDATE_/, "").replace(/_/g, " ").toLowerCase()}`;
  }
}

export async function runStateContentFactory(input: {
  env: AppEnv;
  run: StateContentFactoryDevRunState;
}): Promise<StateContentFactoryRunResult> {
  const startedAt = Date.now();
  const config = input.run.request;
  if (config.allowPublicPublish) {
    assertNoPublicPublish();
  }
  const dryRun = config.runMode === "dry_run";
  const wikimediaResolved = resolveWikimediaPipelineConfig(config, input.env);
  const budget = createStateContentFactoryBudget({
    runMode: config.runMode,
    maxPlacesToProcess: config.maxPlacesToProcess,
  });
  const wouldWrite = emptyWriteCounts();
  const actualWrites = emptyWriteCounts();
  const counts = {
    rawCandidates: 0,
    eligibleCandidates: 0,
    blockedCandidates: 0,
    selectedPlaces: 0,
    placesProcessed: 0,
    placesFailed: 0,
    placesWithPreviews: 0,
    placesWithNoMedia: 0,
    placesWithNoPostPreviews: 0,
    postPreviewsGenerated: 0,
    postPreviewsRejected: 0,
    postPreviewsStageable: 0,
    postPreviewsNeedsReview: 0,
    wouldStageForReviewPosts: 0,
    wouldAutoApprovePosts: 0,
    wouldStagePosts: 0,
    stagedPostsCreated: 0,
    publicPostsWritten: 0,
  };
  const warnings: string[] = [];
  const evaluatedPosts: StateContentFactoryEvaluatedPost[] = [];
  const placeResults: StateContentPlaceProcessResult[] = [];
  let partial = false;
  let partialReason: string | undefined;
  let phase: StateContentFactoryRunResult["phase"] = "place_discovery";
  let placeDiscovery: unknown;

  const trackRead = () => {
    budget.firestoreReads += 1;
  };
  const trackWrite = () => {
    budget.firestoreWrites += 1;
  };
  const trackExternal = (value: number) => {
    budget.externalRequests += value;
    budget.wikidataRequests += value;
  };

  input.run.phase = phase;
  appendStateContentFactoryRunEvent(input.run, {
    type: "STATE_CONTENT_RUN_STARTED",
    phase,
    stateName: config.stateName,
    stateCode: config.stateCode,
    counts: { runMode: config.runMode, qualityPreviewMode: config.qualityPreviewMode },
  });

  appendStateContentFactoryRunEvent(input.run, {
    type: "STATE_CONTENT_PLACE_DISCOVERY_STARTED",
    phase,
    stateName: config.stateName,
    stateCode: config.stateCode,
    message: `Starting ${[config.stateName, config.stateCode].filter(Boolean).join(", ")} — Step 1 will discover place names; Step 2 will search Wikimedia (mode=${wikimediaResolved.mode}${
      wikimediaResolved.fetchAll ? ", fetch all" : ""
    } per place).`,
  });

  let selectedCandidates: StateContentFactoryEvaluatedPost["placeCandidate"][] = [];
  let discovery: Awaited<ReturnType<typeof generateStatePlaceCandidates>> | null = null;
  if (config.runKind === "post_only") {
    const placeLabel = String(config.postOnlyPlace ?? "").trim();
    if (!placeLabel) {
      throw new Error("post_only_place_required");
    }
    selectedCandidates = [buildPostOnlyPlaceCandidate(config)];
    counts.selectedPlaces = 1;
    appendStateContentFactoryRunEvent(input.run, {
      type: "STATE_CONTENT_CANDIDATES_SELECTED",
      phase: "candidate_selection",
      stateName: config.stateName,
      stateCode: config.stateCode,
      counts: { selectedPlaces: 1 },
      message: `Step 2 — Single place test: “${placeLabel}”. Wikimedia mode: ${wikimediaResolved.mode}.`,
    });
  } else {
    discovery = await generateStatePlaceCandidates(
      {
        stateName: config.stateName,
        stateCode: config.stateCode,
        mode: config.placeDiscoveryMode,
        limit: config.candidateLimit,
        totalTimeoutMs: config.totalTimeoutMs,
        perQueryTimeoutMs: Math.min(config.perPlaceTimeoutMs, config.totalTimeoutMs),
        includeMediaSignals: config.includeMediaSignals,
        strictMinScore: resolveStrictMinScore(config),
        minScore: resolveMinScore(config),
        sources: ["wikidata"],
        dryRun: true,
      },
      {
        runId: input.run.runId,
        onEvent: (event) => {
          const stateLabel = [config.stateName, config.stateCode].filter(Boolean).join(", ");
          appendStateContentFactoryRunEvent(input.run, {
            type: "STATE_CONTENT_PLACE_DISCOVERY_STARTED",
            phase,
            stateName: config.stateName,
            stateCode: config.stateCode,
            message: formatPlaceDiscoveryUiMessage(stateLabel, event),
            counts: event.counts as Record<string, number | string> | undefined,
          });
        },
      },
    );
    placeDiscovery = discovery;
    counts.rawCandidates = discovery.totals?.rawCandidates ?? discovery.candidates?.length ?? 0;
    counts.eligibleCandidates = discovery.eligibleCandidates?.length ?? 0;
    counts.blockedCandidates = discovery.blockedCandidates?.length ?? 0;
    phase = "candidate_selection";
    input.run.phase = phase;
    appendStateContentFactoryRunEvent(input.run, {
      type: "STATE_CONTENT_PLACE_DISCOVERY_DONE",
      phase,
      counts: {
        rawCandidates: counts.rawCandidates,
        eligibleCandidates: counts.eligibleCandidates,
        blockedCandidates: counts.blockedCandidates,
      },
    });
    selectedCandidates = selectPlaceCandidates({
      candidates: discovery.candidates ?? [],
      priorityQueues: config.priorityQueues,
      maxPlacesToProcess: config.maxPlacesToProcess,
    });
    counts.selectedPlaces = selectedCandidates.length;
    appendStateContentFactoryRunEvent(input.run, {
      type: "STATE_CONTENT_CANDIDATES_SELECTED",
      phase,
      stateName: config.stateName,
      stateCode: config.stateCode,
      counts: { selectedPlaces: counts.selectedPlaces },
      message: `Step 2 — Selected ${counts.selectedPlaces} place(s). Wikimedia mode: ${wikimediaResolved.mode}${
        wikimediaResolved.fetchAll ? " (fetch all)" : ""
      }. Now searching Commons per place…`,
    });
  }

  if (config.runKind === "place_only") {
    phase = "complete";
    input.run.phase = phase;
    const result: StateContentFactoryRunResult = {
      ok: true,
      dryRun: config.runMode === "dry_run",
      runId: input.run.runId,
      runMode: config.runMode,
      partial: discovery?.partial === true,
      partialReason: discovery?.partialReason,
      phase: "complete",
      stateName: config.stateName,
      stateCode: config.stateCode,
      elapsedMs: Date.now() - startedAt,
      counts,
      budget,
      wouldWrite,
      actualWrites,
      publicPostsWritten: 0,
      selectedCandidates,
      evaluatedPosts,
      placeResults,
      placeDiscovery,
      usingPostGenerationEntrypoint: STATE_CONTENT_WIKIMEDIA_POST_GENERATION_ENTRYPOINT,
      wikimediaFetchAllExhaustive: wikimediaResolved.fetchAll,
      wikimediaMode: wikimediaResolved.mode,
      qualityPreviewMode: config.qualityPreviewMode,
      warnings,
    };
    appendStateContentFactoryRunEvent(input.run, {
      type: "STATE_CONTENT_RUN_DONE",
      phase: "complete",
      elapsedMs: result.elapsedMs,
      publicPostsWritten: 0,
      message: "place_only run finished after discovery (no Wikimedia step)",
    });
    return result;
  }

  phase = "place_processing";
  input.run.phase = phase;
  const deadline = startedAt + config.totalTimeoutMs;
  for (const candidate of selectedCandidates) {
    if (Date.now() >= deadline) {
      partial = true;
      partialReason = "TOTAL_TIMEOUT";
      break;
    }
    const exceeded = budgetExceededReason(budget, counts.placesProcessed);
    if (exceeded) {
      partial = true;
      partialReason = exceeded;
      const exceededType =
        exceeded === "READ_BUDGET_EXCEEDED"
          ? "STATE_CONTENT_READ_BUDGET_EXCEEDED"
          : exceeded === "WRITE_BUDGET_EXCEEDED"
            ? "STATE_CONTENT_WRITE_BUDGET_EXCEEDED"
            : exceeded === "EXTERNAL_REQUEST_BUDGET_EXCEEDED"
              ? "STATE_CONTENT_EXTERNAL_REQUEST_BUDGET_EXCEEDED"
              : "STATE_CONTENT_RUN_PARTIAL";
      appendStateContentFactoryRunEvent(input.run, {
        type: exceededType,
        phase,
        message: exceeded,
        source: exceeded,
      });
      break;
    }
    const readWarning = firestoreReadBudgetWarning(budget);
    if (readWarning.shouldWarn) {
      appendStateContentFactoryRunEvent(input.run, {
        type: "STATE_CONTENT_READ_BUDGET_WARNING",
        phase,
        firestoreReads: budget.firestoreReads,
        maxFirestoreReads: budget.maxFirestoreReads,
        percentUsed: readWarning.percentUsed,
        source: "firestore_reads",
      });
    }
    const writeWarning = firestoreWriteBudgetWarning(budget);
    if (writeWarning.shouldWarn) {
      appendStateContentFactoryRunEvent(input.run, {
        type: "STATE_CONTENT_WRITE_BUDGET_WARNING",
        phase,
        firestoreWrites: budget.firestoreWrites,
        maxFirestoreWrites: budget.maxFirestoreWrites,
        percentUsed: writeWarning.percentUsed,
        source: "firestore_writes",
      });
    }
    const externalWarning = externalRequestBudgetWarning(budget);
    if (externalWarning.shouldWarn) {
      appendStateContentFactoryRunEvent(input.run, {
        type: "STATE_CONTENT_EXTERNAL_REQUEST_BUDGET_WARNING",
        phase,
        externalRequests: budget.externalRequests,
        maxExternalRequests: budget.maxExternalRequests,
        percentUsed: externalWarning.percentUsed,
        source: "external_requests",
      });
    }

    input.run.currentPlaceName = candidate.name;
    try {
      const processed = await processStateContentFactoryPlace({
        env: wikimediaEnvForPlace(input.env, { ...config, perPlaceTimeoutMs: wikimediaResolved.perPlaceTimeoutMs }),
        config,
        candidate,
        onEvent: (event) => appendStateContentFactoryRunEvent(input.run, event),
      });
      trackExternal(processed.placeResult.budget.wikimediaRequests);
      placeResults.push(processed.placeProcessResult);
      evaluatedPosts.push(...processed.evaluatedPosts);
      counts.postPreviewsGenerated += processed.placeProcessResult.postPreviewsGenerated;
      counts.postPreviewsRejected += processed.placeProcessResult.postPreviewsRejected;
      counts.postPreviewsStageable += processed.placeProcessResult.stageablePostPreviews;
      counts.postPreviewsNeedsReview += processed.evaluatedPosts.filter((row) => row.qualityStatus === "needs_review").length;
      if (processed.placeProcessResult.postPreviewsGenerated > 0) {
        counts.placesWithPreviews += 1;
      } else if (processed.placeProcessResult.status === "no_media") {
        counts.placesWithNoMedia += 1;
      } else {
        counts.placesWithNoPostPreviews += 1;
      }
      let dryRunStageSkips = 0;
      for (const evaluated of processed.evaluatedPosts) {
        if (evaluated.qualityStatus === "rejected") {
          appendStateContentFactoryRunEvent(input.run, {
            type: "STATE_CONTENT_POST_PREVIEW_REJECTED",
            phase,
            placeName: candidate.name,
            counts: {
              primaryFailure: evaluated.qualityPrimaryFailure ?? "rejected",
              title: evaluated.factoryDisplay?.title ?? evaluated.generatedPost.generatedTitle,
            },
          });
          continue;
        }
        if (evaluated.qualityStatus !== "stageable") {
          continue;
        }
        if (dryRun) {
          wouldWrite.placeCandidates += 1;
          wouldWrite.stagedGeneratedPosts += 1;
          dryRunStageSkips += 1;
          continue;
        }
        if (stagingWritesEnabled(input.env, config)) {
          await upsertPlaceCandidateRegistry({
            env: input.env,
            config,
            candidate,
            runId: input.run.runId,
            onRead: trackRead,
            onWrite: trackWrite,
          });
          actualWrites.placeCandidates += 1;
          const staged = await createStagedGeneratedPost({
            env: input.env,
            config,
            runId: input.run.runId,
            evaluated,
            onRead: trackRead,
            onWrite: trackWrite,
          });
          evaluated.stagedPostId = staged.stagedPostId;
          counts.stagedPostsCreated += 1;
          processed.placeProcessResult.stagedPostsCreated += 1;
          actualWrites.stagedGeneratedPosts += 1;
          appendStateContentFactoryRunEvent(input.run, {
            type: "STATE_CONTENT_STAGED_POST_CREATED",
            phase,
            placeName: candidate.name,
            counts: { stagedPostsCreated: counts.stagedPostsCreated },
          });
        } else {
          wouldWrite.placeCandidates += 1;
          wouldWrite.stagedGeneratedPosts += 1;
        }
      }
      if (dryRunStageSkips > 0) {
        appendStateContentFactoryRunEvent(input.run, {
          type: "STATE_CONTENT_STAGE_WRITE_SKIPPED_DRY_RUN",
          phase,
          placeName: candidate.name,
          counts: { skippedPosts: dryRunStageSkips },
        });
      }
      if (processed.evaluatedPosts.length > 0) {
        appendStateContentFactoryRunEvent(input.run, {
          type: "STATE_CONTENT_PLACE_POST_PREVIEWS_SUMMARY",
          phase,
          placeName: candidate.name,
          counts: {
            postPreviews: processed.evaluatedPosts.length,
            stageable: processed.placeProcessResult.stageablePostPreviews,
            needsReview: processed.evaluatedPosts.filter((r) => r.qualityStatus === "needs_review").length,
            rejected: processed.evaluatedPosts.filter((r) => r.qualityStatus === "rejected").length,
          },
          message: processed.evaluatedPosts
            .map((ev, i) => `${i + 1}. ${ev.qualityStatus}: ${ev.factoryDisplay?.title ?? ev.generatedPost.generatedTitle}`)
            .join(" | "),
        });
      }
      counts.placesProcessed += 1;
    } catch (error) {
      counts.placesFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(message);
      placeResults.push({
        placeCandidateId: candidate.placeCandidateId,
        placeName: candidate.name,
        priorityQueue: candidate.priorityQueue,
        lat: candidate.lat,
        lng: candidate.lng,
        status: message.toLowerCase().includes("timeout") ? "timeout" : "failed",
        mediaAssetsFound: 0,
        mediaAssetsHydrated: 0,
        mediaAssetsAcceptedForPipeline: 0,
        mediaAssetsStrictKeep: 0,
        mediaAssetsKept: 0,
        mediaAssetsRejected: 0,
        mediaAssetsGroupedIntoPreviews: 0,
        groupsBuilt: 0,
        groupsRejected: 0,
        postPreviewsGenerated: 0,
        postPreviewsRejected: 0,
        stageablePostPreviews: 0,
        needsReviewPostPreviews: 0,
        wouldStageForReview: 0,
        wouldAutoApprove: 0,
        wouldStage: 0,
        stagedPostsCreated: 0,
        previews: [],
        rejectedGroups: [],
        failureReason: message,
        elapsedMs: 0,
      });
      appendStateContentFactoryRunEvent(input.run, {
        type: "STATE_CONTENT_PLACE_PROCESS_FAILED",
        phase,
        placeName: candidate.name,
        message,
      });
    }
  }

  counts.wouldStageForReviewPosts = evaluatedPosts.filter((r) => r.qualityStatus === "stageable").length;
  counts.wouldAutoApprovePosts = counts.wouldStageForReviewPosts;
  counts.wouldStagePosts = counts.wouldStageForReviewPosts;

  if (partial) {
    appendStateContentFactoryRunEvent(input.run, {
      type: "STATE_CONTENT_RUN_PARTIAL",
      phase,
      message: partialReason,
    });
  }

  phase = dryRun ? "complete" : "staging";
  input.run.phase = phase;
  if (!dryRun && stagingWritesEnabled(input.env, config)) {
    wouldWrite.stateContentRuns += 1;
    actualWrites.stateContentRuns += 1;
  } else if (!dryRun) {
    wouldWrite.stateContentRuns += 1;
  }

  const result: StateContentFactoryRunResult = {
    ok: true,
    dryRun,
    runId: input.run.runId,
    runMode: config.runMode,
    partial,
    partialReason,
    phase: "complete",
    stateName: config.stateName,
    stateCode: config.stateCode,
    elapsedMs: Date.now() - startedAt,
    counts,
    budget,
    wouldWrite,
    actualWrites,
    publicPostsWritten: 0,
    selectedCandidates,
    evaluatedPosts,
    placeResults,
    placeDiscovery,
    usingPostGenerationEntrypoint: STATE_CONTENT_WIKIMEDIA_POST_GENERATION_ENTRYPOINT,
    wikimediaFetchAllExhaustive: wikimediaResolved.fetchAll,
    wikimediaMode: wikimediaResolved.mode,
    qualityPreviewMode: config.qualityPreviewMode,
    warnings,
  };

  if (!dryRun && stagingWritesEnabled(input.env, config)) {
    await persistStateContentFactoryRun({
      env: input.env,
      config,
      result,
      onWrite: trackWrite,
    });
  }

  appendStateContentFactoryRunEvent(input.run, {
    type: "STATE_CONTENT_RUN_DONE",
    phase: "complete",
    elapsedMs: result.elapsedMs,
    publicPostsWritten: 0,
    counts: {
      placesProcessed: counts.placesProcessed,
      postPreviewsGenerated: counts.postPreviewsGenerated,
      stagedPostsCreated: counts.stagedPostsCreated,
    },
  });

  return result;
}
