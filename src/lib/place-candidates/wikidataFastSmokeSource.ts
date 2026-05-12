import type { UsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import type { PlaceCandidateSourceTiming } from "./types.js";
import type { WikidataRawPlaceCandidate } from "./types.js";
import { wikidataTypeLabel } from "./wikidataInstanceTypeLabels.js";

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIDATA_UA = "LocavaPlaceCandidateMvp/1.0 (dev-only; https://locava.com)";

type SparqlBinding = {
  item?: { value: string };
  itemLabel?: { value: string };
  lat?: { value: string };
  lon?: { value: string };
  type?: { value: string };
  typeLabel?: { value: string };
};

type SparqlResponse = {
  results?: { bindings?: SparqlBinding[] };
};

export type WikidataFastSmokeQueryEvent = {
  event: "started" | "done" | "timeout";
  mode: "fast_smoke" | "fast_smoke_minimal";
  elapsedMs: number;
  queryElapsedMs: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  fetched?: number;
};

function qidFromUri(uri: string): string {
  const match = /\/(Q\d+)$/.exec(uri);
  return match?.[1] ?? uri;
}

function buildFastSmokeSparqlQuery(stateQid: string, limit: number): string {
  return `
SELECT ?item ?itemLabel ?lat ?lon ?type ?typeLabel WHERE {
  ?item wdt:P625 ?coord .
  ?item wdt:P131* wd:${stateQid} .
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  OPTIONAL { ?item wdt:P31 ?type . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${Math.max(1, Math.min(limit, 100))}
`.trim();
}

function buildMinimalFastSmokeSparqlQuery(stateQid: string, limit: number): string {
  return `
SELECT ?item ?itemLabel ?lat ?lon WHERE {
  ?item wdt:P625 ?coord .
  ?item wdt:P131* wd:${stateQid} .
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${Math.max(1, Math.min(limit, 100))}
`.trim();
}

async function runSparqlQuery(query: string, timeoutMs: number, signal?: AbortSignal): Promise<SparqlBinding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const linked = () => controller.abort();
  signal?.addEventListener("abort", linked, { once: true });
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
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", linked);
  }
}

function ingestBindings(
  grouped: Map<string, WikidataRawPlaceCandidate>,
  bindings: SparqlBinding[],
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
    const typeLabel = String(row.typeLabel?.value || wikidataTypeLabel(qidFromUri(String(row.type?.value || "")))).trim();
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
      raw: row,
    });
  }
  return fetchedThisBatch;
}

function remainingMs(runStartedAt: number, totalTimeoutMs: number): number {
  return Math.max(0, totalTimeoutMs - (Date.now() - runStartedAt));
}

export async function fetchWikidataFastSmokePlaceCandidates(input: {
  state: UsStatePlaceConfig;
  limit: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  runStartedAt: number;
  signal?: AbortSignal;
  onQuery?: (event: WikidataFastSmokeQueryEvent) => void;
}): Promise<{
  candidates: WikidataRawPlaceCandidate[];
  sourceTimings: PlaceCandidateSourceTiming[];
  partial: boolean;
  timeout: boolean;
  timeoutReason?: string;
}> {
  const grouped = new Map<string, WikidataRawPlaceCandidate>();
  const sourceTimings: PlaceCandidateSourceTiming[] = [];
  const globalController = new AbortController();
  const globalTimeout = setTimeout(() => globalController.abort(), input.totalTimeoutMs);
  const signal = input.signal ?? globalController.signal;
  let partial = false;
  let timeout = false;
  let timeoutReason: string | undefined;

  const runElapsedMs = () => Date.now() - input.runStartedAt;

  const runQuery = async (
    mode: "fast_smoke" | "fast_smoke_minimal",
    query: string,
  ): Promise<{ bindings: SparqlBinding[]; timedOut: boolean }> => {
    const queryStartedAt = Date.now();
    const elapsedMs = runElapsedMs();
    const queryTimeoutMs = Math.min(
      input.perQueryTimeoutMs,
      remainingMs(input.runStartedAt, input.totalTimeoutMs),
    );
    input.onQuery?.({
      event: "started",
      mode,
      elapsedMs,
      queryElapsedMs: 0,
      totalTimeoutMs: input.totalTimeoutMs,
      perQueryTimeoutMs: input.perQueryTimeoutMs,
    });
    if (queryTimeoutMs <= 0 || signal.aborted) {
      input.onQuery?.({
        event: "timeout",
        mode,
        elapsedMs: runElapsedMs(),
        queryElapsedMs: Date.now() - queryStartedAt,
        totalTimeoutMs: input.totalTimeoutMs,
        perQueryTimeoutMs: input.perQueryTimeoutMs,
        fetched: 0,
      });
      return { bindings: [], timedOut: true };
    }
    try {
      const bindings = await runSparqlQuery(query, queryTimeoutMs, signal);
      const queryElapsedMs = Date.now() - queryStartedAt;
      sourceTimings.push({
        source: "wikidata",
        mode,
        elapsedMs: runElapsedMs(),
        queryElapsedMs,
        fetched: bindings.length,
      });
      input.onQuery?.({
        event: "done",
        mode,
        elapsedMs: runElapsedMs(),
        queryElapsedMs,
        totalTimeoutMs: input.totalTimeoutMs,
        perQueryTimeoutMs: input.perQueryTimeoutMs,
        fetched: bindings.length,
      });
      return { bindings, timedOut: false };
    } catch (error) {
      const queryElapsedMs = Date.now() - queryStartedAt;
      const timedOut = error instanceof Error && error.name === "AbortError";
      sourceTimings.push({
        source: "wikidata",
        mode,
        elapsedMs: runElapsedMs(),
        queryElapsedMs,
        fetched: 0,
        timedOut,
      });
      input.onQuery?.({
        event: timedOut ? "timeout" : "done",
        mode,
        elapsedMs: runElapsedMs(),
        queryElapsedMs,
        totalTimeoutMs: input.totalTimeoutMs,
        perQueryTimeoutMs: input.perQueryTimeoutMs,
        fetched: 0,
      });
      return { bindings: [], timedOut };
    }
  };

  try {
    const primary = await runQuery("fast_smoke", buildFastSmokeSparqlQuery(input.state.wikidataQid, input.limit));
    ingestBindings(grouped, primary.bindings);
    if (primary.timedOut && grouped.size === 0 && remainingMs(input.runStartedAt, input.totalTimeoutMs) > 0) {
      const minimal = await runQuery(
        "fast_smoke_minimal",
        buildMinimalFastSmokeSparqlQuery(input.state.wikidataQid, input.limit),
      );
      ingestBindings(grouped, minimal.bindings);
      if (minimal.timedOut) {
        partial = true;
        timeout = true;
        timeoutReason = "FAST_SMOKE_TOTAL_TIMEOUT";
      }
    } else if (primary.timedOut) {
      partial = true;
      timeout = true;
      timeoutReason = "FAST_SMOKE_TOTAL_TIMEOUT";
    }

    if (signal.aborted || remainingMs(input.runStartedAt, input.totalTimeoutMs) <= 0) {
      partial = true;
      timeout = true;
      timeoutReason = timeoutReason ?? "FAST_SMOKE_TOTAL_TIMEOUT";
    }

    return {
      candidates: [...grouped.values()].slice(0, Math.max(0, Math.min(input.limit, 100))),
      sourceTimings,
      partial,
      timeout,
      timeoutReason,
    };
  } finally {
    clearTimeout(globalTimeout);
  }
}
