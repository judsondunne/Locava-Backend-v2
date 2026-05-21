import { haversineMeters } from "../inventoryTileGrid.js";

export type TrailPoint = { lat: number; lng: number };

const ENDPOINT_TOLERANCE_METERS = 8;

export function distanceMetersForCoords(coords: TrailPoint[]): number {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1]!, coords[i]!);
  }
  return Math.round(total);
}

export function distanceMilesFromMeters(meters: number): number {
  return Math.round((meters / 1609.344) * 100) / 100;
}

export function distanceLabel(miles: number): string {
  return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
}

export function bboxOfTrailPoints(coords: TrailPoint[]): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} | null {
  if (coords.length === 0) return null;
  let minLat = coords[0]!.lat;
  let maxLat = coords[0]!.lat;
  let minLng = coords[0]!.lng;
  let maxLng = coords[0]!.lng;
  for (const c of coords) {
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
    minLng = Math.min(minLng, c.lng);
    maxLng = Math.max(maxLng, c.lng);
  }
  return { minLat, minLng, maxLat, maxLng };
}

export function endpointsMatch(a: TrailPoint, b: TrailPoint, toleranceMeters = ENDPOINT_TOLERANCE_METERS): boolean {
  return haversineMeters(a, b) <= toleranceMeters;
}

export function stitchSegments(segments: TrailPoint[][]): { coordinates: TrailPoint[]; segments: TrailPoint[][]; stitched: boolean } {
  if (segments.length === 0) return { coordinates: [], segments: [], stitched: true };
  if (segments.length === 1) return { coordinates: segments[0]!, segments, stitched: true };

  const remaining = segments.map((s) => s.slice());
  const chain: TrailPoint[] = remaining.shift()!.slice();
  let stitched = true;

  while (remaining.length > 0) {
    const tail = chain[chain.length - 1]!;
    const head = chain[0]!;
    let bestIdx = -1;
    let bestMode: "append" | "prepend" | "append_rev" | "prepend_rev" | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const seg = remaining[i]!;
      const segHead = seg[0]!;
      const segTail = seg[seg.length - 1]!;
      const checks: Array<{ mode: "append" | "prepend" | "append_rev" | "prepend_rev"; dist: number }> = [
        { mode: "append", dist: haversineMeters(tail, segHead) },
        { mode: "append_rev", dist: haversineMeters(tail, segTail) },
        { mode: "prepend", dist: haversineMeters(head, segTail) },
        { mode: "prepend_rev", dist: haversineMeters(head, segHead) },
      ];
      for (const check of checks) {
        if (check.dist < bestDist) {
          bestDist = check.dist;
          bestIdx = i;
          bestMode = check.mode;
        }
      }
    }

    if (bestIdx < 0 || bestDist > ENDPOINT_TOLERANCE_METERS * 4) {
      stitched = false;
      break;
    }

    const seg = remaining.splice(bestIdx, 1)[0]!;
    if (bestMode === "append") chain.push(...seg.slice(1));
    else if (bestMode === "append_rev") chain.push(...seg.slice(0, -1).reverse());
    else if (bestMode === "prepend") chain.unshift(...seg.slice(0, -1));
    else if (bestMode === "prepend_rev") chain.unshift(...seg.slice(1).reverse());
  }

  if (!stitched) {
    return { coordinates: [], segments: [chain, ...remaining], stitched: false };
  }
  return { coordinates: chain, segments: [chain], stitched: true };
}

export function flattenSegmentsDistance(segments: TrailPoint[][]): number {
  return segments.reduce((sum, seg) => sum + distanceMetersForCoords(seg), 0);
}
