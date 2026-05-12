import { loadEnv } from "../../src/config/env.js";
import { generateStatePlaceCandidates } from "../../src/lib/place-candidates/generateStatePlaceCandidates.js";

const args = process.argv.slice(2);
const stateName = args.find((arg) => !arg.startsWith("--")) || "Pennsylvania";
const stateCodeArg = args.find((arg) => arg.startsWith("--stateCode="))?.split("=")[1];
const limit = Number(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 250);
const minScore = Number(args.find((arg) => arg.startsWith("--minScore="))?.split("=")[1] || 25);

loadEnv();

const result = await generateStatePlaceCandidates({
  stateName,
  stateCode: stateCodeArg,
  limit,
  minScore,
  sources: ["wikidata"],
  dryRun: true,
});

const categoryBreakdown = result.candidates.reduce<Record<string, number>>((acc, candidate) => {
  const key = candidate.primaryCategory || "other";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const top25 = result.candidates.slice(0, 25).map((candidate) => ({
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
      totals: result.totals,
      categoryBreakdown,
      top25,
      elapsedMs: result.elapsedMs,
      dryRun: result.dryRun,
      sourcesUsed: result.sourcesUsed,
    },
    null,
    2,
  ),
);
