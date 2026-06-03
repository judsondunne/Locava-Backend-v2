import { describe, expect, it } from "vitest";
import {
  evaluateNameInference,
  getDisqualifyingNameInferenceTags,
  getSupportingDestinationTags,
  inferSafeBeachCategoryFromName,
  isGeographicBeachName,
} from "./inventoryNameInference.js";

describe("inventoryNameInference", () => {
  it("blocks mobile home park with falls in name", () => {
    const eval_ = evaluateNameInference({ place: "hamlet", name: "Olcot Falls Mobile Home Park" }, "Olcot Falls Mobile Home Park");
    expect(eval_.nameInferenceUsed).toBe(false);
    expect(eval_.disqualifyingTags.some((t) => t.includes("mobile_home_park") || t.includes("place="))).toBe(true);
  });

  it("blocks Cedar Beach hamlet without beach tags", () => {
    const eval_ = evaluateNameInference({ place: "hamlet", name: "Cedar Beach" }, "Cedar Beach");
    expect(eval_.nameInferenceUsed).toBe(false);
    expect(eval_.nameInferenceBlockedReason).toBeTruthy();
    expect(isGeographicBeachName("Cedar Beach", { place: "hamlet", name: "Cedar Beach" })).toBe(false);
  });

  it("allows name hint when natural=beach tag exists", () => {
    const tags = { natural: "beach", name: "Crystal Beach" };
    expect(getSupportingDestinationTags(tags)).toContain("beach");
    const eval_ = evaluateNameInference(tags, "Crystal Beach");
    expect(eval_.nameInferenceUsed).toBe(true);
    expect(eval_.inferredCategory).toBe("beach");
  });

  it("allows waterfall when waterway=waterfall tag exists", () => {
    const tags = { waterway: "waterfall", name: "Cadys Falls" };
    const eval_ = evaluateNameInference(tags, "Cadys Falls");
    expect(eval_.nameInferenceUsed).toBe(true);
    expect(eval_.inferredCategory).toBe("waterfall");
  });

  it("blocks White River Junction without water tags", () => {
    const tags = { place: "hamlet", name: "White River Junction" };
    expect(getDisqualifyingNameInferenceTags(tags, "White River Junction").length).toBeGreaterThan(0);
    expect(evaluateNameInference(tags, "White River Junction").nameInferenceUsed).toBe(false);
  });

  it("allows Starr Farm Beach geographic name on hamlet node", () => {
    expect(isGeographicBeachName("Starr Farm Beach", { place: "hamlet", name: "Starr Farm Beach" })).toBe(true);
    expect(inferSafeBeachCategoryFromName({ place: "hamlet", name: "Starr Farm Beach" }, "Starr Farm Beach")).toBe("beach");
  });
});
