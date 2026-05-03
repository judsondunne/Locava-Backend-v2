import { describe, expect, it } from "vitest";
import { formatLegendAnchorPreferState, formatPostAnchorLine, humanizeLegendPlace } from "./legend-place-humanize.js";

describe("humanizeLegendPlace", () => {
  it("maps state abbreviations", () => {
    expect(humanizeLegendPlace("state", "NH")).toBe("New Hampshire");
    expect(humanizeLegendPlace("state", "VT")).toBe("Vermont");
  });

  it("maps underscore state ids", () => {
    expect(humanizeLegendPlace("state", "NEW_HAMPSHIRE")).toBe("New Hampshire");
    expect(humanizeLegendPlace("state", "VERMONT")).toBe("Vermont");
  });

  it("formats XX_city composites", () => {
    expect(humanizeLegendPlace("city", "VT_burlington")).toBe("Burlington, Vermont");
    expect(humanizeLegendPlace("city", "NEW_HAMPSHIRE_concord")).toBe("Concord, New Hampshire");
  });

  it("handles town_of place ids", () => {
    expect(humanizeLegendPlace("city", "VERMONT_town_of_corinth")).toBe("Corinth, Vermont");
  });

  it("friendly fallbacks without place id", () => {
    expect(humanizeLegendPlace("city", null)).toBe("Your town");
    expect(humanizeLegendPlace("state", "")).toBe("Your state");
    expect(humanizeLegendPlace(null, "")).toBe("Your area");
  });

  it("formats post city/state anchor for hyperlocal copy", () => {
    expect(formatPostAnchorLine({ city: "Burlington", state: "VT" })).toBe("Burlington, Vermont");
    expect(formatPostAnchorLine({ city: "Concord", state: "New Hampshire" })).toBe("Concord, New Hampshire");
    expect(formatPostAnchorLine({ city: "", state: "" })).toBe(null);
  });

  it("prefers state-only anchor for legend geo line when state exists", () => {
    expect(formatLegendAnchorPreferState({ city: "City of Easton", state: "Pennsylvania" })).toBe("Pennsylvania");
    expect(formatLegendAnchorPreferState({ city: "Easton", state: "PA" })).toBe("Pennsylvania");
    expect(formatLegendAnchorPreferState({ city: "Burlington", state: "" })).toBe("Burlington");
  });
});
