import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "./pbfCopierV2QualityFilters.js";
import {
  canonicalizePreviewDocActivities,
  deriveCanonicalActivityState,
  isRawOsmTagActivityString,
} from "./pbfCopierV2CanonicalActivities.js";
import { isLocavaActivity } from "../../../../lib/inventory/activities/locavaActivities.js";
import { enrichUnnamedOutdoorDisplayNames } from "./pbfCopierV2GeneratedDisplayNames.js";

function mkDoc(input: {
  displayName: string;
  tags?: Record<string, string>;
  primaryActivity?: string | null;
  activities?: string[];
  primaryCategory?: string;
  warnings?: string[];
  osmId?: number;
  kind?: PbfCopierPreviewDoc["kind"];
}): PbfCopierPreviewDoc {
  return {
    id: `test:${input.osmId ?? input.displayName}`,
    kind: input.kind ?? "unexplored_spot",
    collection: input.kind === "unexplored_route" ? "unexploredRoutes" : "unexploredSpots",
    displayName: input.displayName,
    primaryActivity: input.primaryActivity ?? null,
    activities: input.activities ?? [],
    primaryCategory: input.primaryCategory ?? "osm",
    lat: 43.646,
    lng: -72.419,
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
  };
}

describe("pbfCopierV2CanonicalActivities", () => {
  it("detects raw OSM tag activity strings", () => {
    expect(isRawOsmTagActivityString("landuse=retail")).toBe(true);
    expect(isRawOsmTagActivityString("building=service")).toBe(true);
    expect(isRawOsmTagActivityString("place=island")).toBe(true);
    expect(isRawOsmTagActivityString("yes")).toBe(true);
    expect(isRawOsmTagActivityString("hiking")).toBe(false);
    expect(isRawOsmTagActivityString("wateraccess")).toBe(false);
  });

  it("canonicalizes water access and islands without raw tag leaks", () => {
    const water = canonicalizePreviewDocActivities(
      mkDoc({
        displayName: "Water Access",
        tags: { natural: "water", water: "pond" },
        primaryActivity: "natural=water",
        activities: ["natural=water"],
        warnings: ["v2_generated_outdoor_name"],
      })
    );
    expect(water.primaryActivity).toBe("pond");
    expect(water.activities).not.toContain("natural=water");
    expect(water.activities.some((a) => a.includes("="))).toBe(false);
    expect(water.rawTagActivitySuppressed).toContain("natural=water");

    const island = canonicalizePreviewDocActivities(
      mkDoc({
        displayName: "Loon Island",
        tags: { place: "island", name: "Loon Island" },
        primaryActivity: "place=island",
        activities: ["place=island"],
      })
    );
    expect(island.primaryActivity).toBe("island");
    expect(island.activities).toEqual(expect.arrayContaining(["island", "nature"]));
    expect(island.activities).not.toContain("place=island");
  });

  it("maps named retail landuse to shopping, never landuse=retail", () => {
    const village = canonicalizePreviewDocActivities(
      mkDoc({
        displayName: "Quechee Gorge Village",
        tags: { landuse: "retail", name: "Quechee Gorge Village" },
        primaryActivity: "landuse=retail",
        activities: ["landuse=retail"],
        primaryCategory: "landuse=retail",
      })
    );
    expect(village.primaryActivity).toBe("shopping");
    expect(village.activities).not.toContain("landuse=retail");
    expect(village.activities).toEqual(expect.arrayContaining(["shopping", "market"]));
  });

  it("hides building junk and raw-only activity leaks in quality pipeline", () => {
    const items = [
      mkDoc({
        displayName: "building=service",
        tags: { building: "service" },
        primaryActivity: "building=service",
        activities: ["building=service"],
        osmId: 1,
      }),
      mkDoc({
        displayName: "building:part=roof",
        tags: { "building:part": "roof", building: "yes" },
        primaryActivity: "building:part=roof",
        activities: ["building:part=roof"],
        osmId: 2,
      }),
      mkDoc({
        displayName: "landuse=grass",
        tags: { landuse: "grass" },
        primaryActivity: "landuse=grass",
        activities: ["landuse=grass"],
        osmId: 3,
      }),
      mkDoc({
        displayName: "shop=clothes",
        tags: { shop: "clothes", name: "Local Boutique" },
        primaryActivity: "shop=clothes",
        activities: ["shop=clothes"],
        osmId: 4,
      }),
      mkDoc({
        displayName: "Water Access",
        tags: { natural: "water", waterway: "river" },
        osmId: 5,
      }),
      mkDoc({
        displayName: "Quechee Gorge Village",
        tags: { landuse: "retail", name: "Quechee Gorge Village" },
        osmId: 6,
      }),
    ];

    const withNames = enrichUnnamedOutdoorDisplayNames(items);
    const result = applyPbfQualityFilters(withNames, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);

    const visible = result.items.filter((d) => !d.filteredOut);
    for (const doc of visible) {
      expect(doc.activities.every((a) => !a.includes("=") && a !== "yes")).toBe(true);
      expect(doc.primaryActivity && !doc.primaryActivity.includes("=")).toBe(true);
      if (doc.primaryActivity) expect(isLocavaActivity(doc.primaryActivity) || doc.primaryActivity === "train_bridge").toBe(true);
    }

    expect(result.items.find((d) => d.osmId === 1)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 2)?.filteredOut).toBe(true);
    expect(result.items.find((d) => d.osmId === 3)?.filteredOut).toBe(true);

    const water = result.items.find((d) => d.osmId === 5);
    expect(water?.filteredOut).toBe(false);
    expect(water?.primaryActivity).toMatch(/water|river|wateraccess/);

    const village = result.items.find((d) => d.osmId === 6);
    expect(village?.filteredOut).toBe(false);
    expect(village?.primaryActivity).toBe("shopping");
    expect(village?.activities).not.toContain("landuse=retail");

    const boutique = result.items.find((d) => d.osmId === 4);
    expect(boutique?.filteredOut).toBe(false);
    expect(boutique?.primaryActivity).toBe("shopping");
  });

  it("records debug evidence fields", () => {
    const state = deriveCanonicalActivityState(
      mkDoc({
        displayName: "North Beach",
        tags: { natural: "beach", name: "North Beach" },
        primaryActivity: "natural=beach",
        activities: ["natural=beach"],
      })
    );
    expect(state.activityEvidence).toBeDefined();
    expect(state.canonicalActivitySource).toContain("osm_tags");
    expect(state.rawTagActivitySuppressed).toContain("natural=beach");
    expect(state.primaryActivity).toBe("beach");
  });
});
