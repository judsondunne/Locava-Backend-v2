import { isLatLngInsideUsStateApprox } from "../geo/usStateApproxBounds.js";
import { haversineMiles } from "../wikimediaMvp/geoDistance.js";
import type {
  WikimediaAssetGroup,
  WikimediaGeneratedPost,
  WikimediaGeneratedPostLocationTrust,
  WikimediaGeneratedPostMedia,
  WikimediaPostMediaLocationRole,
  StateContentLocationTrustMode,
} from "../wikimediaMvp/WikimediaMvpTypes.js";
import type { PlaceCandidate } from "../place-candidates/types.js";
import { resolvePlaceDistanceCapMiles } from "./resolvePlaceDistanceCapMiles.js";

const RIDEALONG_MIN_MEDIA_PLACE_SCORE = 52;
const RIDEALONG_MAX_SOURCE_RANK = 5;

function maxPairwiseMiles(points: Array<{ lat: number; lng: number }>): number {
  let max = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      max = Math.max(max, haversineMiles(points[i]!, points[j]!));
    }
  }
  return max;
}

function hasWrongStateOrRegionMismatch(mismatch?: string[]): boolean {
  const m = mismatch ?? [];
  return m.some(
    (x) =>
      x.includes("title_or_meta_suggests_different_us_state") ||
      x.includes("wrong_state_or_region") ||
      x.startsWith("wrong_place_region_"),
  );
}

function centroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const n = points.length;
  const lat = points.reduce((s, p) => s + p.lat, 0) / n;
  const lng = points.reduce((s, p) => s + p.lng, 0) / n;
  return { lat, lng };
}

function pickRepresentativeAnchor(
  anchors: Array<{
    candidateId: string;
    lat: number;
    lng: number;
    qualityScore: number;
    relevanceScore: number;
  }>,
): (typeof anchors)[0] {
  return [...anchors].sort(
    (a, b) => b.qualityScore + b.relevanceScore - (a.qualityScore + a.relevanceScore),
  )[0]!;
}

type GroupAsset = WikimediaAssetGroup["assets"][number];

function findGroupAsset(group: WikimediaAssetGroup | undefined, candidateId: string): GroupAsset | undefined {
  return group?.assets.find((a) => a.candidateId === candidateId);
}

function hygieneBlocksRidealong(asset: GroupAsset | undefined): boolean {
  if (!asset) return true;
  if (asset.hygieneStatus === "REJECT") return true;
  if (asset.duplicateDecision === "DUPLICATE_REJECTED") return true;
  return false;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}

function buildTrustSummary(
  fields: Omit<WikimediaGeneratedPostLocationTrust, "bypassed"> & { bypassed?: boolean },
): WikimediaGeneratedPostLocationTrust {
  return { ...fields };
}

/**
 * Enforces Locava location-first staging rules: post coordinates must come from real asset geotags
 * inside the target state and within a category-aware distance of the place pin; optional unlocated
 * ride-alongs only when a located anchor exists and media match is strong.
 */
export function applyLocationTrustPolicy(input: {
  candidate: PlaceCandidate;
  generatedPost: WikimediaGeneratedPost;
  group: WikimediaAssetGroup | undefined;
  mode: StateContentLocationTrustMode;
}): WikimediaGeneratedPost {
  const post = structuredClone(input.generatedPost) as WikimediaGeneratedPost;
  const { candidate, group, mode } = input;
  const maxDist = resolvePlaceDistanceCapMiles(candidate);
  const stateCode = candidate.stateCode;

  if (mode === "legacy_place_fallback_allowed") {
    post.locationTrust = {
      mode,
      stagingAllowed: true,
      stagingPostLat: post.selectedLocation.latitude,
      stagingPostLng: post.selectedLocation.longitude,
      locationSourceForStaging: "none",
      locationConfidenceForStaging: "low",
      placeFallbackAttemptedBlocked: false,
      locatedAssetsClustered: true,
      trustRejectionCodes: [],
      locatedAssetCountInPreview: post.locatedAssetCount,
      nonlocatedRidealongCount: 0,
      excludedUnlocatedCount: 0,
      wrongLocationExcludedCount: 0,
      bypassed: true,
    };
    return post;
  }

  const placePin = { lat: candidate.lat, lng: candidate.lng };
  const usePlaceFallbackInSource = String(post.selectedLocation.reasoning || "").includes("place_candidate_fallback");
  const trustRejectionCodes: string[] = [];
  let wrongLocationExcludedCount = 0;
  let excludedUnlocatedCount = 0;
  let nonlocatedRidealongCount = 0;

  const baseRows: WikimediaGeneratedPostMedia[] = post.media.map((m) => {
    const ga = findGroupAsset(group, m.candidateId);
    const lat0 = ga?.assetLatitude ?? m.assetLatitude ?? null;
    const lng0 = ga?.assetLongitude ?? m.assetLongitude ?? null;
    const hasCoords =
      Boolean(ga?.hasRealAssetLocation ?? m.hasRealAssetLocation) &&
      lat0 != null &&
      lng0 != null &&
      Number.isFinite(lat0) &&
      Number.isFinite(lng0);
    const dist =
      hasCoords && lat0 != null && lng0 != null
        ? haversineMiles(placePin, { lat: lat0, lng: lng0 })
        : null;
    const score = ga?.mediaPlaceMatchScore ?? m.mediaPlaceMatchScore ?? 0;
    const mismatch = ga?.mediaPlaceMismatchReasons ?? m.mediaPlaceMismatchReasons ?? [];
    const srcRank = ga?.sourceConfidenceRank ?? m.sourceConfidenceRank ?? 99;

    return {
      ...m,
      mediaPlaceMatchScore: score,
      mediaPlaceMismatchReasons: mismatch,
      sourceConfidenceRank: srcRank,
      matchedQuery: ga?.matchedQuery ?? m.matchedQuery,
      assetLatitude: lat0,
      assetLongitude: lng0,
      hasAssetCoordinates: hasCoords,
      assetDistanceMilesFromPlace: dist,
      includedInStageablePreview: false,
      locationRole: undefined,
    };
  });

  const locatedEvaluated = baseRows.map((m) => {
    if (!m.hasAssetCoordinates || m.assetLatitude == null || m.assetLongitude == null) {
      return { row: m, kind: "unlocated" as const };
    }
    const lat = m.assetLatitude as number;
    const lng = m.assetLongitude as number;
    const inState = isLatLngInsideUsStateApprox(stateCode, lat, lng);
    if (!inState) {
      wrongLocationExcludedCount += 1;
      trustRejectionCodes.push("wrong_state");
      return {
        row: {
          ...m,
          locationRole: "excluded_wrong_location" as WikimediaPostMediaLocationRole,
          includedInStageablePreview: false,
        },
        kind: "located_bad" as const,
      };
    }
    const d = m.assetDistanceMilesFromPlace;
    if (d != null && d > maxDist) {
      wrongLocationExcludedCount += 1;
      trustRejectionCodes.push("too_far_from_place");
      return {
        row: {
          ...m,
          locationRole: "excluded_wrong_location" as WikimediaPostMediaLocationRole,
          includedInStageablePreview: false,
        },
        kind: "located_bad" as const,
      };
    }
    return {
      row: {
        ...m,
        locationRole: "location_anchor" as WikimediaPostMediaLocationRole,
        includedInStageablePreview: true,
      },
      kind: "located_ok" as const,
    };
  });

  const anchorRows = locatedEvaluated.filter((x) => x.kind === "located_ok").map((x) => x.row);
  const anchorPoints = anchorRows.map((m) => ({
    candidateId: m.candidateId,
    lat: m.assetLatitude as number,
    lng: m.assetLongitude as number,
    qualityScore: findGroupAsset(group, m.candidateId)?.qualityScore ?? 0,
    relevanceScore: findGroupAsset(group, m.candidateId)?.relevanceScore ?? 0,
  }));

  const rejectNoAnchors = (extraCodes: string[]) => {
    if (usePlaceFallbackInSource) trustRejectionCodes.push("place_fallback_not_allowed_for_staging");
    for (const c of extraCodes) trustRejectionCodes.push(c);
    const locatedBadRows = locatedEvaluated.filter((x) => x.kind === "located_bad").map((x) => x.row);
    const unlocatedRows: WikimediaGeneratedPostMedia[] = [];
    for (const x of locatedEvaluated) {
      if (x.kind !== "unlocated") continue;
      const m = x.row;
      const ga = findGroupAsset(group, m.candidateId);
      if (hygieneBlocksRidealong(ga)) {
        excludedUnlocatedCount += 1;
        unlocatedRows.push({
          ...m,
          locationRole: "excluded_unlocated",
          includedInStageablePreview: false,
        });
        trustRejectionCodes.push("nonlocated_asset_excluded");
        continue;
      }
      const score = ga?.mediaPlaceMatchScore ?? m.mediaPlaceMatchScore ?? 0;
      const mismatch = ga?.mediaPlaceMismatchReasons ?? m.mediaPlaceMismatchReasons ?? [];
      const srcRank = ga?.sourceConfidenceRank ?? m.sourceConfidenceRank ?? 99;
      if (
        score >= RIDEALONG_MIN_MEDIA_PLACE_SCORE &&
        !hasWrongStateOrRegionMismatch(mismatch) &&
        srcRank <= RIDEALONG_MAX_SOURCE_RANK
      ) {
        excludedUnlocatedCount += 1;
        unlocatedRows.push({
          ...m,
          locationRole: "excluded_unlocated",
          includedInStageablePreview: false,
        });
        trustRejectionCodes.push("nonlocated_asset_excluded_no_location_anchor");
      } else {
        excludedUnlocatedCount += 1;
        unlocatedRows.push({
          ...m,
          locationRole: "excluded_unlocated",
          includedInStageablePreview: false,
        });
        trustRejectionCodes.push("nonlocated_asset_excluded");
      }
    }
    post.media = [...locatedBadRows, ...unlocatedRows];
    post.locationTrust = buildTrustSummary({
      mode,
      stagingAllowed: false,
      stagingPostLat: null,
      stagingPostLng: null,
      locationSourceForStaging: "none",
      locationConfidenceForStaging: "low",
      placeFallbackAttemptedBlocked: usePlaceFallbackInSource,
      locatedAssetsClustered: false,
      trustRejectionCodes: dedupe(trustRejectionCodes),
      locatedAssetCountInPreview: 0,
      nonlocatedRidealongCount: 0,
      excludedUnlocatedCount,
      wrongLocationExcludedCount,
    });
    post.selectedLocation = {
      candidateId: post.selectedLocation.candidateId,
      latitude: null,
      longitude: null,
      reasoning: "no_asset_geotag_for_post_location",
    };
    if (post.dryRunPostPreview && typeof post.dryRunPostPreview === "object") {
      const prev = post.dryRunPostPreview as Record<string, unknown>;
      prev.lat = null;
      prev.lng = null;
      prev.long = null;
    }
    post.status = "REJECT";
    post.rejectionReasons = dedupe([...(post.rejectionReasons ?? []), ...post.locationTrust.trustRejectionCodes]);
    post.reasoning = dedupe([...(post.reasoning ?? []), "location_trust_policy_rejected"]);
  };

  if (anchorPoints.length === 0) {
    rejectNoAnchors(["group_has_no_located_assets_required_for_staging", "no_asset_geotag_for_post_location"]);
    return post;
  }

  const spread = maxPairwiseMiles(anchorPoints);
  const clustered = spread <= maxDist;
  if (!clustered) {
    trustRejectionCodes.push("located_assets_conflict");
    const badAnchors = anchorRows.map((m) => ({
      ...m,
      includedInStageablePreview: false,
      locationRole: "excluded_wrong_location" as WikimediaPostMediaLocationRole,
    }));
    const rest = locatedEvaluated
      .filter((x) => x.kind !== "located_ok")
      .map((x) =>
        x.kind === "unlocated"
          ? ({
              ...x.row,
              locationRole: "excluded_unlocated" as WikimediaPostMediaLocationRole,
              includedInStageablePreview: false,
            } as WikimediaGeneratedPostMedia)
          : x.row,
      );
    post.media = [...badAnchors, ...rest];
    post.selectedLocation = {
      candidateId: anchorPoints[0]!.candidateId,
      latitude: null,
      longitude: null,
      reasoning: "located_assets_conflict",
    };
    if (post.dryRunPostPreview && typeof post.dryRunPostPreview === "object") {
      const prev = post.dryRunPostPreview as Record<string, unknown>;
      prev.lat = null;
      prev.lng = null;
      prev.long = null;
    }
    post.status = "REJECT";
    post.locationTrust = buildTrustSummary({
      mode,
      stagingAllowed: false,
      stagingPostLat: null,
      stagingPostLng: null,
      locationSourceForStaging: "none",
      locationConfidenceForStaging: "low",
      placeFallbackAttemptedBlocked: usePlaceFallbackInSource,
      locatedAssetsClustered: false,
      trustRejectionCodes: dedupe(trustRejectionCodes),
      locatedAssetCountInPreview: 0,
      nonlocatedRidealongCount: 0,
      excludedUnlocatedCount,
      wrongLocationExcludedCount,
    });
    post.rejectionReasons = dedupe([...(post.rejectionReasons ?? []), ...post.locationTrust.trustRejectionCodes]);
    post.reasoning = dedupe([...(post.reasoning ?? []), "located_assets_conflict"]);
    return post;
  }

  let stagingLat: number;
  let stagingLng: number;
  let locationSourceForStaging: WikimediaGeneratedPostLocationTrust["locationSourceForStaging"];
  let anchorId: string;
  if (anchorPoints.length === 1) {
    stagingLat = anchorPoints[0]!.lat;
    stagingLng = anchorPoints[0]!.lng;
    anchorId = anchorPoints[0]!.candidateId;
    locationSourceForStaging = "asset_geotag";
  } else {
    const rep = pickRepresentativeAnchor(anchorPoints);
    const c = centroid(anchorPoints.map((p) => ({ lat: p.lat, lng: p.lng })));
    const distRep = haversineMiles({ lat: rep.lat, lng: rep.lng }, c);
    if (distRep <= 1.5) {
      stagingLat = c.lat;
      stagingLng = c.lng;
      locationSourceForStaging = "located_asset_centroid";
    } else {
      stagingLat = rep.lat;
      stagingLng = rep.lng;
      locationSourceForStaging = "located_asset_representative";
    }
    anchorId = rep.candidateId;
  }

  const includedAnchors = anchorRows.map((m) => ({
    ...m,
    suppliesPostLocation: m.candidateId === anchorId,
  }));

  const ridealongs: WikimediaGeneratedPostMedia[] = [];
  for (const x of locatedEvaluated) {
    if (x.kind !== "unlocated") continue;
    const m = x.row;
    const ga = findGroupAsset(group, m.candidateId);
    if (hygieneBlocksRidealong(ga)) {
      excludedUnlocatedCount += 1;
      ridealongs.push({
        ...m,
        locationRole: "excluded_unlocated",
        includedInStageablePreview: false,
      });
      trustRejectionCodes.push("nonlocated_asset_excluded");
      continue;
    }
    const score = ga?.mediaPlaceMatchScore ?? m.mediaPlaceMatchScore ?? 0;
    const mismatch = ga?.mediaPlaceMismatchReasons ?? m.mediaPlaceMismatchReasons ?? [];
    const srcRank = ga?.sourceConfidenceRank ?? m.sourceConfidenceRank ?? 99;
    if (
      score >= RIDEALONG_MIN_MEDIA_PLACE_SCORE &&
      !hasWrongStateOrRegionMismatch(mismatch) &&
      srcRank <= RIDEALONG_MAX_SOURCE_RANK
    ) {
      nonlocatedRidealongCount += 1;
      ridealongs.push({
        ...m,
        locationRole: "matched_unlocated_ridealong",
        includedInStageablePreview: true,
      });
    } else {
      excludedUnlocatedCount += 1;
      ridealongs.push({
        ...m,
        locationRole: "excluded_unlocated",
        includedInStageablePreview: false,
      });
      trustRejectionCodes.push("nonlocated_asset_excluded");
    }
  }

  const stageableMedia = [...includedAnchors, ...ridealongs.filter((r) => r.includedInStageablePreview)];
  post.media = stageableMedia;
  post.assetCount = stageableMedia.length;
  post.locatedAssetCount = includedAnchors.length;
  post.groupedCandidateIds = stageableMedia.map((x) => x.candidateId);

  post.selectedLocation = {
    candidateId: anchorId,
    latitude: stagingLat,
    longitude: stagingLng,
    reasoning: locationSourceForStaging,
  };
  if (post.dryRunPostPreview && typeof post.dryRunPostPreview === "object") {
    const prev = post.dryRunPostPreview as Record<string, unknown>;
    prev.lat = stagingLat;
    prev.lng = stagingLng;
    prev.long = stagingLng;
  }

  post.locationTrust = buildTrustSummary({
    mode,
    stagingAllowed: true,
    stagingPostLat: stagingLat,
    stagingPostLng: stagingLng,
    locationSourceForStaging,
    locationConfidenceForStaging: "high",
    placeFallbackAttemptedBlocked: usePlaceFallbackInSource,
    locatedAssetsClustered: clustered,
    trustRejectionCodes: dedupe(trustRejectionCodes),
    locatedAnchorCandidateId: anchorId,
    locatedAssetCountInPreview: includedAnchors.length,
    nonlocatedRidealongCount,
    excludedUnlocatedCount,
    wrongLocationExcludedCount,
  });

  return post;
}
