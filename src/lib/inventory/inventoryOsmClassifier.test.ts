import { describe, expect, it } from "vitest";
import { classifyInventoryOsmObject } from "./inventoryOsmClassifier.js";

describe("inventoryOsmClassifier", () => {
  it("classifies waterfall node as spot", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { natural: "waterfall", name: "Mill Falls" },
        geometryKind: "point",
        hasName: true,
      }).kind
    ).toBe("spot");
  });

  it("classifies viewpoint node as spot", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { tourism: "viewpoint" },
        geometryKind: "point",
        hasName: true,
      }).kind
    ).toBe("spot");
  });

  it("classifies wetland polygon as spot", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { natural: "wetland" },
        geometryKind: "polygon",
        closed: true,
        hasName: true,
      }).kind
    ).toBe("spot");
  });

  it("classifies park polygon as spot", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { leisure: "park", name: "Community Park" },
        geometryKind: "polygon",
        closed: true,
        hasName: true,
      }).kind
    ).toBe("spot");
  });

  it("classifies hiking path line as route", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { highway: "path", foot: "designated", name: "Forest Path" },
        geometryKind: "line",
        hasName: true,
      }).kind
    ).toBe("route");
  });

  it("classifies hiking relation as route", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { type: "route", route: "hiking", name: "Valley Trail" },
        geometryKind: "relation",
        hasName: true,
      }).kind
    ).toBe("route");
  });

  it("rejects residential road without trail context", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { highway: "residential" },
        geometryKind: "line",
        hasName: false,
      })
    ).toEqual({ kind: "reject", reason: "highway_residential", routeCategoryHint: undefined, spotCategoryHint: undefined });
  });

  it("rejects building polygon", () => {
    expect(
      classifyInventoryOsmObject({
        tags: { building: "yes" },
        geometryKind: "polygon",
        closed: true,
        hasName: true,
      }).kind
    ).toBe("reject");
  });
});
