import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "./pbfCopierV2QualityFilters.js";
import {
  buildOutdoorDestinationGroups,
  computeRouteMarkerCoordinate,
  isNamedOutdoorRoute,
  routeDestinationGroupId,
} from "./pbfCopierV2OutdoorDestinationGroups.js";

function mkRoute(name: string, coords: Array<{ lat: number; lng: number }>, osmId = 1): PbfCopierPreviewDoc {
  return {
    id: `test:route:${osmId}`,
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName: name,
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "hiking",
    lat: coords[0]!.lat,
    lng: coords[0]!.lng,
    sourceFamily: "test",
    sourceKeys: [`way/${osmId}`],
    sourceIds: [String(osmId)],
    osmType: "way",
    osmId,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "test",
    pbfFilePath: "/tmp/test.pbf",
    sourceProvider: "test",
    sourceTagSample: { highway: "path", name },
    warnings: ["v2_hiking_trail_merged"],
    routeLineCoordinates: coords,
    filteredOut: false,
    filteredBy: [],
    filterReason: "",
  };
}

function mkSpot(input: {
  displayName: string;
  tags?: Record<string, string>;
  lat: number;
  lng: number;
  osmId: number;
}): PbfCopierPreviewDoc {
  return {
    id: `test:spot:${input.osmId}`,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: input.displayName,
    primaryActivity: null,
    activities: [],
    primaryCategory: "osm",
    lat: input.lat,
    lng: input.lng,
    sourceFamily: "test",
    sourceKeys: [`node/${input.osmId}`],
    sourceIds: [String(input.osmId)],
    osmType: "node",
    osmId: input.osmId,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "test",
    pbfFilePath: "/tmp/test.pbf",
    sourceProvider: "test",
    sourceTagSample: input.tags ?? {},
    warnings: [],
    filteredOut: false,
    filteredBy: [],
    filterReason: "",
  };
}

describe("pbfCopierV2OutdoorDestinationGroups", () => {
  it("builds route group id and detects named outdoor routes", () => {
    const route = mkRoute("Hell Brook Trail", [
      { lat: 44.53, lng: -72.78 },
      { lat: 44.55, lng: -72.77 },
    ]);
    expect(isNamedOutdoorRoute(route)).toBe(true);
    expect(routeDestinationGroupId(route)).toBe("route:way:1");
  });

  it("attaches Hell Brook Trailhead and parking to Hell Brook Trail", () => {
    const trail = mkRoute(
      "Hell Brook Trail",
      [
        { lat: 44.530, lng: -72.780 },
        { lat: 44.545, lng: -72.770 },
      ],
      100
    );
    const trailhead = mkSpot({
      displayName: "Hell Brook Trailhead",
      tags: { highway: "trailhead", name: "Hell Brook Trailhead" },
      lat: 44.5301,
      lng: -72.7801,
      osmId: 101,
    });
    const parking = mkSpot({
      displayName: "Hell Brook Parking",
      tags: { amenity: "parking", name: "Hell Brook Parking" },
      lat: 44.5302,
      lng: -72.7802,
      osmId: 102,
    });

    const grouped = buildOutdoorDestinationGroups([trail, trailhead, parking], {
      showSupportObjectsAsMarkers: false,
    });

    const route = grouped.items.find((d) => d.osmId === 100)!;
    const th = grouped.items.find((d) => d.osmId === 101)!;
    const lot = grouped.items.find((d) => d.osmId === 102)!;

    expect(grouped.summary.trailheadsAttached).toBe(1);
    expect(grouped.summary.parkingAttachedToRoutes).toBe(1);
    expect(route.supportMetadata?.trailheads?.length).toBe(1);
    expect(route.supportMetadata?.parking?.length).toBe(1);
    expect(th.filteredOut).toBe(true);
    expect(th.filterReason).toContain("trailhead attached to route");
    expect(lot.filteredOut).toBe(true);
    expect(lot.attachedTo?.displayName).toBe("Hell Brook Trail");
  });

  it("places route marker at trailhead not mountain midpoint", () => {
    const trail = mkRoute(
      "Hell Brook Trail",
      [
        { lat: 44.530, lng: -72.780 },
        { lat: 44.550, lng: -72.760 },
      ],
      200
    );
    const trailhead = mkSpot({
      displayName: "Hell Brook Trailhead",
      tags: { highway: "trailhead", name: "Hell Brook Trailhead" },
      lat: 44.5301,
      lng: -72.7801,
      osmId: 201,
    });

    const grouped = buildOutdoorDestinationGroups([trail, trailhead], { showSupportObjectsAsMarkers: false });
    const route = grouped.items.find((d) => d.osmId === 200)!;
    const marker = computeRouteMarkerCoordinate(route);
    expect(marker.lat).toBeCloseTo(44.5301, 3);
    expect(marker.lng).toBeCloseTo(-72.7801, 3);
  });

  it("renames unnamed waterfall near a named trail", () => {
    const trail = mkRoute(
      "Hell Brook Trail",
      [
        { lat: 44.530, lng: -72.780 },
        { lat: 44.545, lng: -72.770 },
      ],
      400
    );
    const waterfall = mkSpot({
      displayName: "waterway=waterfall",
      tags: { waterway: "waterfall" },
      lat: 44.531,
      lng: -72.779,
      osmId: 401,
    });

    const grouped = buildOutdoorDestinationGroups([trail, waterfall], { showSupportObjectsAsMarkers: false });
    const wf = grouped.items.find((d) => d.osmId === 401)!;
    expect(wf.displayName).toBe("Hell Brook Trail Waterfall");
    expect(wf.derivedName).toBe(true);
    expect(wf.nameSource).toBe("nearby_route");
    expect(wf.filteredOut).toBe(false);
  });

  it("hides junk like snow cannon and municipal forest without recreation access", () => {
    const items = [
      mkRoute("Hell Brook Trail", [{ lat: 44.53, lng: -72.78 }, { lat: 44.54, lng: -72.77 }], 300),
      mkSpot({
        displayName: "Morristown Municipal Forest",
        tags: { landuse: "forest", name: "Morristown Municipal Forest" },
        lat: 44.5,
        lng: -72.5,
        osmId: 301,
      }),
      mkSpot({ displayName: "snow cannon", tags: { man_made: "snow_cannon" }, lat: 44.51, lng: -72.51, osmId: 302 }),
    ];
    const result = applyPbfQualityFilters(items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    expect(result.groupingSummary?.routeGroupsBuilt).toBe(1);
    expect(result.items.find((d) => d.osmId === 302)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 301)?.filteredOut).toBe(true);
  });
});
