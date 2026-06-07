import type { AppEnv } from "../../config/env.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { PlaceImageResult } from "../../types/places.js";
import type { PbfAssetPreviewExternalAsset } from "../../types/pbfAssetPreview.js";
import type { OsmPhotoQueryResult } from "./buildOsmSpecificPhotoQuery.js";
import {
  judgePbfAssetPhotoWithGemini,
  shouldRejectByGeminiJudgment,
} from "./pbfAssetPhotoGeminiJudge.js";
import { resolvePbfAssetGeminiConfig } from "./resolvePbfAssetGeminiConfig.js";
import {
  scorePhotoSearchResultsForPlace,
  type PbfPhotoVisionMode,
} from "./scorePhotoSearchResultsForPlace.js";

const DISPLAY_MAX = 8;
const GEMINI_CONFIRM_MAX = 2;

export type PbfAssetCurationStats = {
  rawCount: number;
  metadataRejected: number;
  geminiJudged: number;
  geminiRejected: number;
  geminiEnabled: boolean;
  geminiKeySource: string | null;
  resultSetScore: number;
  rejectedCount: number;
};

export async function curatePbfAssetPhotos(input: {
  doc: PbfCopierPreviewDoc;
  query: OsmPhotoQueryResult;
  rawResults: PlaceImageResult[];
  env: AppEnv;
  geminiApiKey?: string | null;
  visionMode?: PbfPhotoVisionMode;
  strictTitleSourceMatch?: boolean;
}): Promise<{
  assets: PbfAssetPreviewExternalAsset[];
  rejectedAssets: ReturnType<typeof scorePhotoSearchResultsForPlace>["rejectedAssets"];
  warnings: string[];
  stats: PbfAssetCurationStats;
  assetStatus: ReturnType<typeof scorePhotoSearchResultsForPlace>["assetStatus"];
  assetsReady: boolean;
  resultSetScore: number;
  topRejectionReasons: string[];
  matchedTokens: string[];
  missingRequiredTokens: string[];
  shouldRunGemini: boolean;
}> {
  const visionMode = input.visionMode ?? "off";
  const scored = scorePhotoSearchResultsForPlace(input.doc, input.query, input.rawResults, {
    visionMode,
    strictTitleSourceMatch: input.strictTitleSourceMatch,
  });
  const gemini = resolvePbfAssetGeminiConfig(input.env, input.geminiApiKey);

  const stats: PbfAssetCurationStats = {
    rawCount: input.rawResults.length,
    metadataRejected: scored.rejectedCount,
    geminiJudged: 0,
    geminiRejected: 0,
    geminiEnabled: false,
    geminiKeySource: gemini.keySource,
    resultSetScore: scored.resultSetScore,
    rejectedCount: scored.rejectedCount,
  };

  const warnings = [...scored.warnings];
  let assets = [...scored.acceptedAssets];

  if (
    visionMode !== "off" &&
    scored.shouldRunGemini &&
    gemini.enabled &&
    gemini.apiKey &&
    assets.length > 0
  ) {
    stats.geminiEnabled = true;
    const confirmPool = assets
      .filter((a) => a.assetMatchConfidence === "medium" || a.assetMatchConfidence === "high")
      .slice(0, GEMINI_CONFIRM_MAX);
    const confirmed: PbfAssetPreviewExternalAsset[] = [];

    for (const asset of confirmPool) {
      const raw = input.rawResults.find((r) => r.imageUrl === asset.imageUrl) ?? asset;
      const judgment = await judgePbfAssetPhotoWithGemini({
        doc: input.doc,
        query: input.query,
        result: raw,
        apiKey: gemini.apiKey,
        model: gemini.model,
      });
      if (judgment.automated) stats.geminiJudged += 1;
      if (judgment.automated && shouldRejectByGeminiJudgment(judgment)) {
        stats.geminiRejected += 1;
        warnings.push(`Vision QA rejected metadata-approved image: ${judgment.shortReason}`);
        continue;
      }
      confirmed.push({
        ...asset,
        visionJudgment: judgment.automated
          ? {
              isRealPlacePhoto: judgment.isRealPlacePhoto,
              assetType: judgment.assetType,
              placeMatchScore: judgment.placeMatchScore,
              visualQualityScore: judgment.visualQualityScore,
              wrongPlaceRisk: judgment.wrongPlaceRisk,
              shortReason: judgment.shortReason,
              automated: true,
            }
          : undefined,
      });
    }

    if (confirmed.length === 0 && assets.length > 0) {
      assets = [];
      warnings.push("Vision QA rejected all metadata-approved candidates — leaving spot blank.");
      return {
        assets: [],
        rejectedAssets: scored.rejectedAssets,
        warnings,
        stats,
        assetStatus: "low_confidence",
        assetsReady: false,
        resultSetScore: scored.resultSetScore,
        topRejectionReasons: scored.topRejectionReasons,
        matchedTokens: scored.matchedTokens,
        missingRequiredTokens: scored.missingRequiredTokens,
        shouldRunGemini: scored.shouldRunGemini,
      };
    }
    if (confirmed.length > 0) {
      assets = confirmed.slice(0, DISPLAY_MAX).map((a, i) => ({ ...a, rank: i + 1 }));
    }
  }

  if (stats.metadataRejected > 0) {
    warnings.push(`Metadata gate rejected ${stats.metadataRejected} weak/wrong-place/graphic result(s).`);
  }

  return {
    assets,
    rejectedAssets: scored.rejectedAssets,
    warnings,
    stats,
    assetStatus: assets.length > 0 ? scored.assetStatus : scored.assetStatus,
    assetsReady: assets.length > 0 && scored.assetsReady,
    resultSetScore: scored.resultSetScore,
    topRejectionReasons: scored.topRejectionReasons,
    matchedTokens: scored.matchedTokens,
    missingRequiredTokens: scored.missingRequiredTokens,
    shouldRunGemini: scored.shouldRunGemini,
  };
}
