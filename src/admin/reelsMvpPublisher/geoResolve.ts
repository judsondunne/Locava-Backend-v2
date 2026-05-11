import { encodeGeohash } from "../../lib/latlng-geohash.js";
import { buildCityRegionId, buildStateRegionId } from "../../lib/search-query-intent.js";
import { normalizeCanonicalPostLocation } from "../../lib/location/post-location-normalizer.js";
import { searchPlacesIndexService } from "../../services/surfaces/search-places-index.service.js";
import type { NativePostGeoBlock } from "../../services/posting/buildPostDocument.js";

/**
 * Same resolution strategy as `PostingMutationService.resolveFinalizeGeo` (read-only).
 */
export function resolveGeoForReelsPublisher(input: { lat: number; lng: number; address: string }): NativePostGeoBlock {
  const { lat, lng, address } = input;
  const geohash = lat === 0 && lng === 0 ? "" : encodeGeohash(lat, lng, 9);
  const match = lat !== 0 || lng !== 0 ? searchPlacesIndexService.reverseLookup(lat, lng) : null;
  const normalized = normalizeCanonicalPostLocation({
    latitude: lat,
    longitude: lng,
    addressDisplayName: address,
    city: match?.text ?? null,
    region: match?.stateName ?? null,
    country: match?.countryCode ?? null,
    source: "manual",
    reverseGeocodeMatched: Boolean(match)
  });
  if (match) {
    const gLat = match.lat ?? lat;
    const gLng = match.lng ?? lng;
    return {
      cityRegionId: match.cityRegionId,
      stateRegionId: match.stateRegionId,
      countryRegionId: match.countryCode,
      geohash: geohash || encodeGeohash(gLat, gLng, 9),
      geoData: {
        country: normalized.country,
        state: normalized.region,
        city: normalized.city
      },
      addressDisplayName: normalized.addressDisplayName ?? "",
      locationDisplayName: normalized.locationDisplayName ?? "",
      fallbackPrecision: normalized.fallbackPrecision,
      reverseGeocodeStatus: normalized.reverseGeocodeStatus,
      source: normalized.source
    };
  }
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  const city = normalized.city ?? parts[0] ?? null;
  const state = normalized.region ?? parts[1] ?? null;
  const country = normalized.country ?? parts[2] ?? null;
  const normalizedCountry = String(country ?? "").trim();
  const countryCode = /^[A-Za-z]{2}$/.test(normalizedCountry) ? normalizedCountry.toUpperCase() : null;
  return {
    cityRegionId: countryCode && state && city ? buildCityRegionId(countryCode, state, city) : null,
    stateRegionId: countryCode && state ? buildStateRegionId(countryCode, state) : null,
    countryRegionId: countryCode,
    geohash,
    geoData: { country, state, city },
    addressDisplayName: normalized.addressDisplayName ?? "",
    locationDisplayName: normalized.locationDisplayName ?? "",
    fallbackPrecision: normalized.fallbackPrecision,
    reverseGeocodeStatus: normalized.reverseGeocodeStatus,
    source: normalized.source
  };
}
