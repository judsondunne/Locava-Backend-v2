import type { UsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import type { PlaceCandidateSourceTiming } from "./types.js";
import type { WikidataRawPlaceCandidate } from "./types.js";
import {
  FAST_TARGETED_BUCKET_CONCURRENCY,
  WIKIDATA_FAST_TARGETED_BUCKETS,
  type WikidataFastTargetedBucket,
} from "./wikidataFastTargetedBuckets.js";
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

export type FastTargetedBucketEvent = {
  event: "started" | "done" | "timeout";
  bucketId: string;
  bucketLabel: string;
  bucketPriority: number;
  fetched: number;
  totalSoFar: number;
  elapsedMs: number;
  queryElapsedMs: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  partial?: boolean;
  timeout?: boolean;
};

export type FastTargetedBucketRunResult = {
  bucketId: string;
  label: string;
  priority: number;
  fetched: number;
  timedOut: boolean;
  elapsedMs: number;
  queryElapsedMs: number;
};

function qidFromUri(uri: string): string {
  const match = /\/(Q\d+)$/.exec(uri);
  return match?.[1] ?? uri;
}

function remainingMs(runStartedAt: number, totalTimeoutMs: number): number {
  return Math.max(0, totalTimeoutMs - (Date.now() - runStartedAt));
}

function buildBucketSparqlQuery(stateQid: string, bucket: WikidataFastTargetedBucket, useSubclass: boolean): string {
  const values = bucket.targetQids.map((qid) => `wd:${qid}`).join(" ");
  const typeClause = useSubclass
    ? "?item wdt:P31/wdt:P279* ?targetType ."
    : "?item wdt:P31 ?targetType .";
  return `
SELECT ?item ?itemLabel ?lat ?lon ?type ?typeLabel WHERE {
  VALUES ?targetType { ${values} }
  ${typeClause}
  ?item wdt:P625 ?coord .
  ?item wdt:P131* wd:${stateQid} .
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  OPTIONAL { ?item wdt:P31 ?type . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${Math.max(1, bucket.perBucketLimit)}
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
  bucket: WikidataFastTargetedBucket,
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
    const sourceBucketIds = existing?.sourceBucketIds ? [...existing.sourceBucketIds] : [];
    const sourceBucketLabels = existing?.sourceBucketLabels ? [...existing.sourceBucketLabels] : [];
    const targetedCategoryHints = existing?.targetedCategoryHints ? [...existing.targetedCategoryHints] : [];
    if (!sourceBucketIds.includes(bucket.bucketId)) {
      sourceBucketIds.push(bucket.bucketId);
      sourceBucketLabels.push(bucket.label);
      targetedCategoryHints.push(...bucket.categoryHints);
    }
    if (!existing) fetchedThisBatch += 1;
    grouped.set(qid, {
      source: "wikidata",
      qid,
      name,
      lat,
      lng: lon,
      instanceLabels: [...new Set(instanceLabels)],
      sourceBucketIds: [...new Set(sourceBucketIds)],
      sourceBucketLabels: [...new Set(sourceBucketLabels)],
      targetedCategoryHints: [...new Set(targetedCategoryHints)],
      raw: row,
    });
  }
  return fetchedThisBatch;
}

async function runBucketQuery(
  state: UsStatePlaceConfig,
  bucket: WikidataFastTargetedBucket,
  perQueryTimeoutMs: number,
  signal: AbortSignal,
  onFallback?: (event: { phase: "started" | "done" | "timeout"; elapsedMs: number }) => void,
): Promise<{ bindings: SparqlBinding[]; timedOut: boolean; queryElapsedMs: number }> {
  const queryStartedAt = Date.now();
  const queryTimeoutMs = Math.max(1, perQueryTimeoutMs);
  const fallbackTimeoutMs = Math.min(800, queryTimeoutMs);
  try {
    let bindings = await runSparqlQuery(buildBucketSparqlQuery(state.wikidataQid, bucket, false), queryTimeoutMs, signal);
    if (bindings.length === 0 && !signal.aborted) {
      bindings = await runSparqlQuery(buildBucketSparqlQuery(state.wikidataQid, bucket, true), queryTimeoutMs, signal);
    }
    return { bindings, timedOut: false, queryElapsedMs: Date.now() - queryStartedAt };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    if (!timedOut || signal.aborted) {
      return { bindings: [], timedOut, queryElapsedMs: Date.now() - queryStartedAt };
    }
    onFallback?.({ phase: "started", elapsedMs: Date.now() - queryStartedAt });
    try {
      const bindings = await runSparqlQuery(
        buildBucketSparqlQuery(state.wikidataQid, bucket, false),
        fallbackTimeoutMs,
        signal,
      );
      onFallback?.({ phase: "done", elapsedMs: Date.now() - queryStartedAt });
      return { bindings, timedOut: false, queryElapsedMs: Date.now() - queryStartedAt };
    } catch {
      onFallback?.({ phase: "timeout", elapsedMs: Date.now() - queryStartedAt });
      return { bindings: [], timedOut: true, queryElapsedMs: Date.now() - queryStartedAt };
    }
  }
}

export async function fetchWikidataFastTargetedPlaceCandidates(input: {
  state: UsStatePlaceConfig;
  limit: number;
  totalTimeoutMs: number;
  perQueryTimeoutMs: number;
  concurrency?: number;
  runStartedAt: number;
  signal?: AbortSignal;
  buckets?: WikidataFastTargetedBucket[];
  onBucket?: (event: FastTargetedBucketEvent) => void;
}): Promise<{
  candidates: WikidataRawPlaceCandidate[];
  sourceTimings: PlaceCandidateSourceTiming[];
  bucketRuns: FastTargetedBucketRunResult[];
  partial: boolean;
  timeout: boolean;
  timeoutReason?: string;
  partialReason?: string;
  bucketTimeoutCount: number;
  bucketCompletedCount: number;
  bucketSkippedCount: number;
  limitReached: boolean;
}> {
  const buckets = [...(input.buckets ?? WIKIDATA_FAST_TARGETED_BUCKETS)].sort((a, b) => a.priority - b.priority);
  const concurrency = Math.max(1, input.concurrency ?? FAST_TARGETED_BUCKET_CONCURRENCY);
  const globalController = new AbortController();
  const globalTimeout = setTimeout(() => globalController.abort(), input.totalTimeoutMs);
  const signal = input.signal ?? globalController.signal;
  const grouped = new Map<string, WikidataRawPlaceCandidate>();
  const sourceTimings: PlaceCandidateSourceTiming[] = [];
  const bucketRuns: FastTargetedBucketRunResult[] = [];
  let partial = false;
  let timeout = false;
  let timeoutReason: string | undefined;
  let nextBucketIndex = 0;
  let inFlight = 0;

  const runElapsedMs = () => Date.now() - input.runStartedAt;

  const emitBucket = (event: FastTargetedBucketEvent) => {
    input.onBucket?.(event);
  };

  const runBucket = async (bucket: WikidataFastTargetedBucket): Promise<void> => {
    if (signal.aborted || grouped.size >= input.limit || remainingMs(input.runStartedAt, input.totalTimeoutMs) <= 0) {
      return;
    }
    const queryTimeoutMs = Math.min(
      input.perQueryTimeoutMs,
      remainingMs(input.runStartedAt, input.totalTimeoutMs),
    );
    emitBucket({
      event: "started",
      bucketId: bucket.bucketId,
      bucketLabel: bucket.label,
      bucketPriority: bucket.priority,
      fetched: 0,
      totalSoFar: grouped.size,
      elapsedMs: runElapsedMs(),
      queryElapsedMs: 0,
      totalTimeoutMs: input.totalTimeoutMs,
      perQueryTimeoutMs: input.perQueryTimeoutMs,
    });
    if (queryTimeoutMs <= 0) {
      partial = true;
      timeout = true;
      timeoutReason = "FAST_TARGETED_TOTAL_TIMEOUT";
      emitBucket({
        event: "timeout",
        bucketId: bucket.bucketId,
        bucketLabel: bucket.label,
        bucketPriority: bucket.priority,
        fetched: 0,
        totalSoFar: grouped.size,
        elapsedMs: runElapsedMs(),
        queryElapsedMs: 0,
        totalTimeoutMs: input.totalTimeoutMs,
        perQueryTimeoutMs: input.perQueryTimeoutMs,
        partial: true,
        timeout: true,
      });
      bucketRuns.push({
        bucketId: bucket.bucketId,
        label: bucket.label,
        priority: bucket.priority,
        fetched: 0,
        timedOut: true,
        elapsedMs: runElapsedMs(),
        queryElapsedMs: 0,
      });
      return;
    }

    const result = await runBucketQuery(input.state, bucket, queryTimeoutMs, signal, (fallback) => {
      emitBucket({
        event: fallback.phase === "timeout" ? "timeout" : "done",
        bucketId: bucket.bucketId,
        bucketLabel: `${bucket.label}:fallback`,
        bucketPriority: bucket.priority,
        fetched: 0,
        totalSoFar: grouped.size,
        elapsedMs: runElapsedMs(),
        queryElapsedMs: fallback.elapsedMs,
        totalTimeoutMs: input.totalTimeoutMs,
        perQueryTimeoutMs: input.perQueryTimeoutMs,
        partial: fallback.phase !== "done",
        timeout: fallback.phase === "timeout",
      });
    });
    const fetchedThisBucket = ingestBindings(grouped, result.bindings, bucket);
    const elapsedMs = runElapsedMs();
    sourceTimings.push({
      source: "wikidata",
      mode: "fast_targeted_bucket",
      typeQid: bucket.bucketId,
      typeLabel: bucket.label,
      elapsedMs,
      queryElapsedMs: result.queryElapsedMs,
      fetched: fetchedThisBucket,
      timedOut: result.timedOut,
    });
    bucketRuns.push({
      bucketId: bucket.bucketId,
      label: bucket.label,
      priority: bucket.priority,
      fetched: fetchedThisBucket,
      timedOut: result.timedOut,
      elapsedMs,
      queryElapsedMs: result.queryElapsedMs,
    });
    emitBucket({
      event: result.timedOut ? "timeout" : "done",
      bucketId: bucket.bucketId,
      bucketLabel: bucket.label,
      bucketPriority: bucket.priority,
      fetched: fetchedThisBucket,
      totalSoFar: grouped.size,
      elapsedMs,
      queryElapsedMs: result.queryElapsedMs,
      totalTimeoutMs: input.totalTimeoutMs,
      perQueryTimeoutMs: input.perQueryTimeoutMs,
      partial: result.timedOut,
      timeout: result.timedOut,
    });
    if (result.timedOut) {
      partial = true;
    }
  };

  try {
    await new Promise<void>((resolve) => {
      const scheduleNext = () => {
        if (signal.aborted || grouped.size >= input.limit || remainingMs(input.runStartedAt, input.totalTimeoutMs) <= 0) {
          if (inFlight === 0) resolve();
          return;
        }
        while (
          inFlight < concurrency &&
          nextBucketIndex < buckets.length &&
          grouped.size < input.limit &&
          remainingMs(input.runStartedAt, input.totalTimeoutMs) > 0 &&
          !signal.aborted
        ) {
          const bucket = buckets[nextBucketIndex]!;
          nextBucketIndex += 1;
          inFlight += 1;
          void runBucket(bucket).finally(() => {
            inFlight -= 1;
            scheduleNext();
          });
        }
        if (inFlight === 0 && (nextBucketIndex >= buckets.length || signal.aborted)) {
          resolve();
        }
      };
      scheduleNext();
    });

    if (signal.aborted || remainingMs(input.runStartedAt, input.totalTimeoutMs) <= 0) {
      partial = true;
      timeout = true;
      timeoutReason = timeoutReason ?? "FAST_TARGETED_TOTAL_TIMEOUT";
    }

    const bucketTimeoutCount = bucketRuns.filter((row) => row.timedOut).length;
    const bucketCompletedCount = bucketRuns.filter((row) => !row.timedOut).length;
    const bucketSkippedCount = Math.max(0, buckets.length - bucketRuns.length);
    const limitReached = grouped.size >= input.limit;
    let partialReason: string | undefined;
    if (timeout) partialReason = "TOTAL_TIMEOUT";
    else if (bucketTimeoutCount > 0 && limitReached) partialReason = "LIMIT_REACHED_BEFORE_ALL_BUCKETS";
    else if (bucketTimeoutCount > 0) partialReason = "SOME_BUCKETS_TIMED_OUT";
    else if (limitReached && bucketSkippedCount > 0) partialReason = "LIMIT_REACHED_BEFORE_ALL_BUCKETS";

    return {
      candidates: [...grouped.values()].slice(0, Math.max(0, Math.min(input.limit, 200))),
      sourceTimings,
      bucketRuns,
      partial: partial || Boolean(partialReason),
      timeout,
      timeoutReason,
      partialReason,
      bucketTimeoutCount,
      bucketCompletedCount,
      bucketSkippedCount,
      limitReached,
    };
  } finally {
    clearTimeout(globalTimeout);
  }
}
