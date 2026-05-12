import type { PlaceCandidate } from "../place-candidates/types.js";
import type { WikimediaGeneratedPost } from "../wikimediaMvp/WikimediaMvpTypes.js";

export type FactoryPostDescriptionSource = "wikimedia_caption" | "wikimedia_generated" | "fallback_place_description";

export type FactoryPostDisplayFields = {
  title: string;
  description: string;
  descriptionSource: FactoryPostDescriptionSource;
  lat: number;
  lng: number;
  locationSource: string;
  locationConfidence: "high" | "medium" | "low";
  warnings: string[];
  wikimediaSuggestedTitle: string;
};

function isLowQualityCommonsCaption(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (t.length > 200) return true;
  if (/^File:/i.test(t)) return true;
  if (/Picturesque America/i.test(t)) return true;
  if (t === "Flickr") return true;
  if (/^VT (at|through) /i.test(t)) return true;
  return false;
}

export function computeFactoryPostDisplay(input: {
  candidate: PlaceCandidate;
  generatedPost: WikimediaGeneratedPost;
}): FactoryPostDisplayFields {
  const preview = input.generatedPost.dryRunPostPreview ?? {};
  const wikimediaSuggestedTitle = String(
    preview.title ?? input.generatedPost.generatedTitle ?? "",
  ).trim();
  const rawCaption = String(preview.caption ?? "").trim();
  const rawDescField = String((preview as { description?: unknown }).description ?? "").trim();
  const combinedRaw = rawCaption || rawDescField || "";

  let description: string;
  let descriptionSource: FactoryPostDescriptionSource;
  if (combinedRaw && !isLowQualityCommonsCaption(combinedRaw)) {
    description = combinedRaw;
    descriptionSource = rawCaption ? "wikimedia_caption" : "wikimedia_generated";
  } else {
    description = `Photos from ${input.candidate.name} in ${input.candidate.state}.`;
    descriptionSource = "fallback_place_description";
  }

  const warnings: string[] = [];
  const lt = input.generatedPost.locationTrust;
  const useTrustCoords = lt && !lt.bypassed && lt.stagingAllowed && lt.stagingPostLat != null && lt.stagingPostLng != null;

  let lat: number;
  let lng: number;
  let locationSource: string;
  let locationConfidence: "high" | "medium" | "low";

  if (useTrustCoords) {
    lat = lt.stagingPostLat as number;
    lng = lt.stagingPostLng as number;
    locationSource = lt.locationSourceForStaging;
    locationConfidence = lt.locationConfidenceForStaging;
    if (lt.placeFallbackAttemptedBlocked) {
      warnings.push("place_coordinate_fallback_blocked_for_staging");
    }
    if (lt.nonlocatedRidealongCount > 0) {
      warnings.push("non_geotagged_ridealong_assets_included_with_located_anchor");
    }
    return {
      title: input.candidate.name,
      description,
      descriptionSource,
      lat,
      lng,
      locationSource,
      locationConfidence,
      warnings,
      wikimediaSuggestedTitle,
    };
  }

  if (lt && !lt.bypassed && !lt.stagingAllowed) {
    lat = NaN;
    lng = NaN;
    locationSource = "none";
    locationConfidence = "low";
    if (lt.placeFallbackAttemptedBlocked) {
      warnings.push("place_coordinate_fallback_blocked_for_staging");
    }
    warnings.push("rejected_no_asset_level_coordinates_for_staging");
    return {
      title: input.candidate.name,
      description,
      descriptionSource,
      lat,
      lng,
      locationSource,
      locationConfidence,
      warnings,
      wikimediaSuggestedTitle,
    };
  }

  const postLat = input.generatedPost.selectedLocation.latitude;
  const postLng = input.generatedPost.selectedLocation.longitude;
  const mediaGeotagged = input.generatedPost.media.some((m) => m.hasRealAssetLocation);
  if (
    postLat != null &&
    postLng != null &&
    Number.isFinite(Number(postLat)) &&
    Number.isFinite(Number(postLng))
  ) {
    lat = Number(postLat);
    lng = Number(postLng);
    const rs = String(input.generatedPost.selectedLocation.reasoning || "");
    if (rs.includes("place_candidate_fallback")) {
      locationSource = "place_candidate_fallback";
      locationConfidence = "medium";
      warnings.push("asset_geotag_missing_used_place_candidate_location");
    } else if (mediaGeotagged) {
      locationSource = "asset_geotag";
      locationConfidence = "high";
    } else {
      locationSource = rs || "post_selected_location";
      locationConfidence = "high";
    }
  } else if (Number.isFinite(input.candidate.lat) && Number.isFinite(input.candidate.lng)) {
    lat = input.candidate.lat;
    lng = input.candidate.lng;
    locationSource = "place_candidate_fallback";
    locationConfidence = "medium";
    warnings.push("asset_geotag_missing_used_place_candidate_location");
  } else {
    lat = NaN;
    lng = NaN;
    locationSource = "none";
    locationConfidence = "low";
  }

  return {
    title: input.candidate.name,
    description,
    descriptionSource,
    lat,
    lng,
    locationSource,
    locationConfidence,
    warnings,
    wikimediaSuggestedTitle,
  };
}
