import { describe, expect, it } from "vitest";
import { classifyOsmFeatureForLocava } from "./inventoryLocavaClassifier.js";
import { DEFAULT_LOCAVA_CLASSIFIER_CONFIG } from "./inventoryLocavaTypes.js";

const cfg = DEFAULT_LOCAVA_CLASSIFIER_CONFIG;

function classify(tags: Record<string, string>, extra: Record<string, unknown> = {}) {
  return classifyOsmFeatureForLocava(
    {
      sourceKey: "node/1",
      sourceType: "node",
      sourceId: "1",
      name: (extra.name as string | null | undefined) ?? tags.name ?? null,
      tags,
      geometryKind: (extra.geometryKind as "point" | "line" | "polygon" | undefined) ?? "point",
      lat: (extra.lat as number | undefined) ?? 43.54,
      lng: (extra.lng as number | undefined) ?? -72.39,
      coordinates: extra.coordinates as Array<{ lat: number; lng: number }> | undefined,
      closed: extra.closed as boolean | undefined,
    },
    cfg
  );
}

describe("parity regression — bad public-ready examples", () => {
  it("rejects Olcot Falls Mobile Home Park", () => {
    const r = classify({ place: "hamlet", name: "Olcot Falls Mobile Home Park" }, { name: "Olcot Falls Mobile Home Park" });
    expect(r.decision).toBe("reject");
  });

  it("rejects Mountain Home Park hamlet", () => {
    const r = classify({ place: "hamlet", name: "Mountain Home Park" }, { name: "Mountain Home Park" });
    expect(r.decision).toBe("reject");
  });

  it("rejects White River Junction hamlet", () => {
    const r = classify({ place: "hamlet", name: "White River Junction" }, { name: "White River Junction" });
    expect(r.decision).toBe("reject");
  });

  it("rejects Cedar Beach hamlet without beach tags", () => {
    const r = classify({ place: "hamlet", name: "Cedar Beach" }, { name: "Cedar Beach" });
    expect(r.decision).toBe("reject");
  });

  it("rejects Enosburg Falls village without waterfall tags", () => {
    const r = classify({ place: "village", name: "Enosburg Falls" }, { name: "Enosburg Falls" });
    expect(r.decision).toBe("reject");
  });

  it("rejects Enosburg Center hamlet without destination tags", () => {
    const r = classify({ place: "hamlet", name: "Enosburg Center" }, { name: "Enosburg Center" });
    expect(r.decision).toBe("reject");
    expect(r.rejectionReason).toBe("name_only_no_locava_signal");
  });

  it("rejects Starr Farm Beach hamlet without beach OSM tags", () => {
    const r = classify(
      {
        place: "hamlet",
        name: "Starr Farm Beach",
        ele: "36",
        "gnis:feature_id": "1459682",
      },
      { name: "Starr Farm Beach" }
    );
    expect(r.decision).toBe("reject");
    expect(r.activities).toEqual([]);
  });

  it("rejects Cadys Falls GNIS hamlet node (place=hamlet only)", () => {
    const r = classify(
      {
        place: "hamlet",
        name: "Cadys Falls",
        ele: "172",
        "gnis:feature_id": "1456716",
      },
      { name: "Cadys Falls" }
    );
    expect(r.decision).toBe("reject");
    expect(r.rejectionReason).toBe("name_only_no_locava_signal");
    expect(r.activities).toEqual([]);
  });

  it("rejects name-only Cadys Falls without tags", () => {
    const r = classify({ name: "Cadys Falls" }, { name: "Cadys Falls" });
    expect(r.decision).toBe("reject");
  });
});

describe("parity regression — good explicit-tag examples", () => {
  it("accepts Ithiel Falls with natural=waterfall", () => {
    const r = classify({ natural: "waterfall", name: "Ithiel Falls" }, { name: "Ithiel Falls" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("waterfall");
    expect(r.activities.length).toBeGreaterThan(0);
  });

  it("accepts Cadys Falls with waterway=waterfall and tag-only activities", () => {
    const r = classify({ waterway: "waterfall", name: "Cadys Falls" }, { name: "Cadys Falls" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("waterfall");
    expect(r.activities).toContain("waterfall");
    expect(r.activities.length).toBeGreaterThan(0);
  });

  it("accepts Crystal Beach with natural=beach", () => {
    const r = classify({ natural: "beach", name: "Crystal Beach" }, { name: "Crystal Beach" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("beach");
    expect(r.activities.some((a) => /beach|swim/i.test(a))).toBe(true);
  });

  it("accepts Cedar Beach with leisure=beach", () => {
    const r = classify({ leisure: "beach", name: "Cedar Beach" }, { name: "Cedar Beach" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("beach");
  });

  it("accepts Walnut Ledge with tourism=viewpoint", () => {
    const r = classify({ tourism: "viewpoint", name: "Walnut Ledge" }, { name: "Walnut Ledge" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("viewpoint");
  });

  it("rejects Alexander Hill as bare natural=peak without trail or viewpoint", () => {
    const r = classify({ natural: "peak", name: "Alexander Hill" }, { name: "Alexander Hill" });
    expect(r.decision).toBe("reject");
    expect(r.rejectionReason).toBe("bare_peak_no_trail_or_viewpoint");
  });

  it("accepts Alexander Hill when sac_scale marks an on-trail summit", () => {
    const r = classify(
      { natural: "peak", name: "Alexander Hill", sac_scale: "hiking" },
      { name: "Alexander Hill" }
    );
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("peak");
  });

  it("accepts Fairfax Falls Pond with natural=water and water=pond", () => {
    const r = classify({ natural: "water", water: "pond", name: "Fairfax Falls Pond" }, { name: "Fairfax Falls Pond" });
    expect(r.decision).toBe("spot");
    expect(r.primaryCategory).toBe("water");
  });

  it("accepts route=hiking relation as route", () => {
    const r = classify(
      { route: "hiking", name: "Mount Pisgah Long Pond Trail", type: "route" },
      {
        name: "Mount Pisgah Long Pond Trail",
        sourceType: "relation",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.55, lng: -72.38 },
          { lat: 43.56, lng: -72.37 },
        ],
      }
    );
    expect(r.decision).toBe("route");
    expect(r.activities).toEqual(expect.arrayContaining(["hiking"]));
  });
});
