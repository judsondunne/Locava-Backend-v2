import type { AppEnv } from "../../config/env.js";
import type {
  DiscoveryCandidate,
  DiscoveryRanking,
} from "../../contracts/surfaces/undiscovered-candidate.contract.js";

/**
 * Spot popularity ranking — no AI, metadata + web authority only.
 *
 * Judson's ask: rank spots on top of the quality filter so the map can show
 * better ones higher, using signals like "how many Google results come up".
 * Serper exposes no total-results count and even hyper-obscure names fill a
 * page of organic results (database-scraper sites generate a page for every
 * named object), so the useful form of that idea is: count organic hits that
 * actually mention the place, weighted by domain authority, with scraper
 * domains weighted to zero.
 */

export type WebSearchOrganicHit = { title?: string; link?: string; snippet?: string };
export type WebSearchResponse = { organic?: WebSearchOrganicHit[]; knowledgeGraph?: unknown };
export type WebSearchFetcher = (query: string) => Promise<WebSearchResponse | null>;

/** Domains that auto-generate a page per GNIS/OSM name — zero popularity signal. */
const SCRAPER_DOMAIN_PATTERNS = [
  /anyplaceamerica/i,
  /mytopo/i,
  /expertgps/i,
  /viewweather/i,
  /foreca\./i,
  /ceb\.wikipedia/i,
  /latlong\.net/i,
  /geographic\.org/i,
  /mindat\.org/i,
  /gomapper/i,
  /roadsidethoughts/i,
  /hometownlocator/i,
  /topozone/i,
  /mapcarta/i,
  /satellites\.pro/i,
];

const AUTHORITY_DOMAIN_WEIGHTS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /alltrails\.com/i, weight: 3 },
  { pattern: /tripadvisor\./i, weight: 3 },
  { pattern: /en\.wikipedia\.org/i, weight: 3 },
  { pattern: /vermont\.gov|vtstateparks/i, weight: 3 },
  { pattern: /newenglandwaterfalls|world-of-waterfalls|hikenewengland|trailfinder\.info/i, weight: 2.5 },
  { pattern: /gostowe|vermontvacation|vermont\.com/i, weight: 2.5 },
  { pattern: /youtube\.com|instagram\.com|facebook\.com|tiktok\.com/i, weight: 1.5 },
];

const CATEGORY_PRIORS: Record<string, number> = {
  waterfall: 10,
  swimming_hole: 10,
  gorge_canyon: 9,
  summit_viewpoint: 8,
  scenic_overlook: 8,
  cave: 8,
  lake_pond: 7,
  beach: 7,
  hiking_trail: 6,
  river_stream: 5,
  historic_landmark: 5,
  campsite: 5,
  forest_natural: 4,
  park: 4,
  other: 0,
};

export type LocalRankSignals = { score: number; signals: string[] };

/** Free, instant signals from the candidate's own metadata. Max ~30. */
export function computeLocalRankSignals(candidate: DiscoveryCandidate): LocalRankSignals {
  const signals: string[] = [];
  let score = 0;

  const prior = CATEGORY_PRIORS[candidate.primaryCategory] ?? 0;
  if (prior > 0) {
    score += prior;
    signals.push(`category:${candidate.primaryCategory}`);
  }

  if (candidate.qualityGate.passed) {
    score += 4;
    signals.push("quality_pass");
  }

  // OSM tag strings travel on provenance.sourceKeys (e.g. "natural=waterfall").
  const keys = candidate.provenance.sourceKeys ?? [];
  const keyHay = keys.join(" ").toLowerCase();
  if (/\bwikipedia\b|\bwikidata\b/.test(keyHay)) {
    score += 8;
    signals.push("osm_wikipedia_tag");
  }
  if (/\bwebsite=|\burl=/.test(keyHay)) {
    score += 3;
    signals.push("osm_website_tag");
  }
  const richness = Math.min(keys.length, 6);
  if (richness >= 2) {
    score += richness; // up to +6
    signals.push(`tag_richness:${richness}`);
  }

  // A real multi-word name beats bare generic labels.
  const words = candidate.displayName.trim().split(/\s+/).length;
  if (words >= 2 && !candidate.displayName.includes("=")) {
    score += 3;
    signals.push("named");
  }

  return { score: Math.min(score, 30), signals };
}

export type WebRankSignals = { webAuthority: number; signals: string[] };

/** Authority-weighted count of organic hits that actually mention the place. */
export function scoreWebSearchResponse(
  name: string,
  response: WebSearchResponse,
): WebRankSignals {
  const signals: string[] = [];
  const nameLc = name.toLowerCase();
  let authority = 0;
  let meaningfulHits = 0;

  for (const hit of response.organic ?? []) {
    const text = `${hit.title ?? ""} ${hit.snippet ?? ""}`.toLowerCase();
    if (!text.includes(nameLc)) continue;
    const link = hit.link ?? "";
    if (SCRAPER_DOMAIN_PATTERNS.some((p) => p.test(link))) continue;
    const weighted = AUTHORITY_DOMAIN_WEIGHTS.find((w) => w.pattern.test(link));
    authority += weighted ? weighted.weight : 1;
    meaningfulHits += 1;
    if (weighted && weighted.weight >= 2.5) {
      const domain = link.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? "";
      if (domain && !signals.includes(`authority:${domain}`)) signals.push(`authority:${domain}`);
    }
  }

  if (response.knowledgeGraph) {
    authority += 3;
    signals.push("knowledge_graph");
  }
  if (meaningfulHits > 0) signals.push(`web_hits:${meaningfulHits}`);

  return { webAuthority: Number(authority.toFixed(1)), signals };
}

/** Combine local + web into a 0–100 score and tier. */
export function combineRanking(
  local: LocalRankSignals,
  web: WebRankSignals | null,
  nowIso?: string,
): DiscoveryRanking {
  // Local caps at 30; web scales to 70. A page of 10 organic hits tops out
  // around ~18 authority when dominated by top outdoor domains, so /18 puts a
  // clearly-popular spot (AllTrails + Tripadvisor + blogs) firmly in S.
  const webScore = web ? Math.min(web.webAuthority / 18, 1) * 70 : 0;
  const score = Math.round(Math.min(local.score + webScore, 100));
  const tier: DiscoveryRanking["tier"] = score >= 60 ? "S" : score >= 40 ? "A" : score >= 20 ? "B" : "C";
  const hiddenGem = web !== null && web.webAuthority <= 2 && local.score >= 15;
  const signals = [...local.signals, ...(web?.signals ?? [])];
  if (hiddenGem) signals.push("hidden_gem");
  return {
    score,
    tier,
    webAuthority: web?.webAuthority,
    hiddenGem: hiddenGem || undefined,
    signals,
    rankedAt: nowIso ?? new Date().toISOString(),
  };
}

/** In-memory web-search cache — never spend a credit twice on the same name. */
const webSearchCache = new Map<string, WebSearchResponse | null>();

export function resetWebSearchCache(): void {
  webSearchCache.clear();
}

export function buildDefaultWebSearchFetcher(env: AppEnv): WebSearchFetcher | null {
  const key = String(env.SERPER_API_KEY ?? "").trim();
  if (!key) return null;
  return async (query: string) => {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      // num stays ≤10: Serper free tier rejects advanced query patterns above that.
      body: JSON.stringify({ q: query, num: 10 }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as WebSearchResponse;
  };
}

export type RankCandidateResult = {
  ranking: DiscoveryRanking;
  usedWeb: boolean;
  spentCredit: boolean;
};

export async function rankCandidate(
  candidate: DiscoveryCandidate,
  opts: { fetcher?: WebSearchFetcher | null; region?: string } = {},
): Promise<RankCandidateResult> {
  const local = computeLocalRankSignals(candidate);
  const fetcher = opts.fetcher ?? null;
  if (!fetcher) {
    return { ranking: combineRanking(local, null), usedWeb: false, spentCredit: false };
  }
  const cacheKey = candidate.displayName.trim().toLowerCase();
  let spentCredit = false;
  let response = webSearchCache.get(cacheKey);
  if (response === undefined) {
    const regionHint = (opts.region ?? "VT").toUpperCase() === "VT" ? "Vermont" : opts.region ?? "";
    try {
      response = await fetcher(`"${candidate.displayName}" ${regionHint}`.trim());
      spentCredit = true;
    } catch {
      response = null;
    }
    webSearchCache.set(cacheKey, response ?? null);
  }
  if (!response) {
    return { ranking: combineRanking(local, null), usedWeb: false, spentCredit };
  }
  const web = scoreWebSearchResponse(candidate.displayName, response);
  return { ranking: combineRanking(local, web), usedWeb: true, spentCredit };
}
