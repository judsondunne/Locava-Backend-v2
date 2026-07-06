import { describe, it, expect } from "vitest";
import { pbfPreviewToDiscoveryCandidate } from "./pbfPreviewToDiscoveryCandidate.js";
import { DiscoveryCandidateSchema, normalizeDiscoveryCategory } from "../../contracts/surfaces/undiscovered-candidate.contract.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";

function fakePreview(overrides: Partial<PbfCopierPreviewDoc> = {}): PbfCopierPreviewDoc {
  return {
    id: "x",
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: "Hidden Falls",
    primaryActivity: "waterfall",
    activities: ["waterfall", "swimming"],
    primaryCategory: "waterfall",
    lat: 44.1,
    lng: -72.8,
    sourceFamily: "osm",
    sourceKeys: ["natural=waterfall"],
    sourceIds: ["node/42"],
    osmType: "node",
    osmId: 42,
    origin: "generated_osm",
    mapReadiness: "ready",
    publicMapEligible: true,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "run1",
    importPipelineVersion: "v2",
    pbfFilePath: "/tmp/vt.osm.pbf",
    sourceProvider: "osm-pbf",
    sourceTagSample: {},
    warnings: [],
    ...overrides,
  } as PbfCopierPreviewDoc;
}

describe("pbfPreviewToDiscoveryCandidate", () => {
  it("maps a passing spot into a valid candidate", () => {
    const c = pbfPreviewToDiscoveryCandidate(fakePreview(), { region: "VT", nowIso: "2026-06-25T00:00:00.000Z" });
    expect(() => DiscoveryCandidateSchema.parse(c)).not.toThrow();
    expect(c.id).toBe("osm_pbf:node:42");
    expect(c.region).toBe("VT");
    expect(c.sourceChannel).toBe("osm_pbf");
    expect(c.kind).toBe("spot");
    expect(c.targetCollection).toBe("unexploredSpots");
    expect(c.primaryCategory).toBe("waterfall");
    expect(c.qualityGate.passed).toBe(true);
  });

  it("marks hidden previews as failing the quality gate", () => {
    const c = pbfPreviewToDiscoveryCandidate(fakePreview({ mapReadiness: "hidden" }), { region: "VT" });
    expect(c.qualityGate.passed).toBe(false);
    expect(c.qualityGate.reasons.length).toBeGreaterThan(0);
  });

  it("routes map to unexploredRoutes", () => {
    const c = pbfPreviewToDiscoveryCandidate(
      fakePreview({ kind: "unexplored_route", collection: "unexploredRoutes", osmType: "way", osmId: 7 }),
      { region: "VT" },
    );
    expect(c.kind).toBe("route");
    expect(c.targetCollection).toBe("unexploredRoutes");
    expect(c.id).toBe("osm_pbf:way:7");
  });

  it("normalizeDiscoveryCategory buckets raw strings", () => {
    expect(normalizeDiscoveryCategory("scenic viewpoint")).toBe("summit_viewpoint");
    expect(normalizeDiscoveryCategory("hiking")).toBe("hiking_trail");
    expect(normalizeDiscoveryCategory("some random amenity")).toBe("other");
  });
});
