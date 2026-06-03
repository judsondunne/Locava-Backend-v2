import { haversineMeters } from "../inventory/inventoryTileGrid.js";

export type LonLat = { lat: number; lng: number };

/** Nearest point on a polyline to `point` (planar segment projection in lat/lng). */
export function nearestPointOnPolyline(
  point: LonLat,
  line: LonLat[],
): { point: LonLat; distanceMeters: number; segmentIndex: number } | null {
  if (line.length < 2) return null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestPoint = line[0]!;
  let bestSeg = 0;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const projected = projectPointOnSegment(point, a, b);
    const d = haversineMeters(point, projected);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = projected;
      bestSeg = i;
    }
  }

  return { point: bestPoint, distanceMeters: bestDist, segmentIndex: bestSeg };
}

function projectPointOnSegment(p: LonLat, a: LonLat, b: LonLat): LonLat {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-14) return a;
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { lat: a.lat + t * dy, lng: a.lng + t * dx };
}
