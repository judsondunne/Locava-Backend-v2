import { resolvePlaceCandidateMediaSignalConfig } from "./placeCandidateMediaSignalConfig.js";
import type { PlaceCandidate, PlaceCandidateMediaSignals } from "./types.js";

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const UA = "LocavaPlaceCandidateMvp/1.0 (dev-only; https://locava.com)";

type SparqlBinding = {
  item?: { value: string };
  image?: { value: string };
  commons?: { value: string };
  article?: { value: string };
};

function mediaAvailabilityFromSignals(input: {
  hasWikidataImage: boolean;
  hasCommonsCategory: boolean;
  commonsCategoryFileCount?: number;
  commonsSearchHitCount?: number;
  wikipediaUrl?: string;
}): PlaceCandidateMediaSignals["mediaAvailability"] {
  if (input.hasWikidataImage && (input.commonsCategoryFileCount ?? 0) >= 5) return "strong";
  if (input.hasWikidataImage || (input.commonsCategoryFileCount ?? 0) >= 3 || (input.commonsSearchHitCount ?? 0) >= 3) {
    return "medium";
  }
  if (input.hasCommonsCategory || input.wikipediaUrl || (input.commonsSearchHitCount ?? 0) > 0) return "weak";
  if (!input.hasWikidataImage && !input.hasCommonsCategory && !input.wikipediaUrl) return "none";
  return "unknown";
}

function mediaSignalScoreFromAvailability(availability: PlaceCandidateMediaSignals["mediaAvailability"]): number {
  if (availability === "strong") return 20;
  if (availability === "medium") return 12;
  if (availability === "weak") return 5;
  return 0;
}

async function runSparql(query: string, timeoutMs: number): Promise<SparqlBinding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(WIKIDATA_SPARQL_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "application/sparql-results+json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ format: "json", query }).toString(),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
    return data.results?.bindings ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function commonsCategoryFileCount(category: string, timeoutMs: number): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(COMMONS_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    url.searchParams.set("prop", "categoryinfo");
    url.searchParams.set("titles", `Category:${category.replace(/^Category:/i, "")}`);
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": UA } });
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { categoryinfo?: { pages?: number } }> };
    };
    const pages = data.query?.pages ?? {};
    const first = Object.values(pages)[0];
    return Number(first?.categoryinfo?.pages ?? 0);
  } catch {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

async function commonsSearchHitCount(query: string, timeoutMs: number): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(COMMONS_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    url.searchParams.set("list", "search");
    url.searchParams.set("srnamespace", "6");
    url.searchParams.set("srlimit", "5");
    url.searchParams.set("srsearch", query);
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": UA } });
    if (!res.ok) return 0;
    const data = (await res.json()) as { query?: { search?: unknown[] } };
    return data.query?.search?.length ?? 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

function qidFromUri(uri: string): string {
  const match = /\/(Q\d+)$/.exec(uri);
  return match?.[1] ?? uri;
}

function commonsCategoryFromUri(uri: string): string | undefined {
  const match = /Category:(.+)$/.exec(decodeURIComponent(uri));
  return match?.[1]?.replace(/_/g, " ");
}

export async function enrichPlaceCandidatesWithMediaSignals(
  candidates: PlaceCandidate[],
  options?: { enabled?: boolean; config?: ReturnType<typeof resolvePlaceCandidateMediaSignalConfig> },
): Promise<{
  candidates: PlaceCandidate[];
  summary: {
    checked: number;
    strong: number;
    medium: number;
    weak: number;
    none: number;
    unknown: number;
    timedOut: number;
    elapsedMs: number;
    partial: boolean;
  };
}> {
  const started = Date.now();
  const config = options?.config ?? resolvePlaceCandidateMediaSignalConfig();
  if (options?.enabled === false) {
    return {
      candidates,
      summary: { checked: 0, strong: 0, medium: 0, weak: 0, none: 0, unknown: 0, timedOut: 0, elapsedMs: 0, partial: false },
    };
  }

  const ranked = [...candidates].sort((a, b) => (b.locavaPriorityScore ?? 0) - (a.locavaPriorityScore ?? 0));
  const targets = ranked.slice(0, config.topN);
  const qids = targets.map((row) => row.sourceIds.wikidata).filter((qid): qid is string => Boolean(qid));
  const byQid = new Map<string, PlaceCandidateMediaSignals>();

  if (qids.length > 0 && Date.now() - started < config.totalTimeoutMs) {
    const values = qids.map((qid) => `wd:${qid}`).join(" ");
    const bindings = await runSparql(
      `
SELECT ?item ?image ?commons ?article WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P373 ?commons . }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
}
`.trim(),
      Math.min(config.perQueryTimeoutMs, config.totalTimeoutMs),
    );
    for (const row of bindings) {
      const qid = qidFromUri(String(row.item?.value || ""));
      const commonsCategory = row.commons?.value ? commonsCategoryFromUri(row.commons.value) : undefined;
      const wikipediaUrl = row.article?.value;
      const hasWikidataImage = Boolean(row.image?.value);
      byQid.set(qid, {
        checked: true,
        hasWikidataImage,
        hasCommonsCategory: Boolean(commonsCategory),
        commonsCategory,
        wikipediaUrl,
        wikidataImagePresent: hasWikidataImage,
        mediaAvailability: "unknown",
        source: commonsCategory ? "wikidata" : "none",
      });
    }
  }

  let timedOut = 0;
  let inFlight = 0;
  let nextIndex = 0;
  const queue = targets.filter((row) => row.sourceIds.wikidata);

  await new Promise<void>((resolve) => {
    const schedule = () => {
      if (Date.now() - started >= config.totalTimeoutMs) {
        if (inFlight === 0) resolve();
        return;
      }
      while (inFlight < config.concurrency && nextIndex < queue.length && Date.now() - started < config.totalTimeoutMs) {
        const candidate = queue[nextIndex]!;
        nextIndex += 1;
        inFlight += 1;
        void (async () => {
          const qid = candidate.sourceIds.wikidata!;
          const base = byQid.get(qid) ?? {
            checked: true,
            hasWikidataImage: Boolean(candidate.signals.hasImageField),
            hasCommonsCategory: Boolean(candidate.signals.hasCommonsCategory),
            commonsCategory: candidate.sourceIds.commonsCategory,
            wikipediaUrl: candidate.sourceUrls.wikipedia,
            wikidataImagePresent: Boolean(candidate.signals.hasImageField),
            mediaAvailability: "unknown" as const,
            source: "none" as const,
          };
          const remaining = config.totalTimeoutMs - (Date.now() - started);
          const perQuery = Math.min(config.perQueryTimeoutMs, remaining);
          let categoryFileCount: number | undefined;
          let searchHitCount: number | undefined;
          if (perQuery <= 0) {
            timedOut += 1;
            base.timedOut = true;
          } else if (base.commonsCategory) {
            categoryFileCount = await commonsCategoryFileCount(base.commonsCategory, perQuery);
            base.source = "commons_category";
          } else {
            searchHitCount = await commonsSearchHitCount(`${candidate.name} ${candidate.state}`, perQuery);
            base.source = "commons_search";
          }
          base.commonsCategoryFileCount = categoryFileCount;
          base.commonsSearchHitCount = searchHitCount;
          base.mediaAvailability = mediaAvailabilityFromSignals({
            hasWikidataImage: base.hasWikidataImage,
            hasCommonsCategory: base.hasCommonsCategory,
            commonsCategoryFileCount: categoryFileCount,
            commonsSearchHitCount: searchHitCount,
            wikipediaUrl: base.wikipediaUrl,
          });
          base.elapsedMs = Date.now() - started;
          byQid.set(qid, base);
          inFlight -= 1;
          schedule();
        })();
      }
      if (inFlight === 0 && nextIndex >= queue.length) resolve();
    };
    schedule();
  });

  const summary = {
    checked: 0,
    strong: 0,
    medium: 0,
    weak: 0,
    none: 0,
    unknown: 0,
    timedOut,
    elapsedMs: Date.now() - started,
    partial: timedOut > 0 || Date.now() - started >= config.totalTimeoutMs,
  };

  const enriched = candidates.map((candidate) => {
    const qid = candidate.sourceIds.wikidata;
    if (!qid || !byQid.has(qid)) return candidate;
    const mediaSignals = byQid.get(qid)!;
    summary.checked += 1;
    if (mediaSignals.mediaAvailability === "strong") summary.strong += 1;
    else if (mediaSignals.mediaAvailability === "medium") summary.medium += 1;
    else if (mediaSignals.mediaAvailability === "weak") summary.weak += 1;
    else if (mediaSignals.mediaAvailability === "none") summary.none += 1;
    else summary.unknown += 1;
    return {
      ...candidate,
      mediaSignals,
      mediaSignalScore: mediaSignalScoreFromAvailability(mediaSignals.mediaAvailability),
    };
  });

  return { candidates: enriched, summary };
}
