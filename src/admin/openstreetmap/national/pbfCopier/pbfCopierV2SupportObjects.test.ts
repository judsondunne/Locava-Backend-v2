import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "./pbfCopierV2QualityFilters.js";
import {
  applyPbfSupportRelationships,
  DEFAULT_PBF_SUPPORT_OBJECT_SETTINGS,
  isPrimaryDestination,
  isSupportParking,
} from "./pbfCopierV2SupportObjects.js";

function mkDoc(input: {
  displayName: string;
  tags?: Record<string, string>;
  kind?: PbfCopierPreviewDoc["kind"];
  warnings?: string[];
  lat?: number;
  lng?: number;
  osmId?: number;
  bbox?: PbfCopierPreviewDoc["bbox"];
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
    lat: input.lat ?? 43.7,
    lng: input.lng ?? -72.3,
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
    bbox: input.bbox,
    routeLineCoordinates: input.routeLineCoordinates,
  };
}

describe("pbfCopierV2SupportObjects", () => {
  it("identifies primary destinations from recent export categories", () => {
    expect(isPrimaryDestination(mkDoc({ displayName: "Montshire Museum of Science", tags: { tourism: "museum", name: "Montshire Museum of Science" } }))).toBe(true);
    expect(isPrimaryDestination(mkDoc({ displayName: "King Arthur Baking Company", tags: { shop: "bakery", name: "King Arthur Baking Company" } }))).toBe(true);
    expect(isPrimaryDestination(mkDoc({ displayName: "Mink Brook Swimming Area", tags: { leisure: "swimming_area", name: "Mink Brook Swimming Area" } }))).toBe(true);
    expect(isPrimaryDestination(mkDoc({ displayName: "Ledyard Bridge", tags: { man_made: "bridge", name: "Ledyard Bridge" } }))).toBe(true);
    expect(isPrimaryDestination(mkDoc({ displayName: "Parking Lot", tags: { amenity: "parking" } }))).toBe(false);
  });

  it("attaches nearby parking to trailhead and hides it as primary marker", () => {
    const trailhead = mkDoc({
      displayName: "Hazen Trailhead",
      osmId: 10,
      lat: 43.642,
      lng: -72.408,
      tags: { highway: "trailhead", name: "Hazen Trailhead" },
    });
    const parking = mkDoc({
      displayName: "Hazen Trailhead Parking",
      osmId: 11,
      lat: 43.6422,
      lng: -72.4082,
      tags: { amenity: "parking", name: "Hazen Trailhead Parking" },
    });
    expect(isSupportParking(parking)).toBe(true);

    const enriched = applyPbfSupportRelationships([trailhead, parking], DEFAULT_PBF_SUPPORT_OBJECT_SETTINGS);
    const dest = enriched.find((d) => d.osmId === 10);
    const lot = enriched.find((d) => d.osmId === 11);

    expect(dest?.supportMetadata?.parking?.length).toBe(1);
    expect(lot?.attachedTo?.osmId).toBe(10);

    const filtered = applyPbfQualityFilters([trailhead, parking], DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    const filteredParking = filtered.items.find((d) => d.osmId === 11);
    expect(filteredParking?.filteredOut).toBe(true);
    expect(filteredParking?.filterReason).toContain("attached as support metadata");
  });

  it("attaches bench near named park and hides unattached benches", () => {
    const park = mkDoc({
      displayName: "Foley Park",
      osmId: 20,
      lat: 43.701,
      lng: -72.301,
      tags: { leisure: "park", name: "Foley Park" },
      bbox: { minLat: 43.700, minLng: -72.302, maxLat: 43.702, maxLng: -72.300 },
    });
    const bench = mkDoc({
      displayName: "amenity=bench",
      osmId: 21,
      lat: 43.7011,
      lng: -72.3011,
      tags: { amenity: "bench" },
    });
    const lonelyBench = mkDoc({
      displayName: "amenity=bench",
      osmId: 22,
      lat: 43.5,
      lng: -72.5,
      tags: { amenity: "bench" },
    });

    const filtered = applyPbfQualityFilters([park, bench, lonelyBench], DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    const parkOut = filtered.items.find((d) => d.osmId === 20);
    const attachedBench = filtered.items.find((d) => d.osmId === 21);
    const lonely = filtered.items.find((d) => d.osmId === 22);

    expect(parkOut?.supportMetadata?.benches?.length).toBe(1);
    expect(attachedBench?.filteredOut).toBe(true);
    expect(attachedBench?.attachedTo?.displayName).toBe("Foley Park");
    expect(lonely?.filteredOut).toBe(true);
    expect(lonely?.filteredBy).toContain("tiny_non_destination_amenity");
  });

  it("shows attached support markers when toggle enabled", () => {
    const park = mkDoc({
      displayName: "Foley Park",
      osmId: 30,
      lat: 43.701,
      lng: -72.301,
      tags: { leisure: "park", name: "Foley Park" },
    });
    const bench = mkDoc({
      displayName: "amenity=bench",
      osmId: 31,
      lat: 43.70105,
      lng: -72.30105,
      tags: { amenity: "bench" },
    });

    const filtered = applyPbfQualityFilters([park, bench], {
      ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
      showSupportObjectsAsMarkers: true,
    });
    const benchOut = filtered.items.find((d) => d.osmId === 31);
    expect(benchOut?.filteredOut).toBe(false);
  });
});
