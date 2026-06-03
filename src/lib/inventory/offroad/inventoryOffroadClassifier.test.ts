import { describe, expect, it } from "vitest";
import { classifyOffroadCandidate, scoreOffroadTags } from "./inventoryOffroadClassifier.js";
import type { OsmFeatureListItem } from "../../openstreetmap/osmFeatureParse.js";

function lineFeature(tags: Record<string, string>, name?: string): OsmFeatureListItem {
  return {
    id: "way/1",
    osmType: "way",
    osmId: 1,
    name: name ?? tags.name ?? "Test Road",
    hasRealName: Boolean(name ?? tags.name),
    featureType: `highway=${tags.highway ?? "track"}`,
    lat: 43.54,
    lng: -72.39,
    coordSource: "line_center",
    geometryKind: "line",
    coordinates: [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.541, lng: -72.388 },
    ],
    closed: false,
    tags,
  };
}

describe("inventoryOffroadClassifier", () => {
  it("atv=yes becomes offroading route", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", atv: "yes" }));
    expect(r?.decision).toBe("accept");
    expect(r?.activity).toBe("offroading");
  });

  it("atv=designated is explicit", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", atv: "designated" }));
    expect(r?.offroadConfidence).toBe("explicit");
  });

  it("ohv=yes becomes offroading", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", ohv: "yes" }));
    expect(r?.activity).toBe("offroading");
  });

  it("ohrv=yes becomes offroading", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", ohrv: "yes" }));
    expect(r?.activity).toBe("offroading");
  });

  it("4wd_only=yes becomes offroading", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", "4wd_only": "yes", surface: "dirt" }));
    expect(r?.decision).toBe("accept");
    expect(r?.vehicleSignals.fourWdOnly).toBe(true);
  });

  it("highway=track + tracktype=grade4 + surface=dirt", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", tracktype: "grade4", surface: "dirt", access: "public" }));
    expect(r?.decision).toBe("accept");
  });

  it("access=private rejected", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", atv: "yes", access: "private" }));
    expect(r?.decision).toBe("reject");
  });

  it("motor_vehicle=no rejected unless atv explicit", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", motor_vehicle: "no", surface: "dirt" }));
    expect(r?.decision).toBe("reject");
    const ok = classifyOffroadCandidate(lineFeature({ highway: "track", motor_vehicle: "no", atv: "yes" }));
    expect(ok?.decision).toBe("accept");
  });

  it("highway=path not offroading unless explicit motor", () => {
    expect(classifyOffroadCandidate(lineFeature({ highway: "path", surface: "dirt" }))).toBeNull();
    expect(classifyOffroadCandidate(lineFeature({ highway: "path", atv: "yes" }))?.activity).toBe("offroading");
  });

  it("highway=residential not offroading unless class signal", () => {
    expect(classifyOffroadCandidate(lineFeature({ highway: "residential" }))).toBeNull();
    expect(classifyOffroadCandidate(lineFeature({ highway: "residential", class: "4" }, "Class 4 Road"))?.decision).toBe("accept");
  });

  it("Class 4 Road name signal", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", surface: "gravel", access: "public" }, "Class 4 Road"));
    expect(r?.roadClassSignals.vtClass4).toBe(true);
  });

  it("Class IV Road name signal", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", surface: "dirt", access: "yes" }, "Class IV Road"));
    expect(r?.roadClassSignals.vtClass4).toBe(true);
  });

  it("Class VI Road name signal", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", surface: "dirt", access: "yes" }, "Class VI Road"));
    expect(r?.roadClassSignals.nhClass6).toBe(true);
  });

  it("legal_trail=yes category legal_trail", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", legal_trail: "yes", surface: "dirt", access: "public" }));
    expect(r?.offroadCategory).toBe("legal_trail");
  });

  it("service=driveway rejected via score", () => {
    const { score } = scoreOffroadTags({ highway: "service", service: "driveway", surface: "dirt" });
    expect(score).toBeLessThan(45);
  });

  it("legalDisplayLabel Unmaintained road", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", atv: "yes" }));
    expect(r?.legalDisplayLabel).toBe("Unmaintained road");
  });

  it("accessWarnings present", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", atv: "yes" }));
    expect(r?.accessWarnings.length).toBeGreaterThan(0);
  });

  it("rejects generic named forest roads without class or vehicle signals", () => {
    expect(classifyOffroadCandidate(lineFeature({ highway: "track", snowmobile: "designated" }, "South Road"))).toBeNull();
    expect(classifyOffroadCandidate(lineFeature({ highway: "track", access: "public" }, "Webber Road"))).toBeNull();
    expect(classifyOffroadCandidate(lineFeature({ highway: "track", access: "public" }, "Town Highway 45"))).toBeNull();
  });

  it("keeps explicit class 4 named roads", () => {
    const r = classifyOffroadCandidate(lineFeature({ highway: "track", surface: "gravel", access: "public" }, "Class 4 Road"));
    expect(r?.decision).toBe("accept");
    expect(r?.roadClassSignals.vtClass4).toBe(true);
  });
});
