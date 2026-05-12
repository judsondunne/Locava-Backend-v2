import { wikimediaMvpCacheGet, wikimediaMvpCacheSet } from "./wikimediaMvpCache.js";
import { buildCommonsSearchQueryPlan, type CommonsQueryPlanEntry } from "./commonsQueryPlan.js";
import type {
  WikimediaMvpCollectEarlyStop,
  WikimediaMvpNormalizedAsset,
  WikimediaMvpSeedPlace,
} from "./WikimediaMvpTypes.js";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_UA =
  "LocavaWikimediaMvpDev/1.0 (https://locava.com; see https://meta.wikimedia.org/wiki/User-Agent_policy)";

export type WikimediaFetchBudget = {
  wikimediaRequests: number;
};

export type CommonsTitleDiscovery = {
  title: string;
  matchedQuery: string;
  matchedQueryRank: number;
  queryVariantType: string;
  sourceLabel: string;
  sourceConfidenceRank: number;
  allMatchedQueries?: string[];
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function commonsGetJson<T>(params: Record<string, string>, budget: WikimediaFetchBudget, signal?: AbortSignal): Promise<T> {
  const url = new URL(COMMONS_API);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  budget.wikimediaRequests += 1;
  const res = await fetch(url.toString(), { signal, headers: { "user-agent": COMMONS_UA } });
  if (!res.ok) {
    throw new Error(`commons_http_${res.status}`);
  }
  return (await res.json()) as T;
}

type SearchResponse = {
  query?: {
    search?: Array<{ title?: string }>;
    searchinfo?: { totalhits?: number };
  };
};

type CategoryMembersResponse = {
  query?: { categorymembers?: Array<{ title?: string; ns?: number }> };
  continue?: { cmcontinue?: string };
};

function normalizeCategoryTitle(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.toLowerCase().startsWith("category:") ? t : `Category:${t}`;
}

function titleDedupeKey(title: string): string {
  return title.replace(/^File:/i, "").trim().toLowerCase();
}

function mergeDiscovery(existing: CommonsTitleDiscovery | undefined, next: CommonsTitleDiscovery): CommonsTitleDiscovery {
  if (!existing) return next;
  if (next.sourceConfidenceRank < existing.sourceConfidenceRank) return next;
  if (next.sourceConfidenceRank > existing.sourceConfidenceRank) return existing;
  if (next.matchedQueryRank < existing.matchedQueryRank) return next;
  if (next.matchedQueryRank > existing.matchedQueryRank) return existing;
  const mergedQueries = dedupeStableStrings([...(existing as { allQ?: string[] }).allQ ?? [], existing.matchedQuery, next.matchedQuery]);
  (next as { allQ?: string[] }).allQ = mergedQueries;
  return next;
}

function dedupeStableStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export async function collectCommonsCategoryFileTitles(input: {
  categoryTitle: string;
  maxTitles: number;
  sourceLabel: string;
  sourceConfidenceRank: number;
  variantType: string;
  matchedQueryRank: number;
  budget: WikimediaFetchBudget;
  signal?: AbortSignal;
}): Promise<CommonsTitleDiscovery[]> {
  const cmtitle = normalizeCategoryTitle(input.categoryTitle);
  if (!cmtitle || cmtitle === "Category:") return [];
  const out: CommonsTitleDiscovery[] = [];
  let cmcontinue: string | undefined;
  while (out.length < input.maxTitles) {
    if (input.signal?.aborted) break;
    const remaining = input.maxTitles - out.length;
    const params: Record<string, string> = {
      action: "query",
      format: "json",
      formatversion: "2",
      list: "categorymembers",
      cmtitle,
      cmtype: "file",
      cmlimit: String(Math.min(50, remaining)),
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const data = await commonsGetJson<CategoryMembersResponse>(params, input.budget, input.signal);
    const batch = (data.query?.categorymembers ?? [])
      .map((m) => String(m.title || "").trim())
      .filter((t) => t.toLowerCase().startsWith("file:"));
    if (batch.length === 0) break;
    for (const title of batch) {
      out.push({
        title,
        matchedQuery: cmtitle,
        matchedQueryRank: input.matchedQueryRank,
        queryVariantType: input.variantType,
        sourceLabel: input.sourceLabel,
        sourceConfidenceRank: input.sourceConfidenceRank,
      });
      if (out.length >= input.maxTitles) break;
    }
    cmcontinue = data.continue?.cmcontinue;
    if (!cmcontinue) break;
    await sleep(120, input.signal);
  }
  return out;
}

export function buildPrimarySearchQuery(place: WikimediaMvpSeedPlace): string {
  const q = String(place.searchQuery || place.placeName || "").trim();
  return q || place.placeName;
}

export function buildExtraDiscoveryQueries(place: WikimediaMvpSeedPlace): string[] {
  const pn = place.placeName.trim();
  return [`${pn} landscape`, `${pn} hiking trail`];
}

export type CommonsCollectStrategy = "exact_only" | "all_variants" | "category_first";

export async function collectWikimediaTitlesForPlace(input: {
  place: WikimediaMvpSeedPlace;
  maxTitles: number;
  maxSearchPages: number;
  /** When true, only the first search query variant is used (fast path). */
  primaryQueryOnly?: boolean;
  strategy?: CommonsCollectStrategy;
  maxQueryMs?: number;
  earlyStop?: WikimediaMvpCollectEarlyStop;
  useCache: boolean;
  budget: WikimediaFetchBudget;
  signal?: AbortSignal;
}): Promise<{
  discovered: CommonsTitleDiscovery[];
  queryPlan: CommonsQueryPlanEntry[];
  queryTerms: string[];
  perQueryStats: Array<{
    query: string;
    variantType: string;
    sourceLabel: string;
    hits: number;
    newTitlesIngested: number;
  }>;
}> {
  const strategy = input.strategy ?? "all_variants";
  const fullPlan = buildCommonsSearchQueryPlan(input.place);
  const plan: CommonsQueryPlanEntry[] =
    input.primaryQueryOnly && fullPlan.length > 0
      ? [fullPlan[0]!]
      : strategy === "exact_only" && fullPlan.length > 0
        ? [fullPlan[0]!]
        : fullPlan;
  const queryTerms = plan.map((p) => p.query);
  const perQueryStats: Array<{
    query: string;
    variantType: string;
    sourceLabel: string;
    hits: number;
    newTitlesIngested: number;
  }> = [];
  const byKey = new Map<string, CommonsTitleDiscovery>();
  const maxPerPhase = Math.min(input.maxTitles, 500);
  const queryBudgetMs = input.maxQueryMs ?? (input.primaryQueryOnly ? 8_000 : 12_000);

  const pushStat = (row: {
    query: string;
    variantType: string;
    sourceLabel: string;
    hits: number;
    newTitlesIngested: number;
  }) => {
    perQueryStats.push(row);
  };

  const runCategory = async (args: {
    categoryTitle: string;
    sourceLabel: string;
    sourceConfidenceRank: number;
    variantType: string;
    rank: number;
  }) => {
    const started = Date.now();
    const disc = await collectCommonsCategoryFileTitles({
      categoryTitle: args.categoryTitle,
      maxTitles: Math.min(40, maxPerPhase),
      sourceLabel: args.sourceLabel,
      sourceConfidenceRank: args.sourceConfidenceRank,
      variantType: args.variantType,
      matchedQueryRank: args.rank,
      budget: input.budget,
      signal: input.signal,
    });
    const cmtitle = normalizeCategoryTitle(args.categoryTitle);
    let newIngested = 0;
    for (const d of disc) {
      const key = titleDedupeKey(d.title);
      const had = byKey.has(key);
      const cur = byKey.get(key);
      byKey.set(key, mergeDiscovery(cur, d));
      if (!had) newIngested += 1;
    }
    pushStat({
      query: cmtitle,
      variantType: args.variantType,
      sourceLabel: args.sourceLabel,
      hits: disc.length,
      newTitlesIngested: newIngested,
    });
    if (Date.now() - started > queryBudgetMs) return;
  };

  const categoryFirst = strategy === "category_first";

  if (!input.primaryQueryOnly && (categoryFirst || strategy === "all_variants")) {
    if (input.place.commonsCategoryFromWikidata?.trim()) {
      await runCategory({
        categoryTitle: input.place.commonsCategoryFromWikidata.trim(),
        sourceLabel: "commons_category_from_wikidata",
        sourceConfidenceRank: 1,
        variantType: "commons_category_from_wikidata",
        rank: -2,
      });
    }
    await runCategory({
      categoryTitle: input.place.placeName.trim(),
      sourceLabel: "commons_category_exact",
      sourceConfidenceRank: 2,
      variantType: "commons_category_exact_name",
      rank: -1,
    });
  }

  if (categoryFirst) {
    /* category titles already collected; still run search variants below unless exact_only */
  }

  const perQueryDiscoveryCap = Math.max(25, Math.min(120, Math.ceil(input.maxTitles / Math.max(4, plan.length + 1))));

  for (const entry of plan) {
    if (byKey.size >= input.maxTitles) break;
    if (input.signal?.aborted) break;
    if (
      input.earlyStop?.enabled &&
      byKey.size >= input.earlyStop.minDiscoveredTitles &&
      entry.rank > input.earlyStop.maxPlanRankWhileEarly
    ) {
      break;
    }
    const qStarted = Date.now();
    let hits = 0;
    let newTitlesFromQuery = 0;
    let offset = 0;
    for (let page = 0; page < input.maxSearchPages; page += 1) {
      if (byKey.size >= input.maxTitles) break;
      if (newTitlesFromQuery >= perQueryDiscoveryCap) break;
      if (Date.now() - qStarted > queryBudgetMs) break;
      const globalRemaining = input.maxTitles - byKey.size;
      const queryRemaining = perQueryDiscoveryCap - newTitlesFromQuery;
      const remaining = Math.min(globalRemaining, queryRemaining);
      const srlimit = Math.min(50, Math.max(1, remaining));
      const cacheKey = `sp:${srlimit}:${offset}:${entry.query}`;
      let batch: string[] = [];
      if (input.useCache) {
        const hit = wikimediaMvpCacheGet<{ titles: string[] }>(cacheKey);
        if (hit) batch = hit.titles;
      }
      if (batch.length === 0) {
        const data = await commonsGetJson<SearchResponse>(
          {
            action: "query",
            format: "json",
            formatversion: "2",
            list: "search",
            srsearch: entry.query,
            srnamespace: "6",
            srlimit: String(srlimit),
            sroffset: String(offset),
          },
          input.budget,
          input.signal,
        );
        batch = (data.query?.search ?? []).map((r) => String(r.title || "").trim()).filter(Boolean);
        if (input.useCache) {
          wikimediaMvpCacheSet(cacheKey, { titles: batch });
        }
      }
      hits += batch.length;
      if (batch.length === 0) break;
      const sourceConfidenceRank =
        entry.variantType === "exact_place_name" || entry.variantType === "quoted_exact_name"
          ? 3
          : entry.variantType.startsWith("place_plus_state")
            ? 4
            : entry.variantType.startsWith("synonym_")
              ? 5
              : 6;
      const sourceLabel =
        sourceConfidenceRank === 3
          ? "commons_search_exact_name"
          : sourceConfidenceRank === 4
            ? "commons_search_state_variant"
            : sourceConfidenceRank === 5
              ? "commons_search_synonym"
              : "commons_search_broad";
      for (const title of batch) {
        const key = titleDedupeKey(title);
        const disc: CommonsTitleDiscovery = {
          title,
          matchedQuery: entry.query,
          matchedQueryRank: entry.rank,
          queryVariantType: entry.variantType,
          sourceLabel,
          sourceConfidenceRank,
        };
        const cur = byKey.get(key);
        if (!cur) {
          byKey.set(key, disc);
          newTitlesFromQuery += 1;
        } else {
          byKey.set(key, mergeDiscovery(cur, disc));
        }
        if (byKey.size >= input.maxTitles) break;
        if (newTitlesFromQuery >= perQueryDiscoveryCap) break;
      }
      offset += batch.length;
      if (batch.length < srlimit) break;
      await sleep(120, input.signal);
    }
    pushStat({
      query: entry.query,
      variantType: entry.variantType,
      sourceLabel: "commons_search",
      hits,
      newTitlesIngested: newTitlesFromQuery,
    });
  }

  const discovered = [...byKey.values()].slice(0, input.maxTitles);
  discovered.sort((a, b) => a.sourceConfidenceRank - b.sourceConfidenceRank || a.matchedQueryRank - b.matchedQueryRank);
  return { discovered, queryPlan: plan, queryTerms, perQueryStats };
}

type QueryPages = Record<
  string,
  {
    title?: string;
    pageid?: number;
    categories?: Array<{ title?: string }>;
    coordinates?: Array<{ lat?: number; lon?: number }>;
    imageinfo?: Array<{
      url?: string;
      thumburl?: string;
      width?: number;
      height?: number;
      mime?: string;
      timestamp?: string;
      extmetadata?: Record<string, { value?: string }>;
    }>;
  }
>;

type QueryResponse = { query?: { pages?: QueryPages } };

function pickDescription(ext: Record<string, { value?: string }> | undefined): string | null {
  const raw = ext?.ImageDescription?.value || ext?.ObjectDescription?.value || ext?.Description?.value || "";
  const t = String(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 800) : null;
}

function pickMeta(ext: Record<string, { value?: string }> | undefined, key: string): string | null {
  const raw = ext?.[key]?.value;
  const t = String(raw || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t || null;
}

function dayKeyFromTimestamp(ts?: string): string {
  if (!ts) return "unknown";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

export async function hydrateWikimediaAssets(input: {
  titles: string[];
  titleProvenance?: Map<string, CommonsTitleDiscovery>;
  budget: WikimediaFetchBudget;
  signal?: AbortSignal;
  /** When provenance is missing, attribute stats to this Commons query (first plan query). */
  fallbackMatchedQuery?: string;
}): Promise<WikimediaMvpNormalizedAsset[]> {
  const out: WikimediaMvpNormalizedAsset[] = [];
  const batchSize = 12;
  for (let i = 0; i < input.titles.length; i += batchSize) {
    if (input.signal?.aborted) break;
    const batch = input.titles.slice(i, i + batchSize);
    const data = await commonsGetJson<QueryResponse>(
      {
        action: "query",
        format: "json",
        formatversion: "2",
        prop: "imageinfo|coordinates|categories",
        titles: batch.join("|"),
        iiprop: "url|size|mime|extmetadata|timestamp",
        iiurlwidth: "320",
        cllimit: "50",
      },
      input.budget,
      input.signal,
    );
    const pages = data.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const title = String(page.title || "");
      const ii = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined;
      const url = ii?.url || ii?.thumburl || "";
      const w = Number(ii?.width || 0);
      const h = Number(ii?.height || 0);
      const mime = String(ii?.mime || "").toLowerCase();
      if (!title || !url || w <= 0 || h <= 0) continue;
      const cats = (page.categories ?? [])
        .map((c) => String(c.title || "").replace(/^Category:/i, ""))
        .filter(Boolean);
      const coord = Array.isArray(page.coordinates) ? page.coordinates[0] : undefined;
      const lat = coord && typeof coord.lat === "number" ? coord.lat : null;
      const lon = coord && typeof coord.lon === "number" ? coord.lon : null;
      const provKey = titleDedupeKey(title);
      const prov = input.titleProvenance?.get(provKey);
      const allMatchedQueries = prov?.allMatchedQueries?.length
        ? prov.allMatchedQueries
        : prov
          ? dedupeStableStrings([prov.matchedQuery])
          : undefined;
      const fallbackQ = String(input.fallbackMatchedQuery || "").trim();
      out.push({
        title,
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        imageUrl: url,
        thumbnailUrl: ii?.thumburl || null,
        width: w,
        height: h,
        mime,
        categories: cats,
        titleLower: title.toLowerCase(),
        lat,
        lon,
        dayKey: dayKeyFromTimestamp(ii?.timestamp),
        dateSource: ii?.timestamp ? "commons_timestamp" : "unknown",
        capturedAtMs: ii?.timestamp ? Date.parse(ii.timestamp) : null,
        descriptionText: pickDescription(ii?.extmetadata),
        author: pickMeta(ii?.extmetadata, "Artist"),
        license: pickMeta(ii?.extmetadata, "LicenseShortName"),
        credit: pickMeta(ii?.extmetadata, "Credit"),
        matchedQuery: prov?.matchedQuery ?? (fallbackQ || undefined),
        matchedQueryRank: prov?.matchedQueryRank ?? (fallbackQ ? 0 : undefined),
        queryVariantType: prov?.queryVariantType ?? (fallbackQ ? "fallback_unattributed" : undefined),
        sourceLabel: prov?.sourceLabel ?? (fallbackQ ? "hydrate_fallback_query" : undefined),
        sourceConfidenceRank: prov?.sourceConfidenceRank ?? (fallbackQ ? 9 : undefined),
        allMatchedQueries,
      });
    }
    if (i + batchSize < input.titles.length) {
      await sleep(140, input.signal);
    }
  }
  return out;
}
