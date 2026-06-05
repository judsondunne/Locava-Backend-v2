import type { PbfCopierV2ViewportBbox } from "./pbfCopierV2ViewportPreview.js";

/** Vermont state bounds (approximate). */
export const VERMONT_BOUNDS: PbfCopierV2ViewportBbox = {
  westLng: -73.44,
  southLat: 42.73,
  eastLng: -71.46,
  northLat: 45.02,
};

export type VermontTile = PbfCopierV2ViewportBbox & {
  tileId: string;
  tileIndex: number;
};

export function buildVermontTileGrid(stepDegrees = 0.4): VermontTile[] {
  const tiles: VermontTile[] = [];
  let index = 0;
  for (let lat = VERMONT_BOUNDS.southLat; lat < VERMONT_BOUNDS.northLat; lat += stepDegrees) {
    for (let lng = VERMONT_BOUNDS.westLng; lng < VERMONT_BOUNDS.eastLng; lng += stepDegrees) {
      const southLat = lat;
      const northLat = Math.min(lat + stepDegrees, VERMONT_BOUNDS.northLat);
      const westLng = lng;
      const eastLng = Math.min(lng + stepDegrees, VERMONT_BOUNDS.eastLng);
      const tileId = `vt_${southLat.toFixed(2)}_${westLng.toFixed(2)}`;
      tiles.push({ tileId, tileIndex: index, southLat, northLat, westLng, eastLng });
      index += 1;
    }
  }
  return tiles;
}
