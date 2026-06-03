import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "./pbfCopierV2QualityFilters.js";
import {
  enrichOutdoorResortClassification,
  isAddressOnlyRecord,
  matchMountainOutdoorQuality,
} from "./pbfCopierV2MountainQuality.js";

function mkDoc(input: {
  displayName: string;
  tags?: Record<string, string>;
  kind?: PbfCopierPreviewDoc["kind"];
  warnings?: string[];
  lat?: number;
  lng?: number;
  osmId?: number;
  routeLineCoordinates?: Array<{ lat: number; lng: number }>;
}): PbfCopierPreviewDoc {
  return {
    id: `test:${input.osmId ?? input.displayName}`,
    kind: input.kind ?? "unexplored_spot",
    collection: input.kind === "unexplored_route" ? "unexploredRoutes" : "unexploredSpots",
    displayName: input.displayName,
    primaryActivity: null,
    activities: [],
    primaryCategory: "osm",
    lat: input.lat ?? 44.53,
    lng: input.lng ?? -72.78,
    sourceFamily: "test",
    sourceKeys: [`node/${input.osmId ?? 1}`],
    sourceIds: [String(input.osmId ?? 1)],
    osmType: "node",
    osmId: input.osmId ?? 1,
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
    warnings: input.warnings ?? [],
    routeLineCoordinates: input.routeLineCoordinates,
  };
}

describe("pbfCopierV2MountainQuality", () => {
  const keepVisible = [
    mkDoc({ displayName: "Smugglers Notch", tags: { place: "pass", name: "Smugglers Notch" } }),
    mkDoc({ displayName: "Mount Mansfield", tags: { natural: "peak", name: "Mount Mansfield" } }),
    mkDoc({ displayName: "Sterling Pond", tags: { natural: "water", name: "Sterling Pond" } }),
    mkDoc({ displayName: "Hell Brook Trailhead", tags: { highway: "trailhead", name: "Hell Brook Trailhead" }, lat: 44.5301, lng: -72.7801, osmId: 55 }),
    mkDoc({
      displayName: "Hell Brook Trail",
      kind: "unexplored_route",
      tags: { highway: "path", name: "Hell Brook Trail" },
      warnings: ["v2_hiking_trail_merged"],
      lat: 44.53,
      lng: -72.78,
      osmId: 56,
      routeLineCoordinates: [
        { lat: 44.530, lng: -72.780 },
        { lat: 44.545, lng: -72.770 },
      ],
    }),
    mkDoc({
      displayName: "Sunset Ridge Trail",
      kind: "unexplored_route",
      tags: { highway: "path", name: "Sunset Ridge Trail" },
      warnings: ["v2_hiking_trail_merged"],
    }),
    mkDoc({
      displayName: "Upper Perry Merrill",
      kind: "unexplored_route",
      tags: { name: "Upper Perry Merrill", "piste:type": "downhill" },
    }),
    mkDoc({ displayName: "Big Spring", tags: { natural: "spring", name: "Big Spring" } }),
    mkDoc({ displayName: "Falls Brook", tags: { waterway: "waterfall", name: "Falls Brook" } }),
    mkDoc({
      displayName: "Historic Marker: Smugglers Notch",
      tags: { historic: "memorial", name: "Historic Marker: Smugglers Notch" },
    }),
  ];

  const hideOrSupport = [
    mkDoc({ displayName: "pylon", tags: { aerialway: "pylon" }, osmId: 901 }),
    mkDoc({
      displayName: "2567",
      tags: { "addr:housenumber": "2567", "addr:street": "Mountain Road", "addr:state": "VT" },
      osmId: 902,
    }),
    mkDoc({ displayName: "2574", tags: { "addr:housenumber": "2574", "ref:vcgi:esiteid": "123" }, osmId: 903 }),
    mkDoc({
      displayName: "information=map",
      tags: { tourism: "information", information: "map" },
      osmId: 904,
      lat: 44.531,
      lng: -72.781,
    }),
    mkDoc({
      displayName: "amenity=toilets",
      tags: { amenity: "toilets" },
      osmId: 905,
      lat: 44.5302,
      lng: -72.7802,
    }),
    mkDoc({ displayName: "natural=bare_rock", tags: { natural: "bare_rock" }, osmId: 906 }),
    mkDoc({ displayName: "natural=cliff", kind: "unexplored_route", tags: { natural: "cliff" }, osmId: 907 }),
    mkDoc({ displayName: "natural=ridge", kind: "unexplored_route", tags: { natural: "ridge" }, osmId: 908 }),
    mkDoc({ displayName: "highway=track", kind: "unexplored_route", tags: { highway: "track" }, osmId: 909 }),
    mkDoc({
      displayName: "piste fragment",
      kind: "unexplored_route",
      tags: { "piste:type": "downhill" },
      osmId: 910,
    }),
    mkDoc({
      displayName: "Forest access track",
      kind: "unexplored_route",
      tags: { highway: "track", name: "Forest access track", foot: "yes" },
      osmId: 911,
      warnings: ["v2_hiking_trail_merged"],
    }),
    mkDoc({
      displayName: "piste:type=downhill",
      kind: "unexplored_route",
      tags: { "piste:type": "downhill", foot: "yes" },
      osmId: 912,
    }),
  ];

  it("detects address-only records", () => {
    expect(isAddressOnlyRecord(mkDoc({ displayName: "2567", tags: { "addr:housenumber": "2567" } }))).toBe(true);
    expect(
      isAddressOnlyRecord(mkDoc({ displayName: "Mount Mansfield", tags: { natural: "peak", name: "Mount Mansfield" } }))
    ).toBe(false);
  });

  it("classifies named ski runs", () => {
    const ski = enrichOutdoorResortClassification(
      mkDoc({ displayName: "Upper Perry Merrill", tags: { name: "Upper Perry Merrill", "piste:type": "downhill" } })
    );
    expect(ski.primaryActivity).toBe("skiing");
    expect(ski.primaryCategory).toBe("ski_run");

    const lift = applyPbfQualityFilters(
      [
        mkDoc({
          displayName: "Sensation Quad",
          kind: "unexplored_route",
          tags: { aerialway: "chair_lift", name: "Sensation Quad" },
        }),
      ],
      DEFAULT_PBF_QUALITY_FILTER_SETTINGS
    );
    expect(lift.items[0]?.filteredOut).toBe(true);
    expect(lift.items[0]?.filterReason).toContain("lift");
  });

  it("filters mountain junk but keeps destinations", () => {
    const sample = [...keepVisible, ...hideOrSupport];
    const result = applyPbfQualityFilters(sample, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);

    const primaryVisible = keepVisible.filter((d) => d.displayName !== "Hell Brook Trailhead");
    for (const doc of primaryVisible) {
      const found = result.items.find((d) => d.displayName === doc.displayName);
      expect(found?.filteredOut, `${doc.displayName} should stay visible`).toBe(false);
    }

    const hellBrookTrail = result.items.find((d) => d.displayName === "Hell Brook Trail");
    const hellBrookTrailhead = result.items.find((d) => d.displayName === "Hell Brook Trailhead");
    expect(hellBrookTrailhead?.filteredOut).toBe(true);
    expect(hellBrookTrailhead?.attachedTo?.displayName).toBe("Hell Brook Trail");
    expect(hellBrookTrail?.supportMetadata?.trailheads?.length).toBe(1);
    expect(hellBrookTrail?.routeMarkerCoordinate?.lat).toBeCloseTo(44.5301, 3);
    expect(result.groupingSummary?.trailheadsAttached).toBeGreaterThanOrEqual(1);

    expect(result.items.find((d) => d.osmId === 901)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 901)?.filterReason).toContain("pylon");
    expect(result.items.find((d) => d.osmId === 906)?.filteredBy).toContain("unnamed_terrain");
    expect(result.items.find((d) => d.osmId === 909)?.filteredBy).toContain("generic_track");
    expect(result.items.find((d) => d.osmId === 910)?.filteredBy).toContain("unnamed_piste");
    expect(result.items.find((d) => d.osmId === 911)?.filteredOut).toBe(false);
    expect(result.items.find((d) => d.osmId === 912)?.filteredOut).toBe(false);

    const mountMansfield = result.items.find((d) => d.displayName === "Mount Mansfield");
    const toilets = result.items.find((d) => d.osmId === 905);
    expect(toilets?.filteredOut).toBe(true);
    expect(toilets?.attachedTo?.displayName).toBeTruthy();
    expect(toilets?.filterReason).toContain("attached to route");
    const toiletHost = result.items.find((d) => (d.supportMetadata?.toilets?.length ?? 0) > 0);
    expect(toiletHost?.supportMetadata?.toilets?.length).toBe(1);

    const infoMap = result.items.find((d) => d.osmId === 904);
    expect(infoMap?.filteredOut).toBe(true);
    expect(infoMap?.filterReason).toMatch(/attached (as support metadata|to route)/);
  });

  it("matchMountainOutdoorQuality returns expected reasons", () => {
    expect(matchMountainOutdoorQuality(mkDoc({ displayName: "pylon", tags: { aerialway: "pylon" } }))?.reason).toContain(
      "pylon"
    );
    expect(matchMountainOutdoorQuality(mkDoc({ displayName: "natural=cliff", tags: { natural: "cliff" } }))?.key).toBe(
      "unnamed_terrain"
    );
  });
});
