const EARTH_R_M = 6_371_000;

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const φ1 = (aLat * Math.PI) / 180;
  const φ2 = (bLat * Math.PI) / 180;
  const Δφ = ((bLat - aLat) * Math.PI) / 180;
  const Δλ = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return EARTH_R_M * c;
}

export type BackendDistanceBucket = "core" | "nearby" | "extended_context" | "too_far_or_wrong" | "unclear";

export function distanceMetersFromAnchor(
  postLat: number | null,
  postLng: number | null,
  anchorLat: number | null,
  anchorLng: number | null
): number | null {
  if (
    postLat == null ||
    postLng == null ||
    anchorLat == null ||
    anchorLng == null ||
    !Number.isFinite(postLat) ||
    !Number.isFinite(postLng) ||
    !Number.isFinite(anchorLat) ||
    !Number.isFinite(anchorLng)
  ) {
    return null;
  }
  return haversineMeters(postLat, postLng, anchorLat, anchorLng);
}

export function backendDistanceBucketFromMeters(
  meters: number | null,
  coreRadiusMeters: number,
  nearbyRadiusMeters: number,
  extendedContextRadiusMeters: number
): BackendDistanceBucket {
  if (meters == null || !Number.isFinite(meters)) return "unclear";
  if (meters <= coreRadiusMeters) return "core";
  if (meters <= nearbyRadiusMeters) return "nearby";
  if (meters <= extendedContextRadiusMeters) return "extended_context";
  return "too_far_or_wrong";
}
