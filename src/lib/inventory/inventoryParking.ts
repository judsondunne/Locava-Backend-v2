import { haversineMeters } from "./inventoryTileGrid.js";
import type { LocavaInventorySpot, ParkingSelection, TrailheadSelection } from "./inventoryLocavaTypes.js";

export type ParkingDiagnostics = {
  routesChecked: number;
  spotsChecked: number;
  routesWithParking: number;
  routesWithoutParking: number;
  outdoorSpotsWithParking: number;
  outdoorSpotsWithoutParking: number;
  privateParkingRejected: number;
  selectedParkingBySource: Record<string, number>;
  selectedTrailheadBySource: Record<string, number>;
  sampleMissingParkingRoutes: Array<Record<string, unknown>>;
  sampleMissingParkingSpots: Array<Record<string, unknown>>;
  sampleSelectedParking: Array<Record<string, unknown>>;
};

const OUTDOOR_PARKING_CATEGORIES = new Set([
  "park",
  "nature_reserve",
  "protected_area",
  "recreation_area",
  "waterfall",
  "viewpoint",
  "beach",
  "swimming",
  "swimming_hole",
  "trailhead",
  "camp_site",
  "campground",
  "historic_site",
  "museum",
  "national_park",
  "historical_park",
]);

const SKIP_PARKING_CATEGORIES = new Set(["cafe", "restaurant", "fast_food", "ice_cream", "bar", "pub"]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

export function shouldComputeSpotParking(spot: LocavaInventorySpot): boolean {
  if (SKIP_PARKING_CATEGORIES.has(spot.category)) return false;
  if (spot.placeKind === "support_feature") return false;
  if (OUTDOOR_PARKING_CATEGORIES.has(spot.category)) return true;
  if (spot.placeKind === "parent_place") return true;
  return false;
}

export function attachSpotParking(input: {
  spots: LocavaInventorySpot[];
  accessFeatures: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; tags: Record<string, string> }>;
}): { spots: LocavaInventorySpot[]; diagnostics: ParkingDiagnostics } {
  let privateParkingRejected = 0;
  const selectedParkingBySource: Record<string, number> = {};
  const selectedTrailheadBySource: Record<string, number> = {};

  const parkingFeatures = input.accessFeatures.filter((a) => {
    if (tag(a.tags, "amenity") !== "parking") return false;
    if (tag(a.tags, "access") === "private" || tag(a.tags, "private") === "yes" || tag(a.tags, "parking") === "private") {
      privateParkingRejected += 1;
      return false;
    }
    return true;
  });

  const trailheadFeatures = input.accessFeatures.filter(
    (a) => tag(a.tags, "highway") === "trailhead" || tag(a.tags, "parking") === "trailhead"
  );

  const spots = input.spots.map((spot) => {
    if (!shouldComputeSpotParking(spot)) return spot;

    const parkingCandidates: ParkingSelection[] = [];
    for (const p of parkingFeatures) {
      const dist = haversineMeters({ lat: spot.lat, lng: spot.lng }, { lat: p.lat, lng: p.lng });
      const maxDist = spot.placeKind === "parent_place" ? 1000 : 600;
      if (dist <= maxDist) {
        parkingCandidates.push({
          lat: p.lat,
          lng: p.lng,
          name: p.name,
          sourceKey: p.sourceKey,
          accessStatus: p.tags.access ?? "unknown",
          distanceToPlaceMeters: Math.round(dist),
          notes: [],
        });
      }
    }
    parkingCandidates.sort((a, b) => (a.distanceToPlaceMeters ?? 0) - (b.distanceToPlaceMeters ?? 0));

    const trailheadCandidates: TrailheadSelection[] = [];
    for (const t of trailheadFeatures) {
      const dist = haversineMeters({ lat: spot.lat, lng: spot.lng }, { lat: t.lat, lng: t.lng });
      if (dist <= 800) {
        trailheadCandidates.push({
          lat: t.lat,
          lng: t.lng,
          name: t.name,
          sourceKey: t.sourceKey,
          source: "explicit_trailhead",
          distanceToPlaceMeters: Math.round(dist),
          notes: [],
        });
      }
    }
    trailheadCandidates.sort((a, b) => (a.distanceToPlaceMeters ?? 0) - (b.distanceToPlaceMeters ?? 0));

    const selectedParking = parkingCandidates[0];
    const selectedTrailhead = trailheadCandidates[0];
    if (selectedParking) selectedParkingBySource.amenity_parking = (selectedParkingBySource.amenity_parking ?? 0) + 1;
    if (selectedTrailhead) selectedTrailheadBySource.explicit_trailhead = (selectedTrailheadBySource.explicit_trailhead ?? 0) + 1;

    return {
      ...spot,
      parking: {
        hasParking: Boolean(selectedParking),
        selectedParking,
        parkingCandidates,
      },
      trailhead: {
        hasTrailhead: Boolean(selectedTrailhead),
        selectedTrailhead,
        trailheadCandidates,
      },
    };
  });

  const outdoorSpots = spots.filter(shouldComputeSpotParking);

  return {
    spots,
    diagnostics: {
      routesChecked: 0,
      spotsChecked: outdoorSpots.length,
      routesWithParking: 0,
      routesWithoutParking: 0,
      outdoorSpotsWithParking: outdoorSpots.filter((s) => s.parking?.hasParking).length,
      outdoorSpotsWithoutParking: outdoorSpots.filter((s) => !s.parking?.hasParking).length,
      privateParkingRejected,
      selectedParkingBySource,
      selectedTrailheadBySource,
      sampleMissingParkingRoutes: [],
      sampleMissingParkingSpots: outdoorSpots.filter((s) => !s.parking?.hasParking).slice(0, 10).map((s) => ({ name: s.name, category: s.category })),
      sampleSelectedParking: outdoorSpots.filter((s) => s.parking?.selectedParking).slice(0, 10).map((s) => ({ name: s.name, parking: s.parking?.selectedParking?.sourceKey })),
    },
  };
}

export function mergeParkingDiagnostics(
  spotDiag: ParkingDiagnostics,
  routes: Array<{ name: string; selectedParking?: unknown; activity?: string }>
): ParkingDiagnostics {
  const routesWithParking = routes.filter((r) => r.selectedParking).length;
  return {
    ...spotDiag,
    routesChecked: routes.length,
    routesWithParking,
    routesWithoutParking: routes.length - routesWithParking,
    sampleMissingParkingRoutes: routes.filter((r) => !r.selectedParking).slice(0, 10).map((r) => ({ name: r.name, activity: r.activity })),
  };
}
