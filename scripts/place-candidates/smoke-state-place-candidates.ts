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
const mode = readArg("mode", "fast_smoke") as "fast_smoke" | "deep_discovery";
const limit = Number(readArg("limit", "25"));
const totalTimeoutMs = Number(readArg("totalTimeoutMs", "8000"));
const perQueryTimeoutMs = Number(readArg("perQueryTimeoutMs", "5000"));
const minScore = Number(readArg("minScore", "0"));

loadEnv();

const started = Date.now();
const result = await generateStatePlaceCandidates({
  stateName,
  stateCode,
  mode,
  limit,
  totalTimeoutMs,
  perQueryTimeoutMs,
  minScore,
  sources: ["wikidata"],
  dryRun: true,
});

const categoryBreakdown = result.candidates.reduce<Record<string, number>>((acc, candidate) => {
  const key = candidate.primaryCategory || "other";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const topCandidates = result.candidates.slice(0, 25).map((candidate) => ({
  name: candidate.name,
  locavaScore: candidate.locavaScore,
  primaryCategory: candidate.primaryCategory,
  lat: candidate.lat,
  lng: candidate.lng,
  wikidata: candidate.sourceIds.wikidata,
}));

console.log(
  JSON.stringify(
    {
      stateName: result.stateName,
      stateCode: result.stateCode,
      mode: result.mode,
      elapsedMs: result.elapsedMs,
      timeout: result.timeout,
      partial: result.partial,
      timeoutReason: result.timeoutReason,
      totals: result.totals,
      rawCandidateCount: result.totals.rawCandidates,
      normalizedCandidateCount: result.totals.normalizedCandidates,
      returnedCandidateCount: result.totals.returnedCandidates,
      topCandidates,
      categoryBreakdown,
      mediaFetched: 0,
      firestoreWrites: 0,
      postsCreated: 0,
      harnessElapsedMs: Date.now() - started,
    },
    null,
    2,
  ),
);
