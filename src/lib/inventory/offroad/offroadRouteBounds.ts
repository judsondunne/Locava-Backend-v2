import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import { routeIntersectsBbox } from "./inventoryOffroadMerge.js";

export function filterRoutesToStateBbox(routes: LocavaInventoryRoute[], stateBbox: InventoryBbox): LocavaInventoryRoute[] {
  return routes.filter((route) => routeIntersectsBbox(route, stateBbox));
}

export function unionBoundsForRoutes(routes: LocavaInventoryRoute[]): InventoryBbox | null {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  let points = 0;

  for (const route of routes) {
    const coords = route.segments?.flat() ?? route.coordinates ?? [];
    for (const c of coords) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
      points += 1;
    }
    if (route.bbox && points === 0) {
      minLat = Math.min(minLat, route.bbox.minLat);
      maxLat = Math.max(maxLat, route.bbox.maxLat);
      minLng = Math.min(minLng, route.bbox.minLng);
      maxLng = Math.max(maxLng, route.bbox.maxLng);
      points += 1;
    }
  }

  if (points === 0) return null;
  return { minLat, minLng, maxLat, maxLng };
}
