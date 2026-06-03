import { describe, expect, it } from "vitest";
import { DEFAULT_PBF_COPIER_CONFIG, type PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import {
  DEFAULT_GEO_FILTER_RADIUS_KM,
  isGeoFilterExhaustiveMode,
  osmFeatureWithinGeoFilter,
  previewDocWithinGeoFilter,
  HARTLAND_VT_CENTER,
  QUECHEE_VT_CENTER,
  resolveGeoFilterBbox,
  resolveGeoFilterCenter,
} from "./pbfCopierGeoFilter.js";
import { shouldStopDryRunScan } from "./pbfCopierBalancedPreview.js";
import { emptyBalancedPreviewState } from "./pbfCopierBalancedPreview.js";
import type { PbfCopierRun } from "./pbfCopierTypes.js";

function spotDoc(lat: number, lng: number): PbfCopierPreviewDoc {
  return {
    id: `spot:${lat},${lng}`,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: "Test Spot",
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "viewpoint",
    lat,
    lng,
    sourceFamily: "openstreetmap",
    sourceKeys: ["node/1"],
    sourceIds: ["1"],
    osmType: "node",
    osmId: 1,
    origin: "generated_osm",
    mapReadiness: "ready",
    publicMapEligible: true,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "r",
    importPipelineVersion: "v1",
    pbfFilePath: "test.pbf",
    sourceProvider: "osm",
    sourceTagSample: {},
    warnings: [],
  };
}

describe("pbfCopierGeoFilter", () => {
  it("passes all docs when geo filter is disabled", () => {
    const doc = spotDoc(40, -100);
    expect(previewDocWithinGeoFilter(doc, { ...DEFAULT_PBF_COPIER_CONFIG, geoFilterEnabled: false })).toBe(true);
  });

  it("defaults to Hartland MVP when enabled without explicit center", () => {
    const center = resolveGeoFilterCenter({
      ...DEFAULT_PBF_COPIER_CONFIG,
      geoFilterEnabled: true,
      geoFilterCenterLat: null,
      geoFilterCenterLng: null,
    });
    expect(center?.lat).toBe(HARTLAND_VT_CENTER.lat);
    expect(center?.lng).toBe(HARTLAND_VT_CENTER.lng);
  });

  it("uses rectangular bbox (center + radius km)", () => {
    const config = {
      ...DEFAULT_PBF_COPIER_CONFIG,
      geoFilterEnabled: true,
      geoFilterCenterLat: QUECHEE_VT_CENTER.lat,
      geoFilterCenterLng: QUECHEE_VT_CENTER.lng,
      geoFilterRadiusKm: DEFAULT_GEO_FILTER_RADIUS_KM,
    };
    const bbox = resolveGeoFilterBbox(config)!;
    const inside = spotDoc(QUECHEE_VT_CENTER.lat + 0.05, QUECHEE_VT_CENTER.lng + 0.05);
    const outside = spotDoc(44.5, -73.5);
    expect(previewDocWithinGeoFilter(inside, config)).toBe(true);
    expect(previewDocWithinGeoFilter(outside, config)).toBe(false);
  });

  it("includes routes when line intersects bbox", () => {
    const config = {
      ...DEFAULT_PBF_COPIER_CONFIG,
      geoFilterEnabled: true,
      geoFilterCenterLat: QUECHEE_VT_CENTER.lat,
      geoFilterCenterLng: QUECHEE_VT_CENTER.lng,
      geoFilterRadiusKm: 12,
    };
    const route: PbfCopierPreviewDoc = {
      ...spotDoc(44.5, -73.5),
      kind: "unexplored_route",
      collection: "unexploredRoutes",
      routeLineCoordinates: [
        { lat: 44.5, lng: -73.5 },
        { lat: QUECHEE_VT_CENTER.lat, lng: QUECHEE_VT_CENTER.lng },
      ],
      hasRouteGeometry: true,
    };
    expect(previewDocWithinGeoFilter(route, config)).toBe(true);
  });

  it("filters osm features by bbox before classification", () => {
    const config = {
      ...DEFAULT_PBF_COPIER_CONFIG,
      geoFilterEnabled: true,
      geoFilterCenterLat: QUECHEE_VT_CENTER.lat,
      geoFilterCenterLng: QUECHEE_VT_CENTER.lng,
      geoFilterRadiusKm: 12,
    };
    expect(
      osmFeatureWithinGeoFilter({ lat: QUECHEE_VT_CENTER.lat, lng: QUECHEE_VT_CENTER.lng }, config)
    ).toBe(true);
    expect(osmFeatureWithinGeoFilter({ lat: 44.9, lng: -71.5 }, config)).toBe(false);
  });

  it("geo filter mode scans entire file without early stop", () => {
    const config = { ...DEFAULT_PBF_COPIER_CONFIG, geoFilterEnabled: true, dryRunLimit: 20 };
    expect(isGeoFilterExhaustiveMode(config)).toBe(true);
    const run = {
      mode: "dry_run_preview",
      config,
      previewDocs: new Array(5000).fill({}),
    } as unknown as PbfCopierRun;
    expect(shouldStopDryRunScan(run, emptyBalancedPreviewState(), false)).toBe(false);
  });
});
