import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";

export type UsStateBounds = {
  stateCode: string;
  stateName: string;
  bbox: InventoryBbox;
  center: { lat: number; lng: number };
};

/** Approximate state bounding boxes (WGS84) for chunking imports — not legal boundaries. */
export const US_STATE_BOUNDS: UsStateBounds[] = [
  { stateCode: "AL", stateName: "Alabama", bbox: { minLat: 30.14, minLng: -88.47, maxLat: 35.01, maxLng: -84.89 }, center: { lat: 32.58, lng: -86.68 } },
  { stateCode: "AK", stateName: "Alaska", bbox: { minLat: 51.21, minLng: -179.15, maxLat: 71.35, maxLng: -129.99 }, center: { lat: 61.28, lng: -154.57 } },
  { stateCode: "AZ", stateName: "Arizona", bbox: { minLat: 31.33, minLng: -114.82, maxLat: 37.0, maxLng: -109.04 }, center: { lat: 34.17, lng: -111.93 } },
  { stateCode: "AR", stateName: "Arkansas", bbox: { minLat: 33.0, minLng: -94.62, maxLat: 36.5, maxLng: -89.64 }, center: { lat: 34.75, lng: -92.13 } },
  { stateCode: "CA", stateName: "California", bbox: { minLat: 32.53, minLng: -124.41, maxLat: 42.01, maxLng: -114.13 }, center: { lat: 37.27, lng: -119.27 } },
  { stateCode: "CO", stateName: "Colorado", bbox: { minLat: 36.99, minLng: -109.06, maxLat: 41.0, maxLng: -102.04 }, center: { lat: 39.0, lng: -105.55 } },
  { stateCode: "CT", stateName: "Connecticut", bbox: { minLat: 40.98, minLng: -73.73, maxLat: 42.05, maxLng: -71.79 }, center: { lat: 41.52, lng: -72.76 } },
  { stateCode: "DE", stateName: "Delaware", bbox: { minLat: 38.45, minLng: -75.79, maxLat: 39.84, maxLng: -75.05 }, center: { lat: 39.15, lng: -75.42 } },
  { stateCode: "DC", stateName: "District of Columbia", bbox: { minLat: 38.79, minLng: -77.12, maxLat: 38.99, maxLng: -76.91 }, center: { lat: 38.89, lng: -77.01 } },
  { stateCode: "FL", stateName: "Florida", bbox: { minLat: 24.52, minLng: -87.63, maxLat: 31.0, maxLng: -80.03 }, center: { lat: 27.76, lng: -83.83 } },
  { stateCode: "GA", stateName: "Georgia", bbox: { minLat: 30.36, minLng: -85.61, maxLat: 35.0, maxLng: -80.84 }, center: { lat: 32.68, lng: -83.22 } },
  { stateCode: "HI", stateName: "Hawaii", bbox: { minLat: 18.91, minLng: -160.25, maxLat: 22.24, maxLng: -154.81 }, center: { lat: 20.58, lng: -157.53 } },
  { stateCode: "ID", stateName: "Idaho", bbox: { minLat: 41.99, minLng: -117.24, maxLat: 49.0, maxLng: -111.04 }, center: { lat: 45.5, lng: -114.14 } },
  { stateCode: "IL", stateName: "Illinois", bbox: { minLat: 36.97, minLng: -91.51, maxLat: 42.51, maxLng: -87.02 }, center: { lat: 39.74, lng: -89.27 } },
  { stateCode: "IN", stateName: "Indiana", bbox: { minLat: 37.77, minLng: -88.1, maxLat: 41.76, maxLng: -84.78 }, center: { lat: 39.77, lng: -86.44 } },
  { stateCode: "IA", stateName: "Iowa", bbox: { minLat: 40.38, minLng: -96.64, maxLat: 43.5, maxLng: -90.14 }, center: { lat: 41.94, lng: -93.39 } },
  { stateCode: "KS", stateName: "Kansas", bbox: { minLat: 36.99, minLng: -102.05, maxLat: 40.0, maxLng: -94.59 }, center: { lat: 38.5, lng: -98.32 } },
  { stateCode: "KY", stateName: "Kentucky", bbox: { minLat: 36.5, minLng: -89.57, maxLat: 39.15, maxLng: -81.96 }, center: { lat: 37.83, lng: -85.77 } },
  { stateCode: "LA", stateName: "Louisiana", bbox: { minLat: 28.93, minLng: -94.04, maxLat: 33.02, maxLng: -88.82 }, center: { lat: 30.98, lng: -91.43 } },
  { stateCode: "ME", stateName: "Maine", bbox: { minLat: 42.98, minLng: -71.08, maxLat: 47.46, maxLng: -66.95 }, center: { lat: 45.22, lng: -69.01 } },
  { stateCode: "MD", stateName: "Maryland", bbox: { minLat: 37.91, minLng: -79.49, maxLat: 39.72, maxLng: -75.05 }, center: { lat: 39.82, lng: -77.27 } },
  { stateCode: "MA", stateName: "Massachusetts", bbox: { minLat: 41.24, minLng: -73.51, maxLat: 42.89, maxLng: -69.93 }, center: { lat: 42.07, lng: -71.72 } },
  { stateCode: "MI", stateName: "Michigan", bbox: { minLat: 41.7, minLng: -90.42, maxLat: 48.19, maxLng: -82.41 }, center: { lat: 44.94, lng: -86.41 } },
  { stateCode: "MN", stateName: "Minnesota", bbox: { minLat: 43.5, minLng: -97.24, maxLat: 49.38, maxLng: -89.49 }, center: { lat: 46.44, lng: -93.37 } },
  { stateCode: "MS", stateName: "Mississippi", bbox: { minLat: 30.17, minLng: -91.66, maxLat: 34.99, maxLng: -88.1 }, center: { lat: 32.58, lng: -89.88 } },
  { stateCode: "MO", stateName: "Missouri", bbox: { minLat: 35.99, minLng: -95.77, maxLat: 40.61, maxLng: -89.1 }, center: { lat: 38.33, lng: -92.44 } },
  { stateCode: "MT", stateName: "Montana", bbox: { minLat: 44.36, minLng: -116.05, maxLat: 49.0, maxLng: -104.04 }, center: { lat: 46.68, lng: -110.04 } },
  { stateCode: "NE", stateName: "Nebraska", bbox: { minLat: 39.99, minLng: -104.06, maxLat: 43.0, maxLng: -95.31 }, center: { lat: 41.5, lng: -99.69 } },
  { stateCode: "NV", stateName: "Nevada", bbox: { minLat: 35.0, minLng: -120.01, maxLat: 42.0, maxLng: -114.04 }, center: { lat: 38.5, lng: -117.02 } },
  { stateCode: "NH", stateName: "New Hampshire", bbox: { minLat: 42.7, minLng: -72.56, maxLat: 45.31, maxLng: -70.61 }, center: { lat: 43.0, lng: -71.58 } },
  { stateCode: "NJ", stateName: "New Jersey", bbox: { minLat: 38.93, minLng: -75.56, maxLat: 41.36, maxLng: -73.89 }, center: { lat: 40.15, lng: -74.72 } },
  { stateCode: "NM", stateName: "New Mexico", bbox: { minLat: 31.33, minLng: -109.05, maxLat: 37.0, maxLng: -103.0 }, center: { lat: 34.17, lng: -106.02 } },
  { stateCode: "NY", stateName: "New York", bbox: { minLat: 40.5, minLng: -79.76, maxLat: 45.02, maxLng: -71.86 }, center: { lat: 42.76, lng: -75.81 } },
  { stateCode: "NC", stateName: "North Carolina", bbox: { minLat: 33.84, minLng: -84.32, maxLat: 36.59, maxLng: -75.46 }, center: { lat: 35.22, lng: -79.89 } },
  { stateCode: "ND", stateName: "North Dakota", bbox: { minLat: 45.94, minLng: -104.05, maxLat: 49.0, maxLng: -96.55 }, center: { lat: 47.47, lng: -100.3 } },
  { stateCode: "OH", stateName: "Ohio", bbox: { minLat: 38.4, minLng: -84.82, maxLat: 41.98, maxLng: -80.52 }, center: { lat: 40.19, lng: -82.67 } },
  { stateCode: "OK", stateName: "Oklahoma", bbox: { minLat: 33.62, minLng: -103.0, maxLat: 37.0, maxLng: -94.43 }, center: { lat: 35.31, lng: -98.72 } },
  { stateCode: "OR", stateName: "Oregon", bbox: { minLat: 41.99, minLng: -124.57, maxLat: 46.29, maxLng: -116.46 }, center: { lat: 44.14, lng: -120.52 } },
  { stateCode: "PA", stateName: "Pennsylvania", bbox: { minLat: 39.72, minLng: -80.52, maxLat: 42.27, maxLng: -74.69 }, center: { lat: 41.0, lng: -77.6 } },
  { stateCode: "RI", stateName: "Rhode Island", bbox: { minLat: 41.15, minLng: -71.86, maxLat: 42.02, maxLng: -71.12 }, center: { lat: 41.58, lng: -71.49 } },
  { stateCode: "SC", stateName: "South Carolina", bbox: { minLat: 32.03, minLng: -83.35, maxLat: 35.22, maxLng: -78.54 }, center: { lat: 33.62, lng: -80.94 } },
  { stateCode: "SD", stateName: "South Dakota", bbox: { minLat: 42.48, minLng: -104.06, maxLat: 45.94, maxLng: -96.44 }, center: { lat: 44.21, lng: -100.25 } },
  { stateCode: "TN", stateName: "Tennessee", bbox: { minLat: 34.98, minLng: -90.31, maxLat: 36.68, maxLng: -81.65 }, center: { lat: 35.83, lng: -85.98 } },
  { stateCode: "TX", stateName: "Texas", bbox: { minLat: 25.84, minLng: -106.65, maxLat: 36.5, maxLng: -93.51 }, center: { lat: 31.17, lng: -100.08 } },
  { stateCode: "UT", stateName: "Utah", bbox: { minLat: 36.99, minLng: -114.05, maxLat: 42.0, maxLng: -109.04 }, center: { lat: 39.5, lng: -111.55 } },
  { stateCode: "VT", stateName: "Vermont", bbox: { minLat: 42.73, minLng: -73.44, maxLat: 45.02, maxLng: -71.46 }, center: { lat: 43.87, lng: -72.45 } },
  { stateCode: "VA", stateName: "Virginia", bbox: { minLat: 36.54, minLng: -83.68, maxLat: 39.47, maxLng: -75.24 }, center: { lat: 38.0, lng: -79.46 } },
  { stateCode: "WA", stateName: "Washington", bbox: { minLat: 45.54, minLng: -124.76, maxLat: 49.0, maxLng: -116.92 }, center: { lat: 47.38, lng: -120.84 } },
  { stateCode: "WV", stateName: "West Virginia", bbox: { minLat: 37.2, minLng: -82.64, maxLat: 40.64, maxLng: -77.72 }, center: { lat: 38.42, lng: -80.18 } },
  { stateCode: "WI", stateName: "Wisconsin", bbox: { minLat: 42.49, minLng: -92.89, maxLat: 47.08, maxLng: -86.25 }, center: { lat: 44.79, lng: -89.57 } },
  { stateCode: "WY", stateName: "Wyoming", bbox: { minLat: 40.99, minLng: -111.06, maxLat: 45.01, maxLng: -104.05 }, center: { lat: 43.0, lng: -107.55 } },
];

const BY_CODE = new Map(US_STATE_BOUNDS.map((s) => [s.stateCode, s]));

export function getStateBounds(stateCode: string): UsStateBounds | null {
  return BY_CODE.get(stateCode.toUpperCase()) ?? null;
}

export function listStateCodes(): string[] {
  return US_STATE_BOUNDS.map((s) => s.stateCode);
}

export function listContiguousStateCodes(): string[] {
  return US_STATE_BOUNDS.filter((s) => s.stateCode !== "AK" && s.stateCode !== "HI").map((s) => s.stateCode);
}
