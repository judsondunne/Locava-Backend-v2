import { randomUUID } from "node:crypto";
import type { AppEnv } from "../../config/env.js";
import { applyWikimediaAssetHygieneToGroups } from "./analyzeAssetHygiene.js";
import { analyzeWikimediaCandidate } from "./analyzeWikimediaCandidate.js";
import { buildWikimediaDryRunPosts } from "./buildWikimediaDryRunPosts.js";
import {
  collectWikimediaTitlesForPlace,
  hydrateWikimediaAssets,
  type WikimediaFetchBudget,
} from "./fetchWikimediaCandidates.js";
import { wikimediaMvpDevLog } from "./wikimediaMvpLogger.js";
import { groupWikimediaAssetsIntoPosts, toAnalyzedCandidate } from "./groupWikimediaAssetsIntoPosts.js";
import {
  wikimediaMvpFirestoreDedupeEnabled,
  wikimediaMvpRunCapsFromEnv,
  wikimediaMvpWritesAllowed,
} from "./wikimediaMvpEnv.js";
import { wikimediaMvpCacheStatsSnapshot } from "./wikimediaMvpCache.js";
import {
  appendWikimediaMvpRunEvent,
  clearWikimediaMvpRuns,
  getWikimediaMvpRun,
  saveWikimediaMvpRun,
} from "./wikimediaMvpRunStore.js";
import type {
  WikimediaCommonsQueryStat,
  WikimediaMvpBudget,
  WikimediaMvpCollectEarlyStop,
  WikimediaMvpPlaceResult,
  WikimediaMvpPlaceSummary,
  WikimediaMvpRunCaps,
  WikimediaMvpRunState,
  WikimediaMvpSeedPlace,
} from "./WikimediaMvpTypes.js";
import type { WikimediaAssetHygieneFields } from "./WikimediaMvpHygieneTypes.js";

function normalizePlaceName(input: string): string {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parsePlaces(raw: string, maxPlaces: number): string[] {
  const tokens = String(raw || "")
    .split(/[\n,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const key = normalizePlaceName(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(token.slice(0, 120));
    if (out.length >= maxPlaces) break;
  }
  return out;
}

function emptyBudget(): WikimediaMvpBudget {
  return {
    wikimediaRequests: 0,
    firestoreReadsEstimated: 0,
    firestoreWritesAttempted: 0,
    firestoreWritesSkippedDryRun: 0,
    cacheHits: 0,
    cacheMisses: 0,
    elapsedMs: 0,
  };
}

function mergeBudget(target: WikimediaMvpBudget, part: WikimediaMvpBudget): void {
  target.wikimediaRequests += part.wikimediaRequests;
  target.firestoreReadsEstimated += part.firestoreReadsEstimated;
  target.firestoreWritesAttempted += part.firestoreWritesAttempted;
  target.firestoreWritesSkippedDryRun += part.firestoreWritesSkippedDryRun;
  target.cacheHits += part.cacheHits;
  target.cacheMisses += part.cacheMisses;
  target.elapsedMs += part.elapsedMs;
}

function buildPlaceSummary(input: {
  candidateCount: number;
  assetGroupsCount: number;
  generatedPosts: Array<{
    status: string;
    assetCount: number;
    rejectionReasons: string[];
    originalAssetCount?: number;
    rejectedDuplicateCount?: number;
    rejectedHygieneCount?: number;
    reviewAssetCount?: number;
    assetHygieneSummary?: {
      rejectedPanoramaCount: number;
      rejectedLowQualityCount: number;
      rejectedBlackAndWhiteOrFilterCount: number;
      possibleDuplicateReviewCount: number;
    };
  }>;
  budget: WikimediaMvpBudget;
}): WikimediaMvpPlaceSummary {
  const generatedPostsCount = input.generatedPosts.length;
  return {
    candidateCount: input.candidateCount,
    assetGroupsCount: input.assetGroupsCount,
    generatedPostsCount,
    keptGeneratedPostsCount: input.generatedPosts.filter((p) => p.status === "KEEP").length,
    reviewGeneratedPostsCount: input.generatedPosts.filter((p) => p.status === "REVIEW").length,
    rejectedGeneratedPostsCount: input.generatedPosts.filter((p) => p.status === "REJECT").length,
    rejectedNoLocationGroupCount: input.generatedPosts.filter((p) =>
      p.rejectionReasons.includes("group_has_no_located_assets"),
    ).length,
    multiAssetPostCount: input.generatedPosts.filter((p) => p.assetCount > 1).length,
    singleAssetPostCount: input.generatedPosts.filter((p) => p.assetCount === 1).length,
    originalAssetCount: input.generatedPosts.reduce((sum, post) => sum + (post.originalAssetCount ?? post.assetCount), 0),
    rejectedDuplicateCount: input.generatedPosts.reduce((sum, post) => sum + (post.rejectedDuplicateCount ?? 0), 0),
    rejectedHygieneCount: input.generatedPosts.reduce((sum, post) => sum + (post.rejectedHygieneCount ?? 0), 0),
    possibleDuplicateReviewCount: input.generatedPosts.reduce(
      (sum, post) => sum + (post.assetHygieneSummary?.possibleDuplicateReviewCount ?? 0),
      0,
    ),
    rejectedPanoramaCount: input.generatedPosts.reduce(
      (sum, post) => sum + (post.assetHygieneSummary?.rejectedPanoramaCount ?? 0),
      0,
    ),
    rejectedLowQualityCount: input.generatedPosts.reduce(
      (sum, post) => sum + (post.assetHygieneSummary?.rejectedLowQualityCount ?? 0),
      0,
    ),
    rejectedBlackAndWhiteOrFilterCount: input.generatedPosts.reduce(
      (sum, post) => sum + (post.assetHygieneSummary?.rejectedBlackAndWhiteOrFilterCount ?? 0),
      0,
    ),
    budget: input.budget,
  };
}

async function maybeEstimateFirestoreDedupeReads(enabled: boolean): Promise<number> {
  if (!enabled) return 0;
  return 0;
}

function commonsStatMapKey(raw: string): string {
  let s = String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (s.startsWith("category:")) s = s.slice("category:".length).trim();
  return s;
}

function primaryRejectSlug(row: import("./WikimediaMvpTypes.js").WikimediaMvpCandidateAnalysis): string {
  const h = row.hygieneReasons?.find(Boolean);
  if (h) return String(h).replace(/\s+/g, "_").slice(0, 96);
  if (row.duplicateReason) return "duplicate_asset";
  const mm = row.mediaPlaceMismatchReasons?.find(Boolean);
  if (mm) return String(mm).replace(/\s+/g, "_").slice(0, 96);
  const r = row.reasoning?.find((x) => typeof x === "string" && x.length > 0);
  if (r && String(r).toLowerCase().includes("asset_geotag_far")) return "asset_geotag_far_from_place";
  return r ? String(r).slice(0, 96) : "reject_unknown";
}

function lookupCommonsStatRow(
  map: Map<string, WikimediaCommonsQueryStat>,
  matchedQuery: string | undefined,
  fallbackQuery: string,
): WikimediaCommonsQueryStat | undefined {
  const keys = [commonsStatMapKey(matchedQuery ?? ""), commonsStatMapKey(fallbackQuery)].filter(Boolean);
  for (const k of keys) {
    const row = map.get(k);
    if (row) return row;
  }
  for (const row of map.values()) {
    if (commonsStatMapKey(row.query) === commonsStatMapKey(matchedQuery ?? "")) return row;
  }
  return undefined;
}

function buildEnrichedCommonsQueryStats(input: {
  plan: Array<{ query: string; variantType: string; rank: number }>;
  perQueryStats: Array<{
    query: string;
    variantType: string;
    sourceLabel: string;
    hits: number;
    newTitlesIngested: number;
  }>;
  candidateAnalysis: import("./WikimediaMvpTypes.js").WikimediaMvpCandidateAnalysis[];
  fallbackMatchedQuery: string;
}): WikimediaCommonsQueryStat[] {
  const map = new Map<string, WikimediaCommonsQueryStat>();
  for (const row of input.perQueryStats) {
    map.set(commonsStatMapKey(row.query), {
      query: row.query,
      variantType: row.variantType,
      sourceLabel: row.sourceLabel,
      resultCount: row.hits,
      newTitlesIngested: row.newTitlesIngested,
      hydratedCount: 0,
      keptAssetCount: 0,
      rejectedAssetCount: 0,
      topRejectionReasons: [],
    });
  }
  for (const p of input.plan) {
    const k = commonsStatMapKey(p.query);
    if (!map.has(k)) {
      map.set(k, {
        query: p.query,
        variantType: p.variantType,
        sourceLabel: "query_not_executed",
        resultCount: 0,
        newTitlesIngested: 0,
        hydratedCount: 0,
        keptAssetCount: 0,
        rejectedAssetCount: 0,
        topRejectionReasons: [],
      });
    }
  }
  const fb = input.fallbackMatchedQuery;
  if (map.size === 0) {
    const q = input.plan[0]?.query?.trim() || fb;
    map.set(commonsStatMapKey(q), {
      query: q,
      variantType: input.plan[0]?.variantType ?? "synthetic",
      sourceLabel: "stats_placeholder",
      resultCount: 0,
      newTitlesIngested: 0,
      hydratedCount: 0,
      keptAssetCount: 0,
      rejectedAssetCount: 0,
      topRejectionReasons: [],
    });
  }
  const fallbackRow = () => [...map.values()][0];
  for (const c of input.candidateAnalysis) {
    const row = lookupCommonsStatRow(map, c.matchedQuery, fb) ?? fallbackRow();
    if (!row) continue;
    row.hydratedCount = (row.hydratedCount ?? 0) + 1;
    const rej = c.status === "REJECT" || c.hygieneStatus === "REJECT";
    if (rej) {
      row.rejectedAssetCount = (row.rejectedAssetCount ?? 0) + 1;
    } else {
      row.keptAssetCount = (row.keptAssetCount ?? 0) + 1;
    }
  }
  for (const row of map.values()) {
    const reasons = new Map<string, number>();
    for (const c of input.candidateAnalysis) {
      const matchRow = lookupCommonsStatRow(map, c.matchedQuery, fb) ?? fallbackRow();
      if (matchRow !== row) continue;
      if (c.status !== "REJECT" && c.hygieneStatus !== "REJECT") continue;
      const slug = primaryRejectSlug(c);
      reasons.set(slug, (reasons.get(slug) ?? 0) + 1);
    }
    row.topRejectionReasons = [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }
  const planOrder = new Map(input.plan.map((p, i) => [commonsStatMapKey(p.query), i]));
  return [...map.values()].sort((a, b) => (planOrder.get(commonsStatMapKey(a.query)) ?? 999) - (planOrder.get(commonsStatMapKey(b.query)) ?? 999));
}

function resolveWikimediaMvpLimitPerPlace(input: {
  limitPerPlace?: number;
  fetchAll?: boolean;
  caps: WikimediaMvpRunState["caps"];
}): number {
  if (input.fetchAll) {
    return Math.min(input.caps.fetchAllMaxCandidatesPerPlace, input.caps.maxHydrateTitlesPerPlace);
  }
  const requested = input.limitPerPlace ?? input.caps.maxCandidatesPerPlace;
  return Math.min(requested, input.caps.maxCandidatesPerPlace, input.caps.maxHydrateTitlesPerPlace);
}

export function startWikimediaMvpRun(input: {
  env: AppEnv;
  placesText?: string;
  places?: string[];
  seeds?: WikimediaMvpSeedPlace[];
  limitPerPlace?: number;
  fetchAll?: boolean;
  dryRun?: boolean;
  capsOverride?: Partial<WikimediaMvpRunCaps>;
  collectEarlyStop?: WikimediaMvpCollectEarlyStop;
  silencePerCandidateWikimediaEvents?: boolean;
}): WikimediaMvpRunState {
  const caps = wikimediaMvpRunCapsFromEnv(input.env, input.capsOverride ?? {});
  const fetchAll = input.fetchAll === true;
  const places = input.places?.length
    ? input.places.slice(0, caps.maxPlacesPerRun)
    : parsePlaces(input.placesText ?? "", caps.maxPlacesPerRun);
  const run: WikimediaMvpRunState = {
    runId: randomUUID(),
    status: places.length > 0 ? "running" : "failed",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    places,
    normalizedPlaces: places.map(normalizePlaceName),
    nextPlaceIndex: 0,
    limitPerPlace: resolveWikimediaMvpLimitPerPlace({ limitPerPlace: input.limitPerPlace, fetchAll, caps }),
    fetchAll,
    caps,
    dryRun: input.dryRun !== false,
    allowWrites: wikimediaMvpWritesAllowed(input.env),
    logs: [],
    events: [],
    nextEventCursor: 0,
    placeResults: [],
    seeds: input.seeds?.slice(0, places.length),
    budget: emptyBudget(),
    error: places.length > 0 ? null : "No places provided",
    collectEarlyStop: input.collectEarlyStop,
    silencePerCandidateWikimediaEvents: input.silencePerCandidateWikimediaEvents === true,
  };
  appendWikimediaMvpRunEvent(run, {
    message: "run started",
    data: { places: places.length, limitPerPlace: run.limitPerPlace, fetchAll: run.fetchAll },
  });
  saveWikimediaMvpRun(run);
  return run;
}

export async function runWikimediaMvpPlace(input: {
  env: AppEnv;
  place: string;
  seed?: WikimediaMvpSeedPlace;
  limit?: number;
  limitPerPlace?: number;
  fetchAll?: boolean;
  dryRun?: boolean;
  capsOverride?: Partial<WikimediaMvpRunCaps>;
  collectEarlyStop?: WikimediaMvpCollectEarlyStop;
  silencePerCandidateWikimediaEvents?: boolean;
}): Promise<{ runId: string; placeResult: WikimediaMvpPlaceResult; summary: WikimediaMvpPlaceSummary }> {
  const placeLabel = input.seed?.placeName?.trim() || input.seed?.searchQuery?.trim() || input.place.trim();
  const run = startWikimediaMvpRun({
    env: input.env,
    places: [placeLabel],
    seeds: input.seed ? [input.seed] : undefined,
    limitPerPlace: input.limitPerPlace ?? input.limit,
    fetchAll: input.fetchAll,
    dryRun: input.dryRun,
    capsOverride: input.capsOverride,
    collectEarlyStop: input.collectEarlyStop,
    silencePerCandidateWikimediaEvents: input.silencePerCandidateWikimediaEvents,
  });
  const result = await runNextWikimediaMvpPlace(run.runId, input.env);
  if (!result) {
    throw new Error("Failed to process place");
  }
  return { runId: run.runId, placeResult: result, summary: result.summary };
}

export async function runNextWikimediaMvpPlace(runId: string, env: AppEnv): Promise<WikimediaMvpPlaceResult | null> {
  const run = getWikimediaMvpRun(runId);
  if (!run) return null;
  if (run.nextPlaceIndex >= run.places.length) {
    run.status = "complete";
    appendWikimediaMvpRunEvent(run, { message: "run completed" });
    saveWikimediaMvpRun(run);
    return null;
  }

  const placeName = run.places[run.nextPlaceIndex]!;
  const started = Date.now();
  const budgetPart = emptyBudget();
  const fetchBudget: WikimediaFetchBudget = { wikimediaRequests: 0 };
  const warnings: string[] = [];
  const errors: string[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), run.caps.placeTimeoutMs);

  appendWikimediaMvpRunEvent(run, { placeName, message: "place started" });
  wikimediaMvpDevLog("place started", { placeName });

  const seed: WikimediaMvpSeedPlace = run.seeds?.[run.nextPlaceIndex] ?? {
    placeName,
    searchQuery: placeName,
  };

  let commonsMeta: {
    queryPlan: Array<{ query: string; variantType: string; rank: number }>;
    perQueryStats: Array<{
      query: string;
      variantType: string;
      sourceLabel: string;
      hits: number;
      newTitlesIngested: number;
    }>;
    queryTerms: string[];
  } = { queryPlan: [], perQueryStats: [], queryTerms: [seed.searchQuery] };

  try {
    appendWikimediaMvpRunEvent(run, { placeName, message: "wikimedia fetch started" });
    const collectStrategy = run.fetchAll ? "category_first" : "all_variants";
    const { discovered, queryPlan, queryTerms, perQueryStats } = await collectWikimediaTitlesForPlace({
      place: seed,
      maxTitles: run.limitPerPlace,
      maxSearchPages: run.fetchAll ? run.caps.fetchAllMaxSearchPages : run.caps.maxSearchPagesPerPlace,
      primaryQueryOnly: false,
      strategy: collectStrategy,
      earlyStop: run.collectEarlyStop,
      useCache: true,
      budget: fetchBudget,
      signal: controller.signal,
    });
    commonsMeta = { queryPlan, perQueryStats, queryTerms };
    wikimediaMvpDevLog("WIKIMEDIA_PLACE_QUERY_PLAN", {
      placeName: seed.placeName,
      queries: queryPlan.map((q) => ({ q: q.query, variantType: q.variantType, rank: q.rank })),
    });
    const titles = discovered.map((d) => d.title);
    const titleProvenance = new Map(discovered.map((d) => [d.title.replace(/^File:/i, "").trim().toLowerCase(), d] as const));
    appendWikimediaMvpRunEvent(run, {
      placeName,
      message: "candidates fetched",
      data: { titleCount: titles.length, queryTerms, queryPlanCount: queryPlan.length },
    });
    const fallbackMatchedQuery = commonsMeta.queryPlan[0]?.query?.trim() || String(seed.searchQuery || "").trim();
    const assets = await hydrateWikimediaAssets({
      titles,
      titleProvenance,
      budget: fetchBudget,
      signal: controller.signal,
      fallbackMatchedQuery,
    });
    appendWikimediaMvpRunEvent(run, {
      placeName,
      message: "candidates hydrated",
      data: { candidateCount: assets.length },
    });

    const dedupeReads = await maybeEstimateFirestoreDedupeReads(wikimediaMvpFirestoreDedupeEnabled(env));
    budgetPart.firestoreReadsEstimated += dedupeReads;

    const seen = new Set<string>();
    let candidateAnalysis = assets.map((asset) => {
      const dupKey = `${asset.title.toLowerCase()}|${asset.imageUrl}`;
      const duplicateReason = seen.has(dupKey) ? "duplicate title+url in run" : null;
      if (!duplicateReason) seen.add(dupKey);
      const analysis = analyzeWikimediaCandidate({
        place: seed,
        asset,
        duplicateReason,
        dryRun: run.dryRun,
        allowWrites: run.allowWrites,
      });
      const analyzed = toAnalyzedCandidate(analysis, {
        dayKey: asset.dayKey,
        capturedAtMs: asset.capturedAtMs,
        lat: asset.lat,
        lon: asset.lon,
        width: asset.width,
        height: asset.height,
      });
      if (!run.silencePerCandidateWikimediaEvents) {
        appendWikimediaMvpRunEvent(run, {
          placeName,
          message: "candidate analyzed",
          data: {
            candidateId: analyzed.candidateId,
            status: analyzed.status,
            generatedTitle: analyzed.generatedTitle,
          },
        });
      }
      return analyzed;
    });

    const maxAn = run.caps.maxAnalyzedCandidatesForGrouping;
    if (typeof maxAn === "number" && maxAn > 0) {
      const rankScore = (c: (typeof candidateAnalysis)[number]) =>
        (c.status === "REJECT" ? -1e9 : 0) +
        (c.mediaPlaceMatchScore ?? 0) * 1000 +
        (c.qualityScore ?? 0) * 10 +
        (c.relevanceScore ?? 0);
      const rej = candidateAnalysis.filter((c) => c.status === "REJECT");
      const ok = candidateAnalysis.filter((c) => c.status !== "REJECT");
      if (ok.length > maxAn) {
        ok.sort((a, b) => rankScore(b) - rankScore(a));
        candidateAnalysis = [...ok.slice(0, maxAn), ...rej];
      }
    }

    appendWikimediaMvpRunEvent(run, { placeName, message: "grouping started" });
    const groupedAssetGroups = groupWikimediaAssetsIntoPosts({ place: seed, candidates: candidateAnalysis });
    for (const group of groupedAssetGroups) {
      appendWikimediaMvpRunEvent(run, {
        placeName,
        message: group.rejectionReasons.includes("group_has_no_located_assets")
          ? "group rejected because no located assets"
          : "group created",
        data: {
          groupId: group.groupId,
          groupMethod: group.groupMethod,
          assetCount: group.assetCount,
          locatedAssetCount: group.locatedAssetCount,
          status: group.status,
        },
      });
    }

    const assetGroups = await applyWikimediaAssetHygieneToGroups({
      groups: groupedAssetGroups,
      onLog: (event) => {
        wikimediaMvpDevLog(event.message, event.data);
        appendWikimediaMvpRunEvent(run, {
          placeName,
          level: event.level ?? "info",
          message: event.message,
          data: event.data,
        });
      },
    });

    const hygieneByCandidateId = new Map<string, WikimediaAssetHygieneFields>();
    for (const group of assetGroups) {
      for (const asset of [...group.assets, ...(group.removedAssets ?? []), ...(group.reviewAssets ?? [])]) {
        hygieneByCandidateId.set(asset.candidateId, {
          hygieneStatus: asset.hygieneStatus ?? "PASS",
          hygieneReasons: asset.hygieneReasons ?? [],
          hygieneWarnings: asset.hygieneWarnings ?? [],
          duplicateClusterId: asset.duplicateClusterId,
          duplicateDecision: asset.duplicateDecision,
          visualHash: asset.visualHash,
          visualHashDistanceToPrimary: asset.visualHashDistanceToPrimary,
          qualityFlags: asset.qualityFlags,
        });
      }
    }
    for (let i = 0; i < candidateAnalysis.length; i += 1) {
      const row = hygieneByCandidateId.get(candidateAnalysis[i]!.candidateId);
      if (!row) continue;
      candidateAnalysis[i] = {
        ...candidateAnalysis[i]!,
        hygieneStatus: row.hygieneStatus,
        hygieneReasons: row.hygieneReasons,
        hygieneWarnings: row.hygieneWarnings,
        duplicateClusterId: row.duplicateClusterId,
        duplicateDecision: row.duplicateDecision,
        visualHash: row.visualHash,
        visualHashDistanceToPrimary: row.visualHashDistanceToPrimary,
        qualityFlags: row.qualityFlags,
      };
    }

    const generatedPosts = buildWikimediaDryRunPosts({
      place: seed,
      groups: assetGroups,
      dryRun: run.dryRun,
      allowWrites: run.allowWrites,
    });
    for (const post of generatedPosts) {
      appendWikimediaMvpRunEvent(run, {
        placeName,
        message: "generated post preview created after hygiene",
        data: {
          postId: post.postId,
          status: post.status,
          assetCount: post.assetCount,
          originalAssetCount: post.originalAssetCount,
          keptAssetCount: post.keptAssetCount,
          rejectedDuplicateCount: post.rejectedDuplicateCount,
          rejectedHygieneCount: post.rejectedHygieneCount,
          reviewAssetCount: post.reviewAssetCount,
          generatedTitle: post.generatedTitle,
        },
      });
    }

    if (!run.allowWrites || run.dryRun) {
      budgetPart.firestoreWritesSkippedDryRun += generatedPosts.filter((p) => p.status !== "REJECT").length;
    }

    const cache = wikimediaMvpCacheStatsSnapshot();
    budgetPart.wikimediaRequests = fetchBudget.wikimediaRequests;
    budgetPart.cacheHits = cache.hits;
    budgetPart.cacheMisses = cache.misses;
    budgetPart.elapsedMs = Date.now() - started;

    const summary = buildPlaceSummary({
      candidateCount: candidateAnalysis.length,
      assetGroupsCount: assetGroups.length,
      generatedPosts,
      budget: budgetPart,
    });

    const assetsGroupedIntoPreviewsCount = generatedPosts
      .filter((p) => p.status !== "REJECT")
      .reduce((sum, p) => sum + (p.media?.length ?? p.assetCount ?? 0), 0);

    const acceptedAfterHygiene = candidateAnalysis.filter(
      (c) => c.status !== "REJECT" && c.hygieneStatus !== "REJECT",
    ).length;
    const strictKeep = candidateAnalysis.filter((c) => c.status === "KEEP" && c.hygieneStatus !== "REJECT").length;
    const reviewAlive = candidateAnalysis.filter((c) => c.status === "REVIEW" && c.hygieneStatus !== "REJECT").length;
    const pipelineRejected = candidateAnalysis.filter((c) => c.status === "REJECT" || c.hygieneStatus === "REJECT").length;
    const analysisRejectOnly = candidateAnalysis.filter((c) => c.status === "REJECT").length;

    const commonsQueryStats: WikimediaCommonsQueryStat[] = buildEnrichedCommonsQueryStats({
      plan: commonsMeta.queryPlan,
      perQueryStats: commonsMeta.perQueryStats,
      candidateAnalysis,
      fallbackMatchedQuery: commonsMeta.queryPlan[0]?.query ?? seed.searchQuery,
    });

    if (budgetPart.elapsedMs > 30_000) {
      warnings.push("SLOW_PLACE_PROCESSING");
    }

    const placeResult: WikimediaMvpPlaceResult = {
      placeName,
      normalizedPlaceName: normalizePlaceName(placeName),
      wikimediaQueryTerms: commonsMeta.queryTerms,
      commonsQueryPlan: commonsMeta.queryPlan,
      commonsQueryStats,
      titlesDiscoveredCount: titles.length,
      assetsHydratedCount: assets.length,
      assetsAcceptedForGroupingCount: acceptedAfterHygiene,
      assetsGroupedIntoPreviewsCount,
      candidateCount: candidateAnalysis.length,
      keptCount: strictKeep,
      rejectedCount: analysisRejectOnly,
      reviewCount: reviewAlive,
      assetsAcceptedAfterHygieneCount: acceptedAfterHygiene,
      assetsStrictKeepCount: strictKeep,
      assetsPipelineRejectedCount: pipelineRejected,
      totalRuntimeMs: budgetPart.elapsedMs,
      budget: budgetPart,
      errors,
      warnings,
      candidateAnalysis,
      generatedPosts,
      assetGroups,
      summary,
      candidates: candidateAnalysis,
    };

    run.placeResults.push(placeResult);
    run.nextPlaceIndex += 1;
    mergeBudget(run.budget, budgetPart);
    run.status = run.nextPlaceIndex >= run.places.length ? "complete" : "running";
    appendWikimediaMvpRunEvent(run, {
      placeName,
      message: "place completed",
      data: summary,
    });
    if (run.status === "complete") {
      appendWikimediaMvpRunEvent(run, { message: "run completed", data: { places: run.placeResults.length } });
    }
    saveWikimediaMvpRun(run);
    return placeResult;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(msg);
    run.status = "failed";
    run.error = msg;
    appendWikimediaMvpRunEvent(run, { placeName, level: "error", message: "place failed", data: { error: msg } });
    saveWikimediaMvpRun(run);
    const emptySummary = buildPlaceSummary({
      candidateCount: 0,
      assetGroupsCount: 0,
      generatedPosts: [],
      budget: budgetPart,
    });
    const fallbackQ = commonsMeta.queryPlan[0]?.query ?? seed.searchQuery;
    return {
      placeName,
      normalizedPlaceName: normalizePlaceName(placeName),
      wikimediaQueryTerms: commonsMeta.queryTerms.length ? commonsMeta.queryTerms : [seed.searchQuery],
      commonsQueryPlan: commonsMeta.queryPlan,
      commonsQueryStats: buildEnrichedCommonsQueryStats({
        plan: commonsMeta.queryPlan,
        perQueryStats: commonsMeta.perQueryStats,
        candidateAnalysis: [],
        fallbackMatchedQuery: fallbackQ,
      }),
      partialReason: msg.toLowerCase().includes("abort") ? "place_timeout_or_abort" : undefined,
      titlesDiscoveredCount: 0,
      assetsHydratedCount: 0,
      assetsAcceptedForGroupingCount: 0,
      assetsGroupedIntoPreviewsCount: 0,
      candidateCount: 0,
      keptCount: 0,
      rejectedCount: 0,
      reviewCount: 0,
      assetsAcceptedAfterHygieneCount: 0,
      assetsStrictKeepCount: 0,
      assetsPipelineRejectedCount: 0,
      totalRuntimeMs: Date.now() - started,
      budget: budgetPart,
      errors,
      warnings,
      candidateAnalysis: [],
      generatedPosts: [],
      assetGroups: [],
      summary: emptySummary,
      candidates: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function clearWikimediaMvpRunState(): void {
  clearWikimediaMvpRuns();
}
