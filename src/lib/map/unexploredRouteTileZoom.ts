import { rankSpotForTile } from "./unexploredSpotTileZoom.js";

export function maxUnexploredRoutesPerTile(tileZ: number): number {
  if (tileZ <= 11) return 16;
  if (tileZ <= 12) return 24;
  if (tileZ <= 13) return 48;
  if (tileZ <= 14) return 72;
  return 120;
}

export function rankRouteForTile(item: {
  displayPriority?: string | null;
  locavaScore?: number | null;
  displayName?: string | null;
  id?: string | null;
}): number {
  return rankSpotForTile(item);
}
