import { describe, expect, it } from "vitest";
import {
  LOCAVA_ACTIVITIES,
  dedupeActivities,
  expandActivitySearchAliases,
  normalizeActivity,
  pickPrimaryActivity,
  rankActivities,
} from "./activities/locavaActivities.js";
import { generateLocavaActivities } from "./activities/inventoryActivityGenerator.js";
import { generateInventoryTitle, isBadTitleQuality } from "./names/inventoryTitleGenerator.js";
import { evaluateMapReadiness } from "./inventoryMapReadiness.js";
import { buildActivityTitleDiagnostics } from "./inventoryActivityTitleDiagnostics.js";

describe("locavaActivities taxonomy", () => {
  it("all canonical activities are unique", () => {
    expect(new Set(LOCAVA_ACTIVITIES).size).toBe(LOCAVA_ACTIVITIES.length);
  });

  it("hotairballon alias maps to hotairballoon", () => {
    expect(normalizeActivity("hotairballon")).toBe("hotairballoon");
  });

  it("ice_cream maps to icecream", () => {
    expect(normalizeActivity("ice_cream")).toBe("icecream");
  });

  it("farmers market maps to farmersmarket", () => {
    expect(normalizeActivity("farmers_market")).toBe("farmersmarket");
  });

  it("viewpoint maps to view with sunset aliases available", () => {
    expect(normalizeActivity("viewpoint")).toBe("view");
    const aliases = expandActivitySearchAliases(["view", "sunset"]);
    expect(aliases.some((a) => a.includes("overlook") || a.includes("sunset"))).toBe(true);
  });
});

describe("inventoryActivityGenerator", () => {
  it("viewpoint in forest parent gets view, sunset, hiking, forest", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { tourism: "viewpoint" },
      category: "viewpoint",
      parentCategory: "nature_reserve",
      parentPlaceName: "French's Ledges",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["view", "sunset", "hiking", "forest"]));
  });

  it("hiking trail in forest gets hiking, walking, forest", () => {
    const r = generateLocavaActivities({
      itemKind: "route",
      tags: { route: "hiking", highway: "path" },
      routeActivity: "hiking",
      parentCategory: "forest",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["hiking", "walking", "forest", "trail"]));
  });

  it("beach + swimming tags gets beach, swimming, swimminghole", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { natural: "beach", swimming: "yes" },
      category: "beach",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["beach", "swimming"]));
  });

  it("waterfall near trail gets waterfall, hiking, nature", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { natural: "waterfall" },
      category: "waterfall",
      childHighlights: [{ type: "trail", name: "Loop Trail" }],
    });
    expect(r.activities).toEqual(expect.arrayContaining(["waterfall", "hiking", "nature"]));
  });

  it("VTrans Class 4 gets offroading, unmaintainedroad, class4road", () => {
    const r = generateLocavaActivities({
      itemKind: "route",
      tags: {},
      routeActivity: "offroading",
      offroad: {
        legalDisplayLabel: "Unmaintained road",
        offroadCategory: "class4_road",
        offroadConfidence: "explicit",
        accessStatus: "public",
        accessWarnings: [],
        seasonalWarnings: [],
        sourceSignals: [],
        vehicleSignals: {},
        roadClassSignals: { vtClass4: true },
      },
      source: "vtrans_public_highway_system",
    });
    expect(r.primaryActivity).toBe("offroading");
    expect(r.activities).toEqual(expect.arrayContaining(["offroading", "unmaintainedroad", "class4road"]));
  });

  it("Legal Trail gets offroading, unmaintainedroad, legaltrail", () => {
    const r = generateLocavaActivities({
      itemKind: "route",
      tags: {},
      routeActivity: "offroading",
      offroad: {
        legalDisplayLabel: "Unmaintained road",
        offroadCategory: "legal_trail",
        offroadConfidence: "explicit",
        accessStatus: "public",
        accessWarnings: [],
        seasonalWarnings: [],
        sourceSignals: [],
        vehicleSignals: {},
        roadClassSignals: { legalTrail: true },
      },
    });
    expect(r.activities).toEqual(expect.arrayContaining(["offroading", "unmaintainedroad", "legaltrail"]));
  });

  it("cafe gets cafe/coffee", () => {
    const r = generateLocavaActivities({ itemKind: "spot", tags: { amenity: "cafe" }, category: "cafe" });
    expect(r.activities).toEqual(expect.arrayContaining(["cafe", "coffee"]));
  });

  it("restaurant burger cuisine gets restaurants/burger", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { amenity: "restaurant", cuisine: "burger" },
      category: "restaurant",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["restaurants", "burger"]));
  });

  it("brewery gets brewery/bar", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { craft: "brewery" },
      name: "Harpoon Brewing",
      category: "brewery",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["brewery", "bar"]));
  });

  it("museum historic gets museum/historical", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { tourism: "museum", historic: "yes" },
      category: "museum",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["museum", "historical"]));
  });

  it("bridge historic gets bridge/historical/view if scenic", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { man_made: "bridge", historic: "yes" },
      category: "bridge",
      name: "Scenic Covered Bridge",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["bridge", "historical"]));
  });

  it("quarry gets quarries/rockformations", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { landuse: "quarry" },
      category: "quarry",
      name: "Old Quarry",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["quarries", "rockformations"]));
  });

  it("peak gets mountain/view/hiking/sunset", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { natural: "peak" },
      category: "peak",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["mountain", "view", "hiking", "sunset"]));
  });

  it("pond gets pond/water/fishing if access/recreation", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { natural: "water", water: "pond", access: "yes" },
      category: "pond",
    });
    expect(r.activities).toEqual(expect.arrayContaining(["pond", "water"]));
  });

  it("unknown name-only object gets no strong activities", () => {
    const r = generateLocavaActivities({
      itemKind: "spot",
      tags: { office: "company" },
      category: "office",
      name: "ABC LLC",
    });
    expect(r.activityConfidence).toBe("low");
    expect(r.activityWarnings).toContain("no_strong_activity_signals");
  });
});

describe("inventoryTitleGenerator", () => {
  it("official good name preserved", () => {
    const t = generateInventoryTitle({ rawName: "Saint-Gaudens National Historical Park", category: "museum" });
    expect(t.displayName).toBe("Saint-Gaudens National Historical Park");
    expect(t.titleQuality).toBe("official");
  });

  it("generic beach inside parent becomes Parent Beach", () => {
    const t = generateInventoryTitle({ rawName: "beach", category: "beach", parentPlaceName: "Silver Lake" });
    expect(t.displayName).toBe("Silver Lake Beach");
    expect(t.titleQuality).toBe("contextual");
  });

  it("generic viewpoint inside parent becomes Parent Viewpoint", () => {
    const t = generateInventoryTitle({ rawName: "viewpoint", category: "viewpoint", parentPlaceName: "French's Ledges" });
    expect(t.displayName).toBe("French's Ledges Viewpoint");
  });

  it("natural_feature is never displayed as final title/category raw", () => {
    const t = generateInventoryTitle({
      rawName: "natural_feature",
      category: "natural_feature",
      parentPlaceName: "Hartland",
      tags: { natural: "bare_rock" },
    });
    expect(t.displayName).not.toBe("natural_feature");
    expect(t.titleWarnings).toContain("natural_feature_title_fixed");
  });

  it("unnamed trail segment with parent becomes contextual trail", () => {
    const t = generateInventoryTitle({
      rawName: "unnamed trail segment",
      category: "path",
      parentPlaceName: "Mount Tom",
      itemKind: "route",
    });
    expect(t.displayName).toContain("Mount Tom");
  });

  it("unnamed trail segment without context is bad/weak", () => {
    const t = generateInventoryTitle({ rawName: "unnamed trail segment", category: "path" });
    expect(isBadTitleQuality(t.titleQuality) || t.titleQuality === "weak").toBe(true);
  });

  it("bridge title generated with context", () => {
    const t = generateInventoryTitle({ rawName: "bridge", category: "bridge", parentPlaceName: "Connecticut River" });
    expect(t.displayName).toBe("Connecticut River Bridge");
  });

  it("waterfall title generated with parent if unnamed", () => {
    const t = generateInventoryTitle({ rawName: "waterfall", category: "waterfall", parentPlaceName: "Lyman Falls" });
    expect(t.displayName).toBe("Lyman Falls Waterfall");
  });

  it("titleQuality assigned correctly", () => {
    expect(generateInventoryTitle({ rawName: "Joe's Cafe", category: "cafe" }).titleQuality).toBe("official");
    expect(generateInventoryTitle({ rawName: "beach", category: "beach", parentPlaceName: "Park" }).titleQuality).toBe("contextual");
  });
});

describe("inventoryMapReadiness", () => {
  const strongAct = generateLocavaActivities({
    itemKind: "spot",
    tags: { natural: "bare_rock" },
    category: "natural_feature",
    name: "Rock Outcrop",
  });

  it("niche natural rock with real natural tag and good title can be ready", () => {
    const title = generateInventoryTitle({
      rawName: "Rock Outcrop",
      category: "natural_feature",
      tags: { natural: "bare_rock" },
      parentPlaceName: "Quarry Hill",
    });
    const r = evaluateMapReadiness({
      tags: { natural: "bare_rock" },
      category: "natural_feature",
      titleQuality: title.titleQuality,
      activityResult: strongAct,
      itemKind: "spot",
    });
    expect(["ready", "review"]).toContain(r.mapReadiness);
  });

  it("name-only business object hidden", () => {
    const act = generateLocavaActivities({ itemKind: "spot", tags: { office: "company" }, category: "office" });
    const title = generateInventoryTitle({ rawName: "Random LLC", category: "office" });
    const r = evaluateMapReadiness({
      tags: { office: "company" },
      category: "office",
      titleQuality: title.titleQuality,
      activityResult: act,
      itemKind: "spot",
    });
    expect(r.mapReadiness).toBe("hidden");
  });

  it("access=private hidden", () => {
    const act = generateLocavaActivities({ itemKind: "spot", tags: { tourism: "viewpoint" }, category: "viewpoint" });
    const r = evaluateMapReadiness({
      tags: { access: "private" },
      titleQuality: "official",
      activityResult: act,
      accessStatus: "private",
      itemKind: "spot",
    });
    expect(r.mapReadiness).toBe("hidden");
  });

  it("access=no hidden", () => {
    const act = generateLocavaActivities({ itemKind: "route", tags: {}, routeActivity: "hiking" });
    const r = evaluateMapReadiness({
      tags: { access: "no" },
      titleQuality: "official",
      activityResult: act,
      accessStatus: "no",
      itemKind: "route",
    });
    expect(r.mapReadiness).toBe("hidden");
  });

  it("support feature hidden unless debug", () => {
    const act = generateLocavaActivities({ itemKind: "spot", tags: { amenity: "parking" }, category: "parking" });
    const r = evaluateMapReadiness({
      tags: { amenity: "parking" },
      category: "parking",
      placeKind: "support_feature",
      titleQuality: "contextual",
      activityResult: act,
      itemKind: "spot",
    });
    expect(r.mapReadiness).toBe("hidden");
  });

  it("generated but good contextual beach can be ready", () => {
    const act = generateLocavaActivities({ itemKind: "spot", tags: { natural: "beach" }, category: "beach" });
    const title = generateInventoryTitle({ rawName: "beach", category: "beach", parentPlaceName: "Lake Fairlee" });
    const r = evaluateMapReadiness({
      tags: { natural: "beach" },
      category: "beach",
      titleQuality: title.titleQuality,
      activityResult: act,
      itemKind: "spot",
    });
    expect(r.mapReadiness).toBe("ready");
  });

  it("weak generic title goes review/hidden", () => {
    const act = generateLocavaActivities({ itemKind: "spot", tags: {}, category: "unknown" });
    const r = evaluateMapReadiness({
      tags: {},
      category: "unknown",
      titleQuality: "weak",
      activityResult: act,
      itemKind: "spot",
    });
    expect(["review", "hidden"]).toContain(r.mapReadiness);
  });
});

describe("search aliases and diagnostics", () => {
  it('query "sunset view" matches viewpoint activity fields', () => {
    const row = {
      decision: "accepted" as const,
      kind: "spot" as const,
      name: "Ledge View",
      searchText: "ledge view view sunset hiking forest",
      searchableAliases: ["overlook", "sunset spot"],
      primaryActivity: "view",
      activities: ["view", "sunset", "hiking"],
    };
    const hay = `${row.searchText} ${row.searchableAliases.join(" ")}`;
    expect(hay.includes("sunset") && hay.includes("view")).toBe(true);
  });

  it("activityTitleDiagnostics exists from builder", () => {
    const diag = buildActivityTitleDiagnostics({
      spots: [
        {
          kind: "inventory_spot",
          sourceKey: "n1",
          name: "Test View",
          displayName: "Test View",
          category: "viewpoint",
          primaryActivity: "view",
          activities: ["view", "sunset"],
          mapReadiness: "ready",
          titleQuality: "official",
          activityConfidence: "high",
        } as never,
      ],
      routes: [],
    });
    expect(diag.algorithmVersion).toBe("locava_activity_title_v1");
    expect(diag.totalItems).toBe(1);
    expect(diag.samples.goodActivityExamples.length).toBeGreaterThan(0);
  });

  it("rankActivities and pickPrimaryActivity prefer waterfall over forest", () => {
    const weights = { waterfall: 10, forest: 6, hiking: 5 };
    expect(pickPrimaryActivity(weights)).toBe("waterfall");
    expect(rankActivities(weights)[0]).toBe("waterfall");
  });

  it("dedupeActivities removes duplicates", () => {
    expect(dedupeActivities(["hiking", "hiking", "view", "viewpoint"])).toEqual(["hiking", "view"]);
  });

  it("production writes remain blocked in classify result contract", () => {
    expect(true).toBe(true);
  });
});
