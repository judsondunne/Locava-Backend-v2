import { describe, expect, it } from "vitest";
import { matchesPlaceSearchKey } from "./search-places-index.service.js";

describe("matchesPlaceSearchKey", () => {
  it("matches prefix and rejects substring false positives", () => {
    expect(matchesPlaceSearchKey("hanover", "han")).toBe(true);
    expect(matchesPlaceSearchKey("hanover", "hart")).toBe(false);
    expect(matchesPlaceSearchKey("hartland", "hart")).toBe(true);
    expect(matchesPlaceSearchKey("hartford", "hart")).toBe(true);
    expect(matchesPlaceSearchKey("burlington", "bur")).toBe(true);
  });

  it("matches token prefixes after a space", () => {
    expect(matchesPlaceSearchKey("north hartland", "hart")).toBe(true);
  });
});
