/**
 * Approximate axis-aligned bounding boxes for US states (including DC).
 * Used only for coarse "is this geotag plausibly inside the target state?" checks
 * for automated Commons ingestion — not for legal boundaries.
 */
export type UsStateLatLngBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/** Lowercase 2-letter codes */
export const US_STATE_APPROX_BOUNDS: Record<string, UsStateLatLngBounds> = {
  al: { minLat: 30.14, maxLat: 35.01, minLng: -88.47, maxLng: -84.89 },
  ak: { minLat: 51.21, maxLat: 71.39, minLng: -179.15, maxLng: -129.99 },
  az: { minLat: 31.33, maxLat: 37.0, minLng: -114.82, maxLng: -109.04 },
  ar: { minLat: 33.0, maxLat: 36.5, minLng: -94.62, maxLng: -89.64 },
  ca: { minLat: 32.53, maxLat: 42.01, minLng: -124.41, maxLng: -114.13 },
  co: { minLat: 36.99, maxLat: 41.0, minLng: -109.06, maxLng: -102.04 },
  ct: { minLat: 40.98, maxLat: 42.05, minLng: -73.73, maxLng: -71.79 },
  de: { minLat: 38.45, maxLat: 39.84, minLng: -75.79, maxLng: -74.85 },
  dc: { minLat: 38.79, maxLat: 39.0, minLng: -77.12, maxLng: -76.91 },
  fl: { minLat: 24.52, maxLat: 31.0, minLng: -87.63, maxLng: -80.03 },
  ga: { minLat: 30.36, maxLat: 34.99, minLng: -85.61, maxLng: -80.84 },
  hi: { minLat: 18.91, maxLat: 22.24, minLng: -160.25, maxLng: -154.81 },
  id: { minLat: 41.99, maxLat: 49.0, minLng: -117.24, maxLng: -111.04 },
  il: { minLat: 36.97, maxLat: 42.51, minLng: -91.51, maxLng: -87.02 },
  in: { minLat: 37.77, maxLat: 41.76, minLng: -88.1, maxLng: -84.78 },
  ia: { minLat: 40.38, maxLat: 43.5, minLng: -96.64, maxLng: -90.14 },
  ks: { minLat: 36.99, maxLat: 40.0, minLng: -102.05, maxLng: -94.59 },
  ky: { minLat: 36.5, maxLat: 39.15, minLng: -89.57, maxLng: -81.96 },
  la: { minLat: 28.93, maxLat: 33.02, minLng: -94.04, maxLng: -88.82 },
  me: { minLat: 42.98, maxLat: 47.46, minLng: -71.08, maxLng: -66.95 },
  md: { minLat: 37.91, maxLat: 39.72, minLng: -79.49, maxLng: -75.05 },
  ma: { minLat: 41.24, maxLat: 42.89, minLng: -73.51, maxLng: -69.93 },
  mi: { minLat: 41.7, maxLat: 48.31, minLng: -90.42, maxLng: -82.13 },
  mn: { minLat: 43.5, maxLat: 49.38, minLng: -97.24, maxLng: -89.49 },
  ms: { minLat: 30.17, maxLat: 35.0, minLng: -91.65, maxLng: -88.1 },
  mo: { minLat: 35.99, maxLat: 40.61, minLng: -95.77, maxLng: -89.1 },
  mt: { minLat: 44.36, maxLat: 49.0, minLng: -116.05, maxLng: -104.04 },
  ne: { minLat: 39.99, maxLat: 43.0, minLng: -104.05, maxLng: -95.31 },
  nv: { minLat: 35.0, maxLat: 42.0, minLng: -120.0, maxLng: -114.04 },
  nh: { minLat: 42.7, maxLat: 45.31, minLng: -72.56, maxLng: -70.57 },
  nj: { minLat: 38.93, maxLat: 41.36, minLng: -75.56, maxLng: -73.89 },
  nm: { minLat: 31.33, maxLat: 37.0, minLng: -109.05, maxLng: -103.0 },
  ny: { minLat: 40.5, maxLat: 45.02, minLng: -79.76, maxLng: -71.86 },
  nc: { minLat: 33.84, maxLat: 36.59, minLng: -84.32, maxLng: -75.46 },
  nd: { minLat: 45.94, maxLat: 49.0, minLng: -104.05, maxLng: -96.56 },
  oh: { minLat: 38.4, maxLat: 42.0, minLng: -84.82, maxLng: -80.52 },
  ok: { minLat: 33.62, maxLat: 37.0, minLng: -103.0, maxLng: -94.43 },
  or: { minLat: 41.99, maxLat: 46.29, minLng: -124.57, maxLng: -116.46 },
  pa: { minLat: 39.72, maxLat: 42.27, minLng: -80.52, maxLng: -74.69 },
  ri: { minLat: 41.1, maxLat: 42.02, minLng: -71.86, maxLng: -71.12 },
  sc: { minLat: 32.03, maxLat: 35.21, minLng: -83.35, maxLng: -78.54 },
  sd: { minLat: 42.48, maxLat: 45.95, minLng: -104.06, maxLng: -96.44 },
  tn: { minLat: 34.98, maxLat: 36.68, minLng: -90.31, maxLng: -81.65 },
  tx: { minLat: 25.84, maxLat: 36.5, minLng: -106.65, maxLng: -93.51 },
  ut: { minLat: 36.99, maxLat: 42.0, minLng: -114.05, maxLng: -109.04 },
  vt: { minLat: 42.73, maxLat: 45.02, minLng: -73.44, maxLng: -71.46 },
  va: { minLat: 36.54, maxLat: 39.47, minLng: -83.67, maxLng: -75.24 },
  wa: { minLat: 45.54, maxLat: 49.0, minLng: -124.79, maxLng: -116.92 },
  wv: { minLat: 37.2, maxLat: 40.64, minLng: -82.64, maxLng: -77.72 },
  wi: { minLat: 42.49, maxLat: 47.31, minLng: -92.9, maxLng: -86.25 },
  wy: { minLat: 40.99, maxLat: 45.01, minLng: -111.06, maxLng: -104.05 },
};

export function isLatLngInsideUsStateApprox(stateCode: string | undefined, lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const key = String(stateCode || "")
    .trim()
    .toLowerCase();
  const b = US_STATE_APPROX_BOUNDS[key];
  if (!b) return true;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}
