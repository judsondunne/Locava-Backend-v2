export type PostLocationSource = "exif" | "manual" | "user_selected" | "unknown";
export type PostLocationPrecision = "address" | "city" | "region" | "country" | "coordinates";
export type ReverseGeocodeStatus = "resolved" | "partial" | "fallback" | "failed";

export type CanonicalPostLocation = {
  latitude: number | null;
  longitude: number | null;
  addressDisplayName: string | null;
  locationDisplayName: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  fallbackPrecision: PostLocationPrecision;
  reverseGeocodeStatus: ReverseGeocodeStatus;
  source: PostLocationSource;
};

type NormalizeInput = {
  latitude?: unknown;
  longitude?: unknown;
  addressDisplayName?: unknown;
  locationDisplayName?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
  source?: unknown;
  reverseGeocodeMatched?: boolean;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "location") return null;
  return trimmed;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isValidCoordinatePair(lat: number | null, lng: number | null): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function coerceSource(value: unknown): PostLocationSource {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "exif" || normalized === "manual" || normalized === "user_selected") {
    return normalized;
  }
  return "unknown";
}

export function normalizeCanonicalPostLocation(input: NormalizeInput): CanonicalPostLocation {
  const latitude = parseFiniteNumber(input.latitude);
  const longitude = parseFiniteNumber(input.longitude);
  const city = cleanString(input.city);
  const region = cleanString(input.region);
  const country = cleanString(input.country);
  const primaryAddress = cleanString(input.addressDisplayName) ?? cleanString(input.locationDisplayName);
  const source = coerceSource(input.source);
  const hasCoordinates = isValidCoordinatePair(latitude, longitude);

  if (!hasCoordinates) {
    return {
      latitude: null,
      longitude: null,
      addressDisplayName: primaryAddress,
      locationDisplayName: primaryAddress,
      city,
      region,
      country,
      fallbackPrecision: "coordinates",
      reverseGeocodeStatus: "failed",
      source
    };
  }

  let displayName = primaryAddress;
  let fallbackPrecision: PostLocationPrecision = "address";
  if (!displayName && city) {
    displayName = city;
    fallbackPrecision = "city";
  } else if (!displayName && region) {
    displayName = region;
    fallbackPrecision = "region";
  } else if (!displayName && country) {
    displayName = country;
    fallbackPrecision = "country";
  } else if (!displayName) {
    displayName = formatCoordinates(latitude as number, longitude as number);
    fallbackPrecision = "coordinates";
  }

  const reverseGeocodeStatus: ReverseGeocodeStatus =
    input.reverseGeocodeMatched === true && fallbackPrecision === "address"
      ? "resolved"
      : fallbackPrecision === "address" || fallbackPrecision === "city" || fallbackPrecision === "region"
        ? "partial"
        : "fallback";

  return {
    latitude,
    longitude,
    addressDisplayName: displayName,
    locationDisplayName: displayName,
    city,
    region,
    country,
    fallbackPrecision,
    reverseGeocodeStatus,
    source
  };
}

