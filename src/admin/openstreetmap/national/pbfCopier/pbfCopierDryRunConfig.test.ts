import { describe, expect, it } from "vitest";
import { buildPbfCopierConfig } from "./pbfCopierService.js";
import {
  BBOX_EXHAUSTIVE_PREVIEW_LIMIT,
  HARTLAND_VT_CENTER,
  resolveGeoFilterBbox,
} from "./pbfCopierGeoFilter.js";
import { isPointInBbox } from "../../../../lib/inventory/inventoryBbox.js";

describe("buildPbfCopierConfig geo filter", () => {
  it("enables exhaustive bbox mode when geoFilterEnabled", () => {
    const config = buildPbfCopierConfig({
      filePath: "./data/osm/vermont-latest.osm.pbf",
      geoFilterEnabled: true,
      geoFilterCenterLat: HARTLAND_VT_CENTER.lat,
      geoFilterCenterLng: HARTLAND_VT_CENTER.lng,
      geoFilterRadiusKm: 12,
      maxAcceptedMode: true,
      dryRunLimit: 100,
      includePublicOnly: true,
      includeReviewDocs: false,
    });
    expect(config.geoFilterEnabled).toBe(true);
    expect(config.maxAcceptedMode).toBe(false);
    expect(config.dryRunLimit).toBe(BBOX_EXHAUSTIVE_PREVIEW_LIMIT);
    expect(config.includePublicOnly).toBe(false);
    expect(config.includeReviewDocs).toBe(true);
    expect(config.balancedPreview).toBe(true);
    const bbox = resolveGeoFilterBbox(config)!;
    expect(isPointInBbox(HARTLAND_VT_CENTER.lat, HARTLAND_VT_CENTER.lng, bbox)).toBe(true);
    expect(isPointInBbox(44.5, -71.5, bbox)).toBe(false);
  });
});
