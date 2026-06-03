/** Map zoom (10–20) → Web Mercator tile z used for unexplored spot reads. */
export function unexploredSpotTileZoomForMapZoom(mapZoom: number): number | null {
  if (!Number.isFinite(mapZoom)) return null;
  const z = Math.round(mapZoom);
  if (z <= 10) return null;
  if (z <= 12) return 11;
  if (z <= 15) return z;
  return 15;
}

export function maxUnexploredSpotsPerTile(tileZ: number): number {
  if (tileZ <= 11) return 24;
  if (tileZ <= 12) return 36;
  if (tileZ <= 13) return 64;
  if (tileZ <= 14) return 96;
  return 200;
}

export function rankSpotForTile(item: {
  displayPriority?: string | null;
  locavaScore?: number | null;
  displayName?: string | null;
  id?: string | null;
}): number {
  const priority = String(item.displayPriority ?? "").toLowerCase();
  let score = typeof item.locavaScore === "number" ? item.locavaScore : 0;
  if (priority.includes("high") || priority === "featured") score += 1000;
  else if (priority.includes("standard")) score += 100;
  return score;
}
