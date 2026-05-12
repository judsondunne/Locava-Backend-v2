import type { UsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import type { PlaceCandidateSourceTiming } from "./types.js";
import type { WikidataRawPlaceCandidate } from "./types.js";
import {
  USEFUL_INSTANCE_TYPE_QIDS,
  wikidataTypeLabel,
} from "./wikidataInstanceTypeLabels.js";

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIDATA_UA = "LocavaPlaceCandidateMvp/1.0 (dev-only; https://locava.com)";
const DEEP_DISCOVERY_PER_TYPE_CONCURRENCY = 3;

const PRIORITY_TYPE_QIDS = [
  "Q46169",
  "Q34038",
  "Q40080",
  "Q570116",
  "Q12280",
  "Q8502",
  "Q23397",
  "Q4022",
  "Q4989906",
  "Q39614",
  "Q35509",
  "Q207386",
  "Q23413",
  "Q109607",
  "Q179049",
  "Q33506",
  "Q442418",
  "Q1071106",
  "Q1107656",
  "Q2267495",
  "Q39715",
  "Q860861",
  "Q41176",
].filter((qid) => USEFUL_INSTANCE_TYPE_QIDS.includes(qid as (typeof USEFUL_INSTANCE_TYPE_QIDS)[number]));

type SparqlBinding = {
  item?: { value: string };
  itemLabel?: { value: string };
  lat?: { value: string };
  lon?: { value: string };
  article?: { value: string };
  commonsCategory?: { value: string };
  image?: { value: string };
  type?: { value: string };
  typeLabel?: { value: string };
};

type SparqlResponse = {
  results?: { bindings?: SparqlBinding[] };
};

export type WikidataFetchProgress = {
  typeQid: string;
  typeLabel: string;
  fetchedThisType: number;
  totalSoFar: number;
  typeIndex: number;
  typeCount: number;
  elapsedMs: number;
  phase: "starting" | "done" | "failed";
};

export type WikidataQueryEvent = {
  event: "started" | "done" | "timeout";
  mode: "batched" | "per_type";
  typeQid?: string;
  typeLabel?: string;
  elapsedMs: number;
  queryElapsedMs?: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  fetched?: number;
};

function qidFromUri(uri: string): string {
  const match = /\/(Q\d+)$/.exec(uri);
  return match?.[1] ?? uri;
}

function commonsCategoryFromUri(uri: string): string | undefined {
  const match = /Category:(.+)$/.exec(decodeURIComponent(uri));
  return match?.[1]?.replace(/_/g, " ");
}

function buildBatchedSparqlQuery(stateQid: string, limit: number): string {
  const values = USEFUL_INSTANCE_TYPE_QIDS.map((qid) => `wd:${qid}`).join(" ");
  return `
SELECT ?item ?itemLabel ?lat ?lon ?type ?typeLabel WHERE {
  VALUES ?type { ${values} }
  ?item wdt:P31 ?type .
  ?item wdt:P131* wd:${stateQid} .
  ?item wdt:P625 ?coord .
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  ?type rdfs:label ?typeLabel .
  FILTER(LANG(?typeLabel) = "en")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${Math.max(1, Math.min(limit * 2, 500))}
`.trim();
}

function buildSparqlQuery(stateQid: string, typeQid: string, limit: number): string {
  return `
SELECT ?item ?itemLabel ?lat ?lon ?type ?typeLabel WHERE {
  BIND(wd:${typeQid} AS ?type)
  ?item wdt:P31 ?type .
  ?item wdt:P131* wd:${stateQid} .
  ?item wdt:P625 ?coord .
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  ?type rdfs:label ?typeLabel .
  FILTER(LANG(?typeLabel) = "en")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${Math.max(1, Math.min(limit, 200))}
`.trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingMs(runStartedAt: number, totalTimeoutMs: number): number {
  return Math.max(0, totalTimeoutMs - (Date.now() - runStartedAt));
}

async function runSparqlQuery(query: string, timeoutMs: number, signal?: AbortSignal): Promise<SparqlBinding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const linked = () => controller.abort();
  signal?.addEventListener("abort", linked, { once: true });
  let lastError: Error | null = null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(WIKIDATA_SPARQL_ENDPOINT, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "user-agent": WIKIDATA_UA,
            accept: "application/sparql-results+json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ format: "json", query }).toString(),
        });
        if (!res.ok) {
          throw new Error(`wikidata_sparql_http_${res.status}`);
        }
        const data = (await res.json()) as SparqlResponse;
        return data.results?.bindings ?? [];
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (controller.signal.aborted) break;
        await sleep(300 * (attempt + 1));
      }
    }
    throw lastError ?? new Error("wikidata_sparql_failed");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", linked);
  }
}

function ingestBindings(
  grouped: Map<string, WikidataRawPlaceCandidate>,
  bindings: SparqlBinding[],
  fallbackTypeQid?: string,
): number {
  let fetchedThisBatch = 0;
  for (const row of bindings) {
    const qid = qidFromUri(String(row.item?.value || ""));
    if (!qid.startsWith("Q")) continue;
    const lat = Number(row.lat?.value);
    const lon = Number(row.lon?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = String(row.itemLabel?.value || "").trim();
    if (!name) continue;
    const existing = grouped.get(qid);
    const typeLabel = String(
      row.typeLabel?.value || wikidataTypeLabel(fallbackTypeQid || qidFromUri(String(row.type?.value || ""))),
    ).trim();
    const instanceLabels = existing ? [...existing.instanceLabels] : [];
    if (typeLabel) instanceLabels.push(typeLabel);
    if (!existing) fetchedThisBatch += 1;
    grouped.set(qid, {
      source: "wikidata",
      qid,
      name,
      lat,
      lng: lon,
      instanceLabels: [...new Set(instanceLabels)],
      wikipediaUrl: row.article?.value || existing?.wikipediaUrl,
      commonsCategory:
        (row.commonsCategory?.value ? commonsCategoryFromUri(row.commonsCategory.value) : undefined) ||
        existing?.commonsCategory,
      imageField: row.image?.value || existing?.imageField,
      raw: row,
    });
  }
  return fetchedThisBatch;
}

async function fetchBatched(
  state: UsStatePlaceConfig,
  limit: number,
  signal: AbortSignal,
  runStartedAt: number,
  totalTimeoutMs: number,
  perQueryTimeoutMs: number,
  onQuery?: (event: WikidataQueryEvent) => void,
): Promise<{ bindings: SparqlBinding[]; timing: PlaceCandidateSourceTiming }> {
  const queryStartedAt = Date.now();
  onQuery?.({
    event: "started",
    mode: "batched",
    elapsedMs: Date.now() - runStartedAt,
    queryElapsedMs: 0,
    totalTimeoutMs,
    perQueryTimeoutMs,
  });
  try {
    const queryTimeoutMs = Math.min(perQueryTimeoutMs, remainingMs(runStartedAt, totalTimeoutMs));
    const bindings = await runSparqlQuery(buildBatchedSparqlQuery(state.wikidataQid, limit), queryTimeoutMs, signal);
    const queryElapsedMs = Date.now() - queryStartedAt;
    const timing: PlaceCandidateSourceTiming = {
      source: "wikidata",
      mode: "batched",
      elapsedMs: Date.now() - runStartedAt,
      queryElapsedMs,
      fetched: bindings.length,
    };
    onQuery?.({
      event: "done",
      mode: "batched",
      elapsedMs: timing.elapsedMs,
      queryElapsedMs,
      totalTimeoutMs,
      perQueryTimeoutMs,
      fetched: timing.fetched,
    });
    return { bindings, timing };
  } catch (error) {
    const queryElapsedMs = Date.now() - queryStartedAt;
    const elapsedMs = Date.now() - runStartedAt;
    const timedOut = error instanceof Error && error.name === "AbortError";
    onQuery?.({
      event: timedOut ? "timeout" : "done",
      mode: "batched",
      elapsedMs,
      queryElapsedMs,
      totalTimeoutMs,
      perQueryTimeoutMs,
      fetched: 0,
    });
    throw error;
  }
}

async function fetchPerTypeConcurrent(
  state: UsStatePlaceConfig,
  limit: number,
  signal: AbortSignal,
  grouped: Map<string, WikidataRawPlaceCandidate>,
  runStartedAt: number,
  totalTimeoutMs: number,
  perQueryTimeoutMs: number,
  onProgress?: (progress: WikidataFetchProgress) => void,
  onQuery?: (event: WikidataQueryEvent) => void,
): Promise<PlaceCandidateSourceTiming[]> {
  const perTypeLimit = Math.max(8, Math.ceil(limit / 8));
  const timings: PlaceCandidateSourceTiming[] = [];
  let nextTypeIndex = 0;
  let inFlight = 0;
  let stopped = false;

  const runType = async (typeIndex: number): Promise<void> => {
    if (stopped || signal.aborted || grouped.size >= limit || remainingMs(runStartedAt, totalTimeoutMs) <= 0) {
      return;
    }
    const typeQid = PRIORITY_TYPE_QIDS[typeIndex]!;
    const typeLabel = wikidataTypeLabel(typeQid);
    const queryStartedAt = Date.now();
    onQuery?.({
      event: "started",
      mode: "per_type",
      typeQid,
      typeLabel,
      elapsedMs: Date.now() - runStartedAt,
      queryElapsedMs: 0,
      totalTimeoutMs,
      perQueryTimeoutMs,
    });
    onProgress?.({
      typeQid,
      typeLabel,
      fetchedThisType: 0,
      totalSoFar: grouped.size,
      typeIndex: typeIndex + 1,
      typeCount: PRIORITY_TYPE_QIDS.length,
      elapsedMs: Date.now() - runStartedAt,
      phase: "starting",
    });
    let fetchedThisType = 0;
    let timedOut = false;
    try {
      const queryTimeoutMs = Math.min(perQueryTimeoutMs, remainingMs(runStartedAt, totalTimeoutMs));
      const bindings = await runSparqlQuery(
        buildSparqlQuery(state.wikidataQid, typeQid, perTypeLimit),
        queryTimeoutMs,
        signal,
      );
      fetchedThisType = ingestBindings(grouped, bindings, typeQid);
    } catch (error) {
      timedOut = error instanceof Error && error.name === "AbortError";
      const queryElapsedMs = Date.now() - queryStartedAt;
      onQuery?.({
        event: timedOut ? "timeout" : "done",
        mode: "per_type",
        typeQid,
        typeLabel,
        elapsedMs: Date.now() - runStartedAt,
        queryElapsedMs,
        totalTimeoutMs,
        perQueryTimeoutMs,
        fetched: 0,
      });
      onProgress?.({
        typeQid,
        typeLabel,
        fetchedThisType: 0,
        totalSoFar: grouped.size,
        typeIndex: typeIndex + 1,
        typeCount: PRIORITY_TYPE_QIDS.length,
        elapsedMs: Date.now() - runStartedAt,
        phase: "failed",
      });
      return;
    }
    const queryElapsedMs = Date.now() - queryStartedAt;
    const elapsedMs = Date.now() - runStartedAt;
    timings.push({
      source: "wikidata",
      mode: "per_type",
      typeQid,
      typeLabel,
      elapsedMs,
      queryElapsedMs,
      fetched: fetchedThisType,
      timedOut,
    });
    onQuery?.({
      event: "done",
      mode: "per_type",
      typeQid,
      typeLabel,
      elapsedMs,
      queryElapsedMs,
      totalTimeoutMs,
      perQueryTimeoutMs,
      fetched: fetchedThisType,
    });
    onProgress?.({
      typeQid,
      typeLabel,
      fetchedThisType,
      totalSoFar: grouped.size,
      typeIndex: typeIndex + 1,
      typeCount: PRIORITY_TYPE_QIDS.length,
      elapsedMs,
      phase: "done",
    });
    await sleep(120);
  };

  await new Promise<void>((resolve) => {
    const scheduleNext = () => {
      if (stopped || signal.aborted || grouped.size >= limit || remainingMs(runStartedAt, totalTimeoutMs) <= 0) {
        if (inFlight === 0) resolve();
        return;
      }
      while (
        inFlight < DEEP_DISCOVERY_PER_TYPE_CONCURRENCY &&
        nextTypeIndex < PRIORITY_TYPE_QIDS.length &&
        !stopped &&
        !signal.aborted &&
        grouped.size < limit &&
        remainingMs(runStartedAt, totalTimeoutMs) > 0
      ) {
        const typeIndex = nextTypeIndex;
        nextTypeIndex += 1;
        inFlight += 1;
        void runType(typeIndex).finally(() => {
          inFlight -= 1;
          scheduleNext();
        });
      }
      if (inFlight === 0 && (nextTypeIndex >= PRIORITY_TYPE_QIDS.length || stopped || signal.aborted)) {
        resolve();
      }
    };
    scheduleNext();
  });

  return timings;
}

export async function fetchWikidataPlaceCandidatesDeepDiscovery(input: {
  state: UsStatePlaceConfig;
  limit: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  runStartedAt: number;
  signal?: AbortSignal;
  onProgress?: (progress: WikidataFetchProgress) => void;
  onQuery?: (event: WikidataQueryEvent) => void;
}): Promise<{
  candidates: WikidataRawPlaceCandidate[];
  sourceTimings: PlaceCandidateSourceTiming[];
  partial: boolean;
  timeout: boolean;
  timeoutReason?: string;
}> {
  const globalController = new AbortController();
  const globalTimeout = setTimeout(() => globalController.abort(), input.totalTimeoutMs);
  const signal = input.signal ?? globalController.signal;
  const grouped = new Map<string, WikidataRawPlaceCandidate>();
  const sourceTimings: PlaceCandidateSourceTiming[] = [];
  let partial = false;
  let timeout = false;
  let timeoutReason: string | undefined;

  try {
    try {
      const batched = await fetchBatched(
        input.state,
        input.limit,
        signal,
        input.runStartedAt,
        input.totalTimeoutMs,
        input.perQueryTimeoutMs,
        input.onQuery,
      );
      sourceTimings.push(batched.timing);
      ingestBindings(grouped, batched.bindings);
      input.onProgress?.({
        typeQid: "batched",
        typeLabel: "batched_values",
        fetchedThisType: batched.bindings.length,
        totalSoFar: grouped.size,
        typeIndex: 1,
        typeCount: 1,
        elapsedMs: batched.timing.elapsedMs,
        phase: "done",
      });
    } catch {
      if (signal.aborted || remainingMs(input.runStartedAt, input.totalTimeoutMs) <= 0) {
        partial = true;
        timeout = true;
        timeoutReason = "DEEP_DISCOVERY_TOTAL_TIMEOUT";
      } else {
        const fallbackTimings = await fetchPerTypeConcurrent(
          input.state,
          input.limit,
          signal,
          grouped,
          input.runStartedAt,
          input.totalTimeoutMs,
          input.perQueryTimeoutMs,
          input.onProgress,
          input.onQuery,
        );
        sourceTimings.push(...fallbackTimings);
        input.onQuery?.({
          event: "done",
          mode: "per_type",
          elapsedMs: Date.now() - input.runStartedAt,
          totalTimeoutMs: input.totalTimeoutMs,
          perQueryTimeoutMs: input.perQueryTimeoutMs,
          fetched: grouped.size,
        });
        if (fallbackTimings.some((row) => row.timedOut) || signal.aborted) {
          partial = true;
        }
      }
    }

    if (signal.aborted || remainingMs(input.runStartedAt, input.totalTimeoutMs) <= 0) {
      partial = true;
      timeout = true;
      timeoutReason = timeoutReason ?? "DEEP_DISCOVERY_TOTAL_TIMEOUT";
    }

    if (grouped.size === 0 && !partial) {
      throw new Error("wikidata_sparql_no_results");
    }

    return {
      candidates: [...grouped.values()].slice(0, Math.max(1, Math.min(input.limit, 1000))),
      sourceTimings,
      partial,
      timeout,
      timeoutReason,
    };
  } finally {
    clearTimeout(globalTimeout);
  }
}
