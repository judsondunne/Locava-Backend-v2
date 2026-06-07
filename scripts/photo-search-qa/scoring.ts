import type { BatchSummary, ImageValidationResult, PlaceQaResult, ProductionVerdict, VisionJudgment } from "./types.js";
import { duplicateRate } from "./duplicateDetection.js";

export const P95_WARN_MS = 4000;
export const P95_FAIL_MS = 8000;
export const AVG_RESPONSE_CATASTROPHIC_MS = 6000;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export function average(nums: Array<number | null | undefined>): number | null {
  const valid = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (valid.length === 0) return null;
  return valid.reduce((sum, n) => sum + n, 0) / valid.length;
}

export function visionPlaceLabel(vision: VisionJudgment | null): "likely_correct" | "unsure" | "wrong" | "not_judged" {
  if (!vision) return "not_judged";
  if (vision.wrongPlaceRisk === "high" || vision.placeMatchScore <= 1) return "wrong";
  if (vision.wrongPlaceRisk === "medium" || vision.placeMatchScore <= 3) return "unsure";
  return "likely_correct";
}

export function scorePlace(params: {
  seedId: string;
  placeName: string;
  town: string;
  state: string;
  apiPlaceQuery: string;
  searchQueryUsed: string;
  provider: PlaceQaResult["provider"];
  responseMs: number;
  ttfbMs: number | null;
  imageValidationMs: number;
  images: ImageValidationResult[];
  minImages: number;
  apiError?: string;
}): PlaceQaResult {
  const totalResults = params.images.length;
  const validImageCount = params.images.filter((img) => img.loadsOk).length;
  const brokenImageCount = params.images.filter((img) => !img.loadsOk).length;
  const missingMetadataCount = params.images.filter((img) => !img.metadataOk).length;
  const duplicateCount = params.images.filter((img) => img.duplicateOfIndex != null).length;

  const judged = params.images
    .map((img) => img.vision)
    .filter((v): v is VisionJudgment => Boolean(v && v.automated));
  const avgPlaceMatchScore = average(judged.map((v) => v.placeMatchScore));
  const avgVisualQualityScore = average(judged.map((v) => v.visualQualityScore));
  const avgCoolnessScore = average(judged.map((v) => v.locavaCoolnessScore));
  const highWrongPlaceRiskCount = judged.filter((v) => v.wrongPlaceRisk === "high").length;
  const visionUnavailable = params.images.length > 0 && judged.length === 0;

  const failureReasons: string[] = [];
  if (params.apiError) failureReasons.push(`api_error:${params.apiError}`);
  if (totalResults === 0) failureReasons.push("no_results");
  if (validImageCount < params.minImages) failureReasons.push(`insufficient_valid_images:${validImageCount}<${params.minImages}`);
  if (brokenImageCount > 0) failureReasons.push(`broken_images:${brokenImageCount}`);
  if (missingMetadataCount > 0) failureReasons.push(`missing_metadata:${missingMetadataCount}`);
  if (duplicateRate(duplicateCount, totalResults) > 0.25) failureReasons.push("duplicate_heavy");
  if (params.responseMs > P95_FAIL_MS) failureReasons.push("too_slow");

  const loadRate = totalResults > 0 ? validImageCount / totalResults : 0;
  const metadataRate = totalResults > 0 ? (totalResults - missingMetadataCount) / totalResults : 0;

  if (loadRate < 0.8 && totalResults > 0) failureReasons.push(`load_rate_below_80:${Math.round(loadRate * 100)}%`);
  if (metadataRate < 1 && totalResults > 0) failureReasons.push("copyright_metadata_missing");

  if (avgPlaceMatchScore != null && avgPlaceMatchScore < 4) {
    failureReasons.push(`low_place_match:${avgPlaceMatchScore.toFixed(2)}`);
  }
  if (visionUnavailable) failureReasons.push("vision_unavailable_manual_review");
  if (avgVisualQualityScore != null && avgVisualQualityScore < 3.5) {
    failureReasons.push(`low_visual_quality:${avgVisualQualityScore.toFixed(2)}`);
  }
  if (avgCoolnessScore != null && avgCoolnessScore < 3.5) {
    failureReasons.push(`low_coolness:${avgCoolnessScore.toFixed(2)}`);
  }
  if (highWrongPlaceRiskCount > 0) failureReasons.push(`wrong_place_high_risk:${highWrongPlaceRiskCount}`);

  const visuallyAmbiguous =
    judged.length > 0 &&
    avgPlaceMatchScore != null &&
    avgPlaceMatchScore >= 3.5 &&
    avgPlaceMatchScore < 4;

  let passFail: PlaceQaResult["passFail"] = "pass";
  const hardFail =
    totalResults === 0 ||
    validImageCount < params.minImages ||
    metadataRate < 1 ||
    loadRate < 0.8 ||
    (judged.length > 0 && avgPlaceMatchScore != null && avgPlaceMatchScore < 3.5) ||
    duplicateRate(duplicateCount, totalResults) > 0.25 ||
    params.responseMs > P95_FAIL_MS;

  if (hardFail) passFail = "fail";
  else if (visionUnavailable) passFail = "manual_review";
  else if (visuallyAmbiguous || (avgPlaceMatchScore != null && avgPlaceMatchScore < 4)) passFail = "manual_review";
  else if (avgVisualQualityScore != null && avgVisualQualityScore < 3.5) passFail = "manual_review";
  else if (avgCoolnessScore != null && avgCoolnessScore < 3.5) passFail = "manual_review";

  return {
    seedId: params.seedId,
    placeName: params.placeName,
    town: params.town,
    state: params.state,
    apiPlaceQuery: params.apiPlaceQuery,
    searchQueryUsed: params.searchQueryUsed,
    provider: params.provider,
    totalResults,
    validImageCount,
    brokenImageCount,
    missingMetadataCount,
    duplicateCount,
    avgPlaceMatchScore,
    avgVisualQualityScore,
    avgCoolnessScore,
    highWrongPlaceRiskCount,
    responseMs: params.responseMs,
    ttfbMs: params.ttfbMs,
    imageValidationMs: params.imageValidationMs,
    estimatedProviderCalls: params.provider === "none" || params.provider === "mock" ? 0 : 1,
    estimatedCredits: params.provider === "none" || params.provider === "mock" ? 0 : 1,
    exactCostKnown: false,
    passFail,
    failureReasons,
    images: params.images,
    apiError: params.apiError,
  };
}

export function summarizeBatch(batchNumber: number, places: PlaceQaResult[]): BatchSummary {
  const responseTimes = places.map((p) => p.responseMs);
  const totalImagesReturned = places.reduce((sum, p) => sum + p.totalResults, 0);
  const validImages = places.reduce((sum, p) => sum + p.validImageCount, 0);
  const brokenImages = places.reduce((sum, p) => sum + p.brokenImageCount, 0);
  const missingMetadata = places.reduce((sum, p) => sum + p.missingMetadataCount, 0);
  const duplicateCount = places.reduce((sum, p) => sum + p.duplicateCount, 0);

  const reasonCounts = new Map<string, number>();
  for (const place of places) {
    for (const reason of place.failureReasons) {
      const key = reason.split(":")[0] ?? reason;
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }

  const topFailureReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => `${reason} (${count})`);

  const sortedWorst = [...places].sort((a, b) => {
    const score = (p: PlaceQaResult) =>
      (p.passFail === "fail" ? 0 : p.passFail === "manual_review" ? 1 : 2) * 1000 +
      p.validImageCount -
      (p.avgPlaceMatchScore ?? 0);
    return score(a) - score(b);
  });

  const sortedBest = [...places].sort((a, b) => {
    const score = (p: PlaceQaResult) =>
      (p.passFail === "pass" ? 2 : p.passFail === "manual_review" ? 1 : 0) * 1000 +
      p.validImageCount +
      (p.avgPlaceMatchScore ?? 0) +
      (p.avgCoolnessScore ?? 0);
    return score(b) - score(a);
  });

  const zeroImagePlaces = places.filter((p) => p.totalResults === 0).length;
  const missingMetaPlaces = places.filter((p) => p.missingMetadataCount > 0).length;
  const avgResponseMs = average(responseTimes) ?? 0;
  const p95ResponseMs = percentile(responseTimes, 95);

  const catastrophicReasons: string[] = [];
  if (zeroImagePlaces > 3) catastrophicReasons.push(`zero_image_places:${zeroImagePlaces}`);
  if (missingMetaPlaces > 3) catastrophicReasons.push(`missing_metadata_places:${missingMetaPlaces}`);
  if (avgResponseMs > AVG_RESPONSE_CATASTROPHIC_MS) {
    catastrophicReasons.push(`avg_response_ms:${Math.round(avgResponseMs)}`);
  }

  return {
    batchNumber,
    placeIds: places.map((p) => p.seedId),
    placesTested: places.length,
    passed: places.filter((p) => p.passFail === "pass").length,
    manualReview: places.filter((p) => p.passFail === "manual_review").length,
    failed: places.filter((p) => p.passFail === "fail").length,
    totalImagesReturned,
    validImages,
    brokenImages,
    missingMetadata,
    duplicateRate: duplicateRate(duplicateCount, totalImagesReturned),
    avgResponseMs: Math.round(avgResponseMs),
    p50ResponseMs: Math.round(percentile(responseTimes, 50)),
    p95ResponseMs: Math.round(p95ResponseMs),
    estimatedProviderCalls: places.reduce((sum, p) => sum + p.estimatedProviderCalls, 0),
    estimatedCredits: places.reduce((sum, p) => sum + p.estimatedCredits, 0),
    exactCostKnown: false,
    topFailureReasons,
    worstPlaces: sortedWorst.slice(0, 3).map((p) => `${p.placeName} (${p.town})`),
    bestPlaces: sortedBest.slice(0, 3).map((p) => `${p.placeName} (${p.town})`),
    catastrophic: catastrophicReasons.length > 0,
    catastrophicReasons,
  };
}

export function computeProductionVerdict(places: PlaceQaResult[], batches: BatchSummary[]): ProductionVerdict {
  if (places.length === 0) return "NOT PRODUCTION READY";

  const passRate = places.filter((p) => p.passFail === "pass").length / places.length;
  const totalImages = places.reduce((sum, p) => sum + p.totalResults, 0);
  const brokenRate = totalImages > 0 ? places.reduce((sum, p) => sum + p.brokenImageCount, 0) / totalImages : 1;
  const metadataFailures = places.reduce((sum, p) => sum + p.missingMetadataCount, 0);
  const highRiskImages = places.reduce((sum, p) => sum + p.highWrongPlaceRiskCount, 0);
  const judgedImages = places.reduce(
    (sum, p) => sum + p.images.filter((img) => img.vision?.automated).length,
    0,
  );
  const highRiskRate = judgedImages > 0 ? highRiskImages / judgedImages : 0;
  const p95 = percentile(
    batches.flatMap((b) => [b.p95ResponseMs]),
    95,
  );
  const catastrophic = batches.some((b) => b.catastrophic);

  const manualHeavy = places.filter((p) => p.passFail === "manual_review").length / places.length > 0.2;

  if (
    passRate >= 0.9 &&
    metadataFailures === 0 &&
    brokenRate < 0.05 &&
    highRiskRate < 0.1 &&
    p95 <= P95_FAIL_MS &&
    !catastrophic
  ) {
    return "PRODUCTION READY";
  }

  if (passRate >= 0.7 && !catastrophic && (manualHeavy || metadataFailures === 0)) {
    return "ALMOST READY - NEEDS MANUAL REVIEW";
  }

  return "NOT PRODUCTION READY";
}

export function computeHitRates(places: PlaceQaResult[], minImages: number): {
  placesWithMinValidImagesPct: number;
  allImagesLoadPct: number;
  highConfidencePlaceMatchPct: number;
} {
  if (places.length === 0) {
    return { placesWithMinValidImagesPct: 0, allImagesLoadPct: 0, highConfidencePlaceMatchPct: 0 };
  }

  const withMin = places.filter((p) => p.validImageCount >= minImages).length / places.length;
  const allLoad = places.filter((p) => p.totalResults > 0 && p.brokenImageCount === 0).length / places.length;
  const highConfidence = places.filter(
    (p) => p.avgPlaceMatchScore != null && p.avgPlaceMatchScore >= 4 && p.highWrongPlaceRiskCount === 0,
  ).length / places.length;

  return {
    placesWithMinValidImagesPct: Math.round(withMin * 1000) / 10,
    allImagesLoadPct: Math.round(allLoad * 1000) / 10,
    highConfidencePlaceMatchPct: Math.round(highConfidence * 1000) / 10,
  };
}
