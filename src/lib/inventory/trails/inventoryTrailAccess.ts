import { haversineMeters } from "../inventoryTileGrid.js";
import type { TrailPoint } from "./inventoryTrailGraph.js";

export type TrailAccessPoint = {
  lat: number;
  lng: number;
  name: string | null;
  sourceKey: string;
  source: "explicit_trailhead" | "parking_near_endpoint" | "route_endpoint" | "park_entrance" | "information";
  access?: string | null;
  distanceToTrailMeters: number;
};

export type ParkingCandidate = {
  lat: number;
  lng: number;
  name: string | null;
  sourceKey: string;
  access?: string | null;
  distanceToTrailMeters: number;
};

function minDistanceToTrail(point: TrailPoint, segments: TrailPoint[][]): number {
  let min = Infinity;
  for (const seg of segments) {
    for (const p of seg) {
      min = Math.min(min, haversineMeters(point, p));
    }
  }
  return Math.round(min);
}

function trailEndpoints(segments: TrailPoint[][]): TrailPoint[] {
  const out: TrailPoint[] = [];
  for (const seg of segments) {
    if (seg.length === 0) continue;
    out.push(seg[0]!, seg[seg.length - 1]!);
  }
  return out;
}

export function findTrailAccess(input: {
  segments: TrailPoint[][];
  parkingSpots: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; tags: Record<string, string> }>;
  trailheadSpots: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; tags: Record<string, string> }>;
}): {
  parkingCandidates: ParkingCandidate[];
  trailheadCandidates: TrailAccessPoint[];
  selectedTrailhead: TrailAccessPoint | null;
  selectedParking: (ParkingCandidate & { distanceToTrailheadMeters: number }) | null;
} {
  const endpoints = trailEndpoints(input.segments);
  const parkingCandidates: ParkingCandidate[] = [];
  const trailheadCandidates: TrailAccessPoint[] = [];

  for (const p of input.parkingSpots) {
    const access = p.tags.access ?? p.tags["parking:access"] ?? null;
    if (access === "private") continue;
    const dist = minDistanceToTrail(p, input.segments);
    if (dist <= 800) {
      parkingCandidates.push({
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        sourceKey: p.sourceKey,
        access,
        distanceToTrailMeters: dist,
      });
    }
  }
  parkingCandidates.sort((a, b) => a.distanceToTrailMeters - b.distanceToTrailMeters);

  for (const t of input.trailheadSpots) {
    const dist = minDistanceToTrail(t, input.segments);
    trailheadCandidates.push({
      lat: t.lat,
      lng: t.lng,
      name: t.name,
      sourceKey: t.sourceKey,
      source: t.tags.highway === "trailhead" ? "explicit_trailhead" : "information",
      access: t.tags.access ?? null,
      distanceToTrailMeters: dist,
    });
  }
  trailheadCandidates.sort((a, b) => a.distanceToTrailMeters - b.distanceToTrailMeters);

  let selectedTrailhead: TrailAccessPoint | null =
    trailheadCandidates.find((t) => t.source === "explicit_trailhead") ??
    trailheadCandidates[0] ??
    null;

  if (!selectedTrailhead && endpoints.length > 0) {
    const ep = endpoints[0]!;
    selectedTrailhead = {
      lat: ep.lat,
      lng: ep.lng,
      name: null,
      sourceKey: "route_endpoint",
      source: "route_endpoint",
      distanceToTrailMeters: 0,
    };
  }

  const nearParking = parkingCandidates.find((p) => p.distanceToTrailMeters <= 400) ?? parkingCandidates[0] ?? null;
  const selectedParking = nearParking
    ? {
        ...nearParking,
        distanceToTrailheadMeters: selectedTrailhead
          ? haversineMeters(nearParking, selectedTrailhead)
          : nearParking.distanceToTrailMeters,
      }
    : null;

  return { parkingCandidates, trailheadCandidates, selectedTrailhead, selectedParking };
}
