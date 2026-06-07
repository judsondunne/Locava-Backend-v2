import type { AppEnv } from "../../config/env.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import { searchPlaceImages } from "../places/searchPlaceImages.service.js";
import type { ParsedPlaceQuery } from "../../types/places.js";
import type { PbfAssetPreviewItem, PbfPhotoVisionMode } from "../../types/pbfAssetPreview.js";
import { buildOsmSpecificPhotoQuery } from "./buildOsmSpecificPhotoQuery.js";
import { curatePbfAssetPhotos } from "./curatePbfAssetPhotos.js";

const SEARCH_POOL_SIZE = 10;
const MAX_RESULT_IMAGES = 8;
const LOOKUP_RETRY_ATTEMPTS = 1;
const LOOKUP_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientLookupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
}

async function lookupWithRetry(
  parsed: ParsedPlaceQuery,
  env: AppEnv,
): Promise<{ results: Awaited<ReturnType<typeof searchPlaceImages>>["results"]; source: Awaited<ReturnType<typeof searchPlaceImages>>["source"] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= LOOKUP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await searchPlaceImages(parsed, env, { resultLimit: SEARCH_POOL_SIZE });
    } catch (error) {
      lastError = error;
      if (!isTransientLookupError(error) || attempt >= LOOKUP_RETRY_ATTEMPTS) break;
      await sleep(LOOKUP_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Photo lookup failed");
}

export type PbfAssetPreviewSpotStats = {
  lookupMs: number;
  geminiJudged: number;
  geminiRejected: number;
  geminiEnabled: boolean;
  skipped: boolean;
  lookupFailed: boolean;
  lowConfidence: boolean;
  metadataRejected: number;
  resultSetScore: number;
};

export async function processPbfAssetPreviewSpot(
  doc: PbfCopierPreviewDoc,
  params: {
    env: AppEnv;
    geminiApiKey?: string | null;
    visionMode?: PbfPhotoVisionMode;
    strictTitleSourceMatch?: boolean;
  },
): Promise<{ item: PbfAssetPreviewItem; stats: PbfAssetPreviewSpotStats }> {
  const visionMode = params.visionMode ?? "off";
  const strictTitleSourceMatch = params.strictTitleSourceMatch !== false;
  const built = buildOsmSpecificPhotoQuery(doc);
  if (built.skip) {
    return {
      item: {
        ...doc,
        assetPreview: {
          query: built.query,
          querySpecificityScore: built.querySpecificityScore,
          assetStatus: "skipped",
          assetsReady: false,
          resultSetScore: 0,
          rejectedCount: 0,
          acceptedCount: 0,
          topRejectionReasons: [],
          matchedTokens: [],
          missingRequiredTokens: [],
          rejectedPreviews: [],
          strictTitleSourceMatch,
          visionMode,
          provider: "none",
          fetchedAt: new Date().toISOString(),
          externalAssets: [],
          warnings: ["Skipped — query too generic for a safe single lookup."],
          skipReason: built.skipReason ?? "query_too_generic",
          tokens: built.tokens,
          confidenceHints: built.confidenceHints,
        },
      },
      stats: {
        lookupMs: 0,
        geminiJudged: 0,
        geminiRejected: 0,
        geminiEnabled: false,
        skipped: true,
        lookupFailed: false,
        lowConfidence: false,
        metadataRejected: 0,
        resultSetScore: 0,
      },
    };
  }

  const parsed: ParsedPlaceQuery = {
    rawLine: built.query,
    displayName: doc.displayName,
    searchQuery: built.query,
    scoped: false,
  };

  const lookupStarted = Date.now();
  try {
    const { results, source } = await lookupWithRetry(parsed, params.env);
    const curated = await curatePbfAssetPhotos({
      doc,
      query: built,
      rawResults: results,
      env: params.env,
      geminiApiKey: params.geminiApiKey,
      visionMode,
      strictTitleSourceMatch,
    });
    const externalAssets = curated.assets.slice(0, MAX_RESULT_IMAGES);

    return {
      item: {
        ...doc,
        assetPreview: {
          query: built.query,
          querySpecificityScore: built.querySpecificityScore,
          assetStatus: curated.assetStatus,
          assetsReady: curated.assetsReady,
          resultSetScore: curated.resultSetScore,
          rejectedCount: curated.stats.rejectedCount,
          acceptedCount: externalAssets.length,
          topRejectionReasons: curated.topRejectionReasons,
          matchedTokens: curated.matchedTokens,
          missingRequiredTokens: curated.missingRequiredTokens,
          rejectedPreviews: curated.rejectedAssets.slice(0, 8).map((r) => ({
            title: r.title || r.caption,
            sourceDomain: r.sourceDomain,
            sourceUrl: r.sourceUrl,
            rejectReasons: r.rejectReasons,
            metadataScore: r.metadataScore,
          })),
          strictTitleSourceMatch,
          visionMode,
          provider: source,
          fetchedAt: new Date().toISOString(),
          externalAssets,
          warnings: curated.warnings,
          tokens: built.tokens,
          confidenceHints: built.confidenceHints,
        },
      },
      stats: {
        lookupMs: Date.now() - lookupStarted,
        geminiJudged: curated.stats.geminiJudged,
        geminiRejected: curated.stats.geminiRejected,
        geminiEnabled: curated.stats.geminiEnabled,
        skipped: curated.assetStatus === "skipped",
        lookupFailed: false,
        lowConfidence: curated.assetStatus === "low_confidence" || curated.assetStatus === "no_good_match",
        metadataRejected: curated.stats.metadataRejected,
        resultSetScore: curated.resultSetScore,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo lookup failed";
    return {
      item: {
        ...doc,
        assetPreview: {
          query: built.query,
          querySpecificityScore: built.querySpecificityScore,
          assetStatus: "error",
          assetsReady: false,
          resultSetScore: 0,
          rejectedCount: 0,
          acceptedCount: 0,
          topRejectionReasons: [],
          matchedTokens: [],
          missingRequiredTokens: [],
          rejectedPreviews: [],
          strictTitleSourceMatch,
          visionMode,
          provider: "none",
          fetchedAt: new Date().toISOString(),
          externalAssets: [],
          warnings: [message],
          lookupError: message,
          tokens: built.tokens,
          confidenceHints: built.confidenceHints,
        },
      },
      stats: {
        lookupMs: Date.now() - lookupStarted,
        geminiJudged: 0,
        geminiRejected: 0,
        geminiEnabled: false,
        skipped: false,
        lookupFailed: true,
        lowConfidence: false,
        metadataRejected: 0,
        resultSetScore: 0,
      },
    };
  }
}
