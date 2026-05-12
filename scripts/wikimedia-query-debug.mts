/**
 * Commons query debug for a synthetic place seed (no Firestore).
 *
 * Usage:
 *   npm run wikimedia:query-debug -- --placeName "Moss Glen Falls" --stateName Vermont --stateCode VT --lat 44.018 --lng -72.850
 */
import { loadEnv } from "../src/config/env.js";
import { analyzeWikimediaCandidate } from "../src/lib/wikimediaMvp/analyzeWikimediaCandidate.js";
import { buildCommonsSearchQueryPlan } from "../src/lib/wikimediaMvp/commonsQueryPlan.js";
import {
  collectWikimediaTitlesForPlace,
  hydrateWikimediaAssets,
  type WikimediaFetchBudget,
} from "../src/lib/wikimediaMvp/fetchWikimediaCandidates.js";
import type { WikimediaMvpSeedPlace } from "../src/lib/wikimediaMvp/WikimediaMvpTypes.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function main() {
  loadEnv();
  const a = parseArgs(process.argv.slice(2));
  const seed: WikimediaMvpSeedPlace = {
    placeName: a.placeName || "Moss Glen Falls",
    searchQuery: [a.placeName, a.stateName, a.stateCode].filter(Boolean).join(", "),
    stateName: a.stateName || "Vermont",
    stateCode: a.stateCode || "VT",
    latitude: a.lat ? Number(a.lat) : 44.0181183,
    longitude: a.lng ? Number(a.lng) : -72.8503892,
    placeCategoryKeywords: ["waterfall"],
  };
  const maxPages = Number(a.maxSearchPages || 5);
  const maxTitles = Number(a.maxResultsPerQuery || 120);
  const strategy = (a.queryStrategy as "exact_only" | "all_variants" | "category_first") || "all_variants";

  const plan = buildCommonsSearchQueryPlan(seed);
  const budget: WikimediaFetchBudget = { wikimediaRequests: 0 };
  const { discovered, perQueryStats, queryPlan } = await collectWikimediaTitlesForPlace({
    place: seed,
    maxTitles,
    maxSearchPages: maxPages,
    primaryQueryOnly: strategy === "exact_only",
    strategy: strategy === "category_first" ? "category_first" : "all_variants",
    useCache: false,
    budget,
  });

  const titles = discovered.map((d) => d.title);
  const prov = new Map(discovered.map((d) => [d.title.replace(/^File:/i, "").trim().toLowerCase(), d]));
  const assets = await hydrateWikimediaAssets({ titles, titleProvenance: prov, budget, signal: undefined });

  const keptByQuery = new Map<string, number>();
  const samples: Array<{ title: string; matchedQuery?: string; score?: number; status: string }> = [];
  for (const asset of assets.slice(0, 60)) {
    const an = analyzeWikimediaCandidate({
      place: seed,
      asset,
      duplicateReason: null,
      dryRun: true,
      allowWrites: false,
    });
    const mq = asset.matchedQuery ?? "";
    if (an.status !== "REJECT") {
      keptByQuery.set(mq, (keptByQuery.get(mq) ?? 0) + 1);
    }
    if (samples.length < 12) {
      samples.push({
        title: asset.title,
        matchedQuery: asset.matchedQuery,
        score: an.mediaPlaceMatchScore,
        status: an.status,
      });
    }
  }

  const compareQueries = [
    seed.placeName,
    `${seed.placeName} ${seed.stateName}`,
    `${seed.placeName} ${seed.stateCode}`,
    [seed.placeName, seed.stateName, seed.stateCode].filter(Boolean).join(", "),
  ];

  const sideBySide = compareQueries.map((q) => {
    const stat = perQueryStats.find((p) => p.query === q);
    return {
      query: q,
      resultCount: stat?.hits ?? 0,
      keptCount: keptByQuery.get(q) ?? 0,
      firstTitles: discovered.filter((d) => d.matchedQuery === q).map((d) => d.title).slice(0, 10),
    };
  });

  console.log(
    JSON.stringify(
      {
        plan,
        queryPlanFromCollect: queryPlan,
        perQueryStats,
        wikimediaRequests: budget.wikimediaRequests,
        samples,
        sideBySide,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
