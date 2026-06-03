import { describe, expect, it } from "vitest";
import {
  evaluateOsmVisitability,
  visitabilityBlocksSpotAcceptance,
} from "./inventoryVisitability.js";

describe("inventoryVisitability", () => {
  it("accepts protected area with trail/access signals", () => {
    const eval_ = evaluateOsmVisitability({
      boundary: "protected_area",
      leisure: "nature_reserve",
      name: "Otter Creek Wildlife Management Area",
      foot: "yes",
      hiking: "yes",
    });
    expect(eval_.hasAccessOrRecreationSignal).toBe(true);
    expect(visitabilityBlocksSpotAcceptance({ boundary: "protected_area", foot: "yes" }, eval_).reject).toBe(false);
  });

  it("blocks generic protected area admin polygon", () => {
    const tags = {
      boundary: "protected_area",
      leisure: "park",
      name: "Dead Creek Wildlife Management Area",
      "gnis:feature_id": "1918079",
    };
    const eval_ = evaluateOsmVisitability(tags, { name: tags.name, geometryKind: "polygon" });
    expect(visitabilityBlocksSpotAcceptance(tags, eval_).reject).toBe(true);
    expect(visitabilityBlocksSpotAcceptance(tags, eval_).reason).toBe("large_natural_area_no_visitor_signal");
  });

  it("allows restaurant without nature visitability", () => {
    const eval_ = evaluateOsmVisitability({ amenity: "restaurant", name: "Local Bistro" });
    expect(visitabilityBlocksSpotAcceptance({ amenity: "restaurant" }, eval_).reject).toBe(false);
  });

  it("allows waterfall destination", () => {
    const eval_ = evaluateOsmVisitability({ natural: "waterfall", name: "Moss Glen Falls" });
    expect(eval_.hasStrongDestinationSignal).toBe(true);
    expect(visitabilityBlocksSpotAcceptance({ natural: "waterfall" }, eval_).reject).toBe(false);
  });

  it("blocks named wetland without access", () => {
    const tags = { natural: "wetland", name: "Cedar Swamp" };
    const eval_ = evaluateOsmVisitability(tags, { name: tags.name });
    expect(visitabilityBlocksSpotAcceptance(tags, eval_).reject).toBe(true);
  });

  it("allows trail route line geometry", () => {
    const eval_ = evaluateOsmVisitability(
      { highway: "path", name: "Forest Trail", sac_scale: "hiking" },
      { name: "Forest Trail", geometryKind: "line" }
    );
    expect(eval_.objectKind).toBe("trail_route");
    expect(eval_.visitabilityTier).not.toBe("none");
  });
});
