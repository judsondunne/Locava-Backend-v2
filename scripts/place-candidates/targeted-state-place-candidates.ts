import { loadEnv } from "../../src/config/env.js";
import { generateStatePlaceCandidates } from "../../src/lib/place-candidates/generateStatePlaceCandidates.js";

const args = process.argv.slice(2);

function readArg(name: string, fallback?: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  if (direct) return direct;
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1]!.startsWith("--")) {
    return args[index + 1];
  }
  return fallback;
}

const stateName = readArg("stateName", "Vermont")!;
const stateCode = readArg("stateCode", "VT");
const limit = Number(readArg("limit", "50"));
const totalTimeoutMs = Number(readArg("totalTimeoutMs", "10000"));
const perQueryTimeoutMs = Number(readArg("perQueryTimeoutMs", "2500"));
const minScore = Number(readArg("minScore", "20"));
const includeMediaSignals = readArg("includeMediaSignals", "true") !== "false";

loadEnv();

const started = Date.now();
const result = await generateStatePlaceCandidates({
  stateName,
  stateCode,
  mode: "fast_targeted",
  limit,
  totalTimeoutMs,
  perQueryTimeoutMs,
  minScore,
  includeMediaSignals,
  sources: ["wikidata"],
  dryRun: true,
});

const summarize = (candidate: NonNullable<typeof result.eligibleCandidates>[number]) => ({
  name: candidate.name,
  priorityQueue: candidate.priorityQueue,
  recommendedAction: candidate.recommendedAction,
  eligibleForMediaPipeline: candidate.eligibleForMediaPipeline,
  locavaScore: candidate.locavaScore,
  locavaPriorityScore: candidate.locavaPriorityScore,
  mediaAvailability: candidate.mediaSignals?.mediaAvailability,
  primaryCategory: candidate.primaryCategory,
  lat: candidate.lat,
  lng: candidate.lng,
  wikidata: candidate.sourceIds.wikidata,
});

console.log(
  JSON.stringify(
    {
      stateName: result.stateName,
      stateCode: result.stateCode,
      mode: result.mode,
      sourceMode: result.sourceMode,
      elapsedMs: result.elapsedMs,
      timeout: result.timeout,
      partial: result.partial,
      partialReason: result.partialReason,
      timeoutReason: result.timeoutReason,
      bucketTimeoutCount: result.bucketTimeoutCount,
      bucketCompletedCount: result.bucketCompletedCount,
      bucketSkippedCount: result.bucketSkippedCount,
      limitReached: result.limitReached,
      totals: result.totals,
      totalsByTier: result.totalsByTier,
      eligibleCandidates: result.eligibleCandidates?.length ?? 0,
      blockedCandidates: result.blockedCandidates?.length ?? 0,
      topPriorityCandidates: (result.topPriorityCandidates ?? []).map(summarize),
      p2Candidates: (result.backlogCandidates ?? []).filter((candidate) => candidate.priorityQueue === "P2").map(summarize),
      p3BacklogCandidates: (result.backlogCandidates ?? []).filter((candidate) => candidate.priorityQueue === "P3").map(summarize),
      blockedExamples: (result.blockedCandidates ?? []).slice(0, 10).map((candidate) => ({
        name: candidate.name,
        blockReasons: candidate.blockReasons,
        recommendedAction: candidate.recommendedAction,
      })),
      lakeChamplainEligible: (result.eligibleCandidates ?? []).some((candidate) => /lake champlain/i.test(candidate.name)),
      mountIndependenceEligible: (result.eligibleCandidates ?? []).some((candidate) => /mount independence/i.test(candidate.name)),
      mediaSignalSummary: result.mediaSignalSummary,
      bucketBreakdown: result.bucketBreakdown,
      warnings: result.warnings,
      mediaFetched: 0,
      firestoreWrites: 0,
      postsCreated: 0,
      harnessElapsedMs: Date.now() - started,
    },
    null,
    2,
  ),
);
