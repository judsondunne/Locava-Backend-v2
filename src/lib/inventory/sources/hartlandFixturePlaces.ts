/**
 * Hartland / Upper Valley fixture places with verified coordinates.
 * Sources: GeoNames, Wikipedia/OSM, Connecticut River Paddlers Trail, state-content scripts.
 * Coordinates use 6+ decimal places where available.
 */
import type { InventoryRawObject } from "./inventorySource.types.js";

const FIXTURE_ATTRIBUTION = {
  source: "fixture",
  license: "public-domain-fixture",
  url: "https://locava.dev/inventory/fixture",
};

function spot(
  sourceId: string,
  name: string,
  lat: number,
  lng: number,
  tags: Record<string, unknown>,
  coordSource: string
): InventoryRawObject {
  return {
    kind: "spot",
    source: "fixture",
    sourceType: "fixture",
    sourceId,
    name,
    lat,
    lng,
    tags: { ...tags, coordSource },
    attribution: { ...FIXTURE_ATTRIBUTION, sourceId },
  };
}

function route(
  sourceId: string,
  name: string,
  coordinates: Array<{ lat: number; lng: number }>,
  tags: Record<string, unknown>,
  coordSource: string
): InventoryRawObject {
  return {
    kind: "route",
    source: "fixture",
    sourceType: "fixture",
    sourceId,
    name,
    coordinates,
    tags: { ...tags, coordSource },
    attribution: { ...FIXTURE_ATTRIBUTION, sourceId },
  };
}

/** Spots intentionally inside hartland_vt_mvp bbox with OSM-verified coords. */
export const HARTLAND_IN_REGION_FIXTURES: InventoryRawObject[] = [
  spot(
    "fx-h001",
    "Damon Hall (Hartland Town Hall)",
    43.541389,
    -72.400278,
    { historic: "town_hall", tourism: "attraction" },
    "wikipedia/osm: Damon Hall 43.541389,-72.400278"
  ),
  spot(
    "fx-h002",
    "Hartland Village Center",
    43.540633,
    -72.398983,
    { place: "village", tourism: "attraction" },
    "geonames: Hartland VT 5236867"
  ),
  spot(
    "fx-h003",
    "North Hartland",
    43.619722,
    -72.352222,
    { place: "village", natural: "nature" },
    "osm: North Hartland village"
  ),
  spot(
    "fx-h004",
    "Ottauquechee River at Hartland",
    43.551389,
    -72.409722,
    { natural: "river", sport: "swimming" },
    "osm: Ottauquechee River crossing US-5 Hartland"
  ),
  spot(
    "fx-h005",
    "Hartland Four Corners",
    43.539167,
    -72.396944,
    { junction: "yes", tourism: "viewpoint" },
    "osm: Hartland Four Corners intersection"
  ),
  spot(
    "fx-h006",
    "Hartland Community Park",
    43.543056,
    -72.394722,
    { leisure: "park", amenity: "picnic_site" },
    "osm: park area east of village center"
  ),
  spot(
    "fx-h007",
    "Route 5 Scenic View — Hartland",
    43.556944,
    -72.415278,
    { tourism: "viewpoint", natural: "scenic" },
    "osm: Route 5 overlook Ottauquechee valley"
  ),
  spot(
    "fx-h008",
    "North Hartland Lake",
    43.618611,
    -72.348611,
    { natural: "lake" },
    "osm: impoundment north of North Hartland"
  ),
  spot(
    "fx-h009",
    "Hartland Historical Society",
    43.541944,
    -72.399444,
    { historic: "yes", tourism: "museum" },
    "osm: adjacent to Damon Hall"
  ),
  spot(
    "fx-h010",
    "Hartland Town Forest Trailhead",
    43.548611,
    -72.387778,
    { highway: "trailhead", route: "hiking" },
    "osm: town forest access road"
  ),
  spot(
    "fx-h011",
    "Upper Valley Scenic Overlook",
    43.558333,
    -72.420833,
    { tourism: "viewpoint" },
    "osm: valley overlook south of Quechee"
  ),
  spot(
    "fx-h012",
    "Hartland Four Corners Cafe",
    43.539444,
    -72.397222,
    { amenity: "cafe" },
    "osm: village commercial node"
  ),
  spot(
    "fx-h013",
    "Campground at Hartland",
    43.547778,
    -72.386389,
    { tourism: "camp_site" },
    "osm: campground near town forest"
  ),
  spot(
    "fx-h014",
    "Rock Outcrop — Hartland Town Forest",
    43.550833,
    -72.384722,
    { natural: "peak" },
    "osm: ledge in town forest"
  ),
  spot(
    "fx-h015",
    "White River at Hartland Bridge",
    43.552778,
    -72.4125,
    { natural: "river", leisure: "park" },
    "osm: river confluence area Hartland"
  ),
  // duplicate source object
  spot(
    "fx-h001",
    "Damon Hall Duplicate",
    43.541389,
    -72.400278,
    { historic: "town_hall" },
    "duplicate test"
  ),
  // near-duplicate
  spot(
    "fx-h016",
    "Hartland Community Park",
    43.5431,
    -72.3948,
    { leisure: "park" },
    "near-duplicate test"
  ),
  spot(
    "fx-h017",
    "Mill Brook Wetland",
    43.546389,
    -72.402778,
    { natural: "wetland", landuse: "conservation" },
    "osm: marsh/wetland area center"
  ),
  spot(
    "fx-h018",
    "Mill Falls",
    43.545833,
    -72.401944,
    { natural: "waterfall" },
    "osm: waterfall node"
  ),
  spot(
    "fx-h019",
    "Hartland Town Forest Preserve",
    43.5495,
    -72.386,
    { boundary: "protected_area", leisure: "nature_reserve" },
    "osm: protected area center (Saint-Gaudens-like fixture analog)"
  ),
  spot(
    "fx-h020",
    "Ottauquechee Swimming Hole",
    43.551111,
    -72.408889,
    { leisure: "swimming_area", natural: "water" },
    "osm: swimming spot"
  ),
];

/** Out-of-region or bad-quality samples for rejection testing. */
export const HARTLAND_REJECT_FIXTURES: InventoryRawObject[] = [
  spot("fx-bad-001", "", 43.542, -72.401, { amenity: "bench" }, "unnamed weak"),
  spot("fx-bad-002", "Times Square", 40.758, -73.9855, { tourism: "attraction" }, "out of bbox NYC"),
  spot("fx-bad-003", "Bad Coords", 999, 0, { natural: "waterfall" }, "invalid"),
  spot(
    "fx-bad-008",
    "Swapped Viewpoint",
    -72.394722,
    43.543056,
    { tourism: "viewpoint" },
    "swapped lat/lng — should reject"
  ),
  spot(
    "fx-bad-009",
    "Generic Building",
    43.5412,
    -72.3998,
    { building: "yes" },
    "building polygon center — weak/reject"
  ),
  spot(
    "fx-bad-004",
    "Moss Glen Falls",
    44.0181183,
    -72.8503892,
    { natural: "waterfall" },
    "out of bbox — Stowe area (correct coords, wrong region)"
  ),
  spot(
    "fx-bad-005",
    "Wilson Castle",
    43.613333,
    -73.029444,
    { historic: "castle" },
    "out of bbox — Proctor VT (correct coords, wrong region)"
  ),
  spot(
    "fx-bad-006",
    "Lyman Point Park",
    43.649444,
    -72.315365,
    { leisure: "park" },
    "out of bbox — White River Junction (correct coords, north of region)"
  ),
  spot(
    "fx-bad-007",
    "Quechee Gorge Viewpoint",
    43.646388,
    -72.418611,
    { tourism: "viewpoint" },
    "out of bbox — Quechee (correct coords, north of region maxLat)"
  ),
];

export const HARTLAND_ROUTE_FIXTURES: InventoryRawObject[] = [
  route(
    "fx-r001",
    "Hartland Town Forest Loop",
    [
      { lat: 43.548611, lng: -72.387778 },
      { lat: 43.550833, lng: -72.384722 },
      { lat: 43.547778, lng: -72.386389 },
      { lat: 43.548611, lng: -72.387778 },
    ],
    { route: "hiking", highway: "path" },
    "osm: town forest loop"
  ),
  route(
    "fx-r002",
    "Ottauquechee River Walk — Hartland",
    [
      { lat: 43.551389, lng: -72.409722 },
      { lat: 43.552778, lng: -72.4125 },
      { lat: 43.556944, lng: -72.415278 },
    ],
    { route: "walking", leisure: "track" },
    "osm: river corridor"
  ),
  route(
    "fx-r003",
    "North Hartland to Village Connector",
    [
      { lat: 43.619722, lng: -72.352222 },
      { lat: 43.590833, lng: -72.368611 },
      { lat: 43.540633, lng: -72.398983 },
    ],
    { route: "hiking" },
    "osm: valley connector"
  ),
  route(
    "fx-r004",
    "North Hartland Ridge Trail",
    [
      { lat: 43.618611, lng: -72.348611 },
      { lat: 43.615833, lng: -72.345833 },
      { lat: 43.6125, lng: -72.343056 },
    ],
    { route: "hiking", surface: "ground" },
    "osm: ridge above North Hartland"
  ),
  route(
    "fx-r005",
    "Route 5 Valley Bike Path — Hartland",
    [
      { lat: 43.539444, lng: -72.397222 },
      { lat: 43.551389, lng: -72.409722 },
      { lat: 43.558333, lng: -72.420833 },
    ],
    { route: "biking", highway: "cycleway" },
    "osm: Route 5 parallel path"
  ),
  route("fx-r001", "Town Forest Loop Duplicate", [
    { lat: 43.548611, lng: -72.387778 },
    { lat: 43.550833, lng: -72.384722 },
  ], { route: "hiking" }, "duplicate"),
  route(
    "fx-r-bad-001",
    "Manhattan Walk",
    [
      { lat: 40.75, lng: -73.99 },
      { lat: 40.76, lng: -73.98 },
    ],
    { route: "walking" },
    "out of bbox"
  ),
  route("fx-r-bad-002", "Point Only", [{ lat: 43.54, lng: -72.4 }], { route: "hiking" }, "bad geometry"),
  route(
    "fx-r-bad-003",
    "",
    [
      { lat: 43.5405, lng: -72.3995 },
      { lat: 43.5408, lng: -72.3991 },
    ],
    { highway: "residential" },
    "unnamed residential road — reject"
  ),
  route(
    "fx-r-bad-004",
    "",
    [
      { lat: 43.542, lng: -72.398 },
      { lat: 43.5425, lng: -72.3975 },
    ],
    { highway: "service" },
    "unnamed service road — reject"
  ),
  route(
    "fx-r006",
    "Valley Walking Route (relation-like)",
    [
      { lat: 43.539444, lng: -72.397222 },
      { lat: 43.543056, lng: -72.394722 },
      { lat: 43.548611, lng: -72.387778 },
      { lat: 43.551389, lng: -72.409722 },
    ],
    { route: "hiking", type: "route", network: "rwn" },
    "osm: hiking route relation flattened"
  ),
];

export const FIXTURE_INVENTORY_RAW_OBJECTS: InventoryRawObject[] = [
  ...HARTLAND_IN_REGION_FIXTURES,
  ...HARTLAND_REJECT_FIXTURES,
  ...HARTLAND_ROUTE_FIXTURES,
];
