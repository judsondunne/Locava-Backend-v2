import { describe, expect, it } from "vitest";
import { resolveLocationIntent, normalizeSearchText, buildCityRegionId, buildStateRegionId } from "./search-query-intent.js";

describe("resolveLocationIntent state-prefix preference", () => {
  it("prefers state name over town when query is a state prefix", () => {
    const burlington = {
      text: "Burlington",
      cityRegionId: buildCityRegionId("US", "Vermont", "Burlington"),
      stateRegionId: buildStateRegionId("US", "Vermont"),
      searchKey: normalizeSearchText("burlington"),
      population: 0,
      countryCode: "US",
      stateName: "Vermont",
      lat: null,
      lng: null,
    };
    const intent = resolveLocationIntent("hiking in ver", () => burlington);
    expect(intent?.stateName).toBe("Vermont");
    expect(intent?.displayText).toBe("Vermont");
    expect(intent?.cityRegionId).toBeNull();
  });
});

