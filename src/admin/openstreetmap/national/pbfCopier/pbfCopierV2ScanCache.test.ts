import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "./pbfCopierV2QualityFilters.js";
import {
  clearPbfCopierV2ScanCacheForTests,
  getPbfCopierV2ScanCache,
  storePbfCopierV2ScanCache,
} from "./pbfCopierV2ScanCache.js";

function mkDoc(name: string, osmId: number): PbfCopierPreviewDoc {
  return {
    id: `test:${osmId}`,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: name,
    primaryActivity: null,
    activities: [],
    primaryCategory: "osm",
    lat: 44.5,
    lng: -72.5,
    sourceFamily: "test",
    sourceKeys: [`node/${osmId}`],
    sourceIds: [String(osmId)],
    osmType: "node",
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
    sourceTagSample: { name },
    warnings: [],
  };
}

describe("pbfCopierV2ScanCache", () => {
  it("stores and retrieves scan items for quality filter reapply", () => {
    clearPbfCopierV2ScanCacheForTests();
    const items = [mkDoc("Peak A", 1), mkDoc("Peak B", 2)];
    const cacheId = storePbfCopierV2ScanCache("/tmp/vt.pbf", items);
    const cached = getPbfCopierV2ScanCache(cacheId);
    expect(cached?.length).toBe(2);

    const filtered = applyPbfQualityFilters(cached!, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
    expect(filtered.items.length).toBe(2);
    expect(filtered.summary.rawItems).toBe(2);
  });

  it("returns null for unknown cache id", () => {
    clearPbfCopierV2ScanCacheForTests();
    expect(getPbfCopierV2ScanCache("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
