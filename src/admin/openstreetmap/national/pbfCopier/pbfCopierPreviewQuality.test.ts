import { describe, expect, it } from "vitest";
import {
  assertPreviewDocsQuality,
  dedupePreviewDocsByDisplayName,
  finalizePreviewDocsQuality,
  normalizePreviewDisplayName,
  sanitizePreviewDocActivities,
} from "./pbfCopierPreviewQuality.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { isLocavaActivity } from "../../../../lib/inventory/activities/locavaActivities.js";

function mockDoc(overrides: Partial<PbfCopierPreviewDoc> & { id: string; displayName: string }): PbfCopierPreviewDoc {
  return {
    id: overrides.id,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: overrides.displayName,
    primaryActivity: overrides.primaryActivity ?? "hiking",
    activities: overrides.activities ?? ["hiking"],
    primaryCategory: overrides.primaryCategory ?? "park",
    lat: overrides.lat ?? 44.0,
    lng: overrides.lng ?? -72.0,
    sourceFamily: "openstreetmap",
    sourceKeys: [`node/${overrides.id}`],
    sourceIds: [overrides.id],
    osmType: overrides.osmType ?? "node",
    osmId: Number(overrides.id.replace(/\D/g, "") || 1),
    origin: "generated_osm",
    mapReadiness: overrides.mapReadiness ?? "ready",
    publicMapEligible: overrides.publicMapEligible ?? true,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "run",
    importPipelineVersion: "v1",
    pbfFilePath: "./data/osm/vermont-latest.osm.pbf",
    sourceProvider: "pbf",
    sourceTagSample: overrides.sourceTagSample ?? { leisure: "park" },
    warnings: [],
  };
}

describe("pbfCopierPreviewQuality", () => {
  it("normalizes display names conservatively", () => {
    expect(normalizePreviewDisplayName("  Braley   Covered Bridge ")).toBe("braley covered bridge");
    expect(normalizePreviewDisplayName("Walker Swamp.")).toBe("walker swamp");
  });

  it("removes duplicate normalized names keeping stronger doc", () => {
    const docs = [
      mockDoc({ id: "1", displayName: "Walker Swamp", sourceTagSample: { natural: "wetland" }, mapReadiness: "review" }),
      mockDoc({
        id: "2",
        displayName: "Walker Swamp",
        osmType: "way",
        sourceTagSample: { leisure: "park", natural: "water" },
        mapReadiness: "ready",
      }),
    ];
    const { kept, removed } = dedupePreviewDocsByDisplayName(docs);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.id).toBe("2");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.removedId).toBe("1");
  });

  it("sanitizes fake activities and prefers specific primary over nature", () => {
    const sanitized = sanitizePreviewDocActivities(
      mockDoc({
        id: "3",
        displayName: "Test Falls",
        primaryActivity: "nature",
        activities: ["scenic", "waterfall", "nature"],
      })
    );
    expect(sanitized.primaryActivity).toBe("waterfall");
    for (const activity of sanitized.activities) {
      expect(isLocavaActivity(activity)).toBe(true);
    }
    expect(sanitized.activities).not.toContain("scenic");
  });

  it("preserves enriched hiking primary instead of spurious offroading", () => {
    const sanitized = sanitizePreviewDocActivities(
      mockDoc({
        id: "4",
        displayName: "South Road",
        primaryActivity: "hiking",
        primaryCategory: "hiking",
        activities: ["hiking", "snowmobiling", "trail", "walking", "offroading"],
      })
    );
    expect(sanitized.primaryActivity).toBe("hiking");
    expect(sanitized.primaryCategory).toBe("hiking");
  });

  it("finalizePreviewDocsQuality reports diagnostics", () => {
    const { previewDocs, diagnostics } = finalizePreviewDocsQuality([
      mockDoc({ id: "a", displayName: "Alpha", primaryActivity: "waterfall", activities: ["waterfall", "hiking"] }),
      mockDoc({ id: "b", displayName: "Alpha", primaryActivity: "park", activities: ["park"] }),
    ]);
    expect(previewDocs).toHaveLength(1);
    expect(diagnostics.duplicateNamesRemoved).toBe(1);
    expect(assertPreviewDocsQuality(previewDocs).ok).toBe(true);
  });
});
