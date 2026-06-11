import type { AppEnv } from "../../config/env.js";
import type {
  UndiscoveredPhotoSearchBody,
  UndiscoveredPhotoSearchResponse,
} from "../../contracts/surfaces/undiscovered-photo-search.contract.js";
import { UNDISCOVERED_PHOTO_SEARCH_DISCLAIMER } from "../../contracts/surfaces/undiscovered-photo-search.contract.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { processPbfAssetPreviewSpot } from "../../lib/pbf/pbfAssetPreviewSpot.js";
import {
  checkUndiscoveredPhotoSearchGlobalProviderBudget,
  checkUndiscoveredPhotoSearchViewerBudget,
  isUndiscoveredPhotoSearchEnabled,
} from "../../lib/undiscovered/undiscoveredPhotoSearchBudget.js";
import {
  buildRefreshingPhotoSearchCache,
  isPhotoSearchCacheValid,
  isPhotoSearchRefreshingLeaseFresh,
  mapAssetPreviewToPhotoSearchCache,
  selectPhotoSearchResponseItems,
} from "../../lib/undiscovered/undiscoveredPhotoSearchMapper.js";
import {
  readUndiscoveredDisplayMeta,
  unexploredDocToPbfPreviewDoc,
} from "../../lib/undiscovered/unexploredDocToPbfPreviewDoc.js";
import {
  getUnexploredDocForPhotoSearch,
  readUnexploredPhotoSearchAfterRefresh,
  writeUnexploredPhotoSearch,
} from "../../repositories/source-of-truth/unexplored-photo-search-firestore.adapter.js";

const REFRESH_POLL_ATTEMPTS = 20;
const REFRESH_POLL_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPhotoSearch(event: string, fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      event,
      feature: "undiscovered_photo_search",
      ...fields,
    }),
  );
}

function buildResponse(input: {
  collection: UndiscoveredPhotoSearchBody["collection"];
  id: string;
  doc: Record<string, unknown>;
  fallback?: UndiscoveredPhotoSearchBody;
  cache: ReturnType<typeof mapAssetPreviewToPhotoSearchCache>;
  cached: boolean;
  cacheStatus: UndiscoveredPhotoSearchResponse["cacheStatus"];
}): UndiscoveredPhotoSearchResponse {
  const meta = readUndiscoveredDisplayMeta(input.doc, input.fallback);
  return {
    routeName: "undiscovered.photo_search.post",
    schema: "locava.undiscoveredPhotoSearch",
    version: 1,
    cached: input.cached,
    cacheStatus: input.cacheStatus,
    undiscovered: {
      collection: input.collection,
      id: input.id,
      title: meta.title,
      town: meta.town,
      state: meta.state,
    },
    query: input.cache.query,
    items: selectPhotoSearchResponseItems(input.cache),
    disclaimer: UNDISCOVERED_PHOTO_SEARCH_DISCLAIMER,
  };
}

async function waitForRefreshedCache(
  collection: UndiscoveredPhotoSearchBody["collection"],
  id: string,
): Promise<ReturnType<typeof mapAssetPreviewToPhotoSearchCache> | null> {
  for (let attempt = 0; attempt < REFRESH_POLL_ATTEMPTS; attempt += 1) {
    await sleep(REFRESH_POLL_DELAY_MS);
    const cache = await readUnexploredPhotoSearchAfterRefresh(collection, id);
    if (cache && cache.status !== "refreshing") {
      return cache;
    }
  }
  return null;
}

async function runProviderSearch(input: {
  env: AppEnv;
  collection: UndiscoveredPhotoSearchBody["collection"];
  doc: Record<string, unknown>;
  fallback?: UndiscoveredPhotoSearchBody;
}): Promise<ReturnType<typeof mapAssetPreviewToPhotoSearchCache>> {
  const previewDoc = unexploredDocToPbfPreviewDoc({
    collection: input.collection,
    doc: input.doc,
    fallback: input.fallback,
  });

  const { item } = await processPbfAssetPreviewSpot(previewDoc, {
    env: input.env,
    visionMode: "off",
    strictTitleSourceMatch: false,
    scoringProfile: "undiscovered_app",
  });

  return mapAssetPreviewToPhotoSearchCache({
    query: item.assetPreview.query,
    provider: item.assetPreview.provider,
    assetStatus: item.assetPreview.assetStatus,
    externalAssets: item.assetPreview.externalAssets,
    lookupError: item.assetPreview.lookupError,
    fetchedAt: item.assetPreview.fetchedAt,
  });
}

async function refreshPhotoSearch(input: {
  env: AppEnv;
  collection: UndiscoveredPhotoSearchBody["collection"];
  id: string;
  doc: Record<string, unknown>;
  fallback?: UndiscoveredPhotoSearchBody;
  requestKey: string;
  forceRefresh: boolean;
}): Promise<{
  cache: ReturnType<typeof mapAssetPreviewToPhotoSearchCache>;
  cacheStatus: UndiscoveredPhotoSearchResponse["cacheStatus"];
  cached: boolean;
}> {
  return dedupeInFlight(`undiscovered:photoSearch:${input.collection}:${input.id}`, async () => {
    const latestDoc = (await getUnexploredDocForPhotoSearch(input.collection, input.id)) ?? input.doc;
    const existing = latestDoc.photoSearch as ReturnType<typeof mapAssetPreviewToPhotoSearchCache> | undefined;

    if (isPhotoSearchCacheValid(existing, input.forceRefresh)) {
      return {
        cache: existing!,
        cacheStatus: "hit",
        cached: true,
      };
    }

    if (isPhotoSearchRefreshingLeaseFresh(existing)) {
      const waited = await waitForRefreshedCache(input.collection, input.id);
      if (waited) {
        return {
          cache: waited,
          cacheStatus: waited.status === "ready" ? "hit" : waited.status === "empty" ? "empty" : "failed",
          cached: true,
        };
      }
    }

    if (!checkUndiscoveredPhotoSearchGlobalProviderBudget()) {
      const failed = mapAssetPreviewToPhotoSearchCache({
        query: existing?.query ?? "",
        provider: "none",
        assetStatus: "error",
        externalAssets: [],
        lookupError: "Daily provider budget exceeded",
      });
      failed.error = { code: "budget_exceeded", message: "Daily provider budget exceeded" };
      return { cache: failed, cacheStatus: "failed", cached: false };
    }

    const previewDoc = unexploredDocToPbfPreviewDoc({
      collection: input.collection,
      doc: latestDoc,
      fallback: input.fallback,
    });
    const refreshing = buildRefreshingPhotoSearchCache(previewDoc.displayName);
    await writeUnexploredPhotoSearch(input.collection, input.id, refreshing);

    logPhotoSearch("undiscovered_photo_search_provider_call", {
      requestKey: input.requestKey,
      docId: input.id,
      collection: input.collection,
      cacheStatus: input.forceRefresh ? "refreshed" : "miss",
      providerCall: true,
      validator: "none",
    });

    const cache = await runProviderSearch({
      env: input.env,
      collection: input.collection,
      doc: latestDoc,
      fallback: input.fallback,
    });

    try {
      await writeUnexploredPhotoSearch(input.collection, input.id, cache);
    } catch (writeError) {
      logPhotoSearch("undiscovered_photo_search_cache_write_failed", {
        requestKey: input.requestKey,
        docId: input.id,
        collection: input.collection,
        message: writeError instanceof Error ? writeError.message : String(writeError),
      });
    }

    logPhotoSearch("undiscovered_photo_search_complete", {
      requestKey: input.requestKey,
      docId: input.id,
      collection: input.collection,
      cacheStatus: input.forceRefresh ? "refreshed" : "miss",
      providerCall: true,
      resultCount: cache.resultCount,
      status: cache.status,
      validator: "none",
    });

    return {
      cache,
      cacheStatus:
        cache.status === "ready"
          ? input.forceRefresh
            ? "refreshed"
            : "miss"
          : cache.status === "empty"
            ? "empty"
            : "failed",
      cached: false,
    };
  });
}

export async function searchPlaceWebImagesForUndiscovered(input: {
  env: AppEnv;
  body: UndiscoveredPhotoSearchBody;
  viewerId: string;
}): Promise<
  | { ok: true; response: UndiscoveredPhotoSearchResponse }
  | { ok: false; code: string; message: string; statusCode: number }
> {
  if (!isUndiscoveredPhotoSearchEnabled()) {
    return {
      ok: false,
      code: "feature_disabled",
      message: "Undiscovered photo search is disabled",
      statusCode: 503,
    };
  }

  if (!checkUndiscoveredPhotoSearchViewerBudget(input.viewerId)) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Too many photo search requests. Please try again shortly.",
      statusCode: 429,
    };
  }

  const { collection, id, forceRefresh = false } = input.body;
  const requestKey = `${collection}:${id}`;

  const doc = await getUnexploredDocForPhotoSearch(collection, id);
  if (!doc) {
    return {
      ok: false,
      code: "item_not_found",
      message: "Undiscovered item was not found",
      statusCode: 404,
    };
  }

  const existing = doc.photoSearch as ReturnType<typeof mapAssetPreviewToPhotoSearchCache> | undefined;
  if (isPhotoSearchCacheValid(existing, forceRefresh)) {
    logPhotoSearch("undiscovered_photo_search_cache_hit", {
      requestKey,
      docId: id,
      collection,
      cacheStatus: "hit",
      providerCall: false,
      resultCount: existing?.resultCount ?? 0,
      validator: existing?.validator ?? "none",
    });
    return {
      ok: true,
      response: buildResponse({
        collection,
        id,
        doc,
        fallback: input.body,
        cache: existing!,
        cached: true,
        cacheStatus: existing!.status === "ready" ? "hit" : existing!.status === "empty" ? "empty" : "failed",
      }),
    };
  }

  const refreshed = await refreshPhotoSearch({
    env: input.env,
    collection,
    id,
    doc,
    fallback: input.body,
    requestKey,
    forceRefresh,
  });

  return {
    ok: true,
    response: buildResponse({
      collection,
      id,
      doc,
      fallback: input.body,
      cache: refreshed.cache,
      cached: refreshed.cached,
      cacheStatus: refreshed.cacheStatus,
    }),
  };
}
