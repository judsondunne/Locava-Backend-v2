import { describe, expect, it } from "vitest";
import { parseSearchQueryIntent } from "./search-query-intent.js";

describe("search query intent — hiking + near me phrasing", () => {
  const cases = [
    "best hikes near me",
    "hiking near me",
    "hikes near me",
    "places to hike near me",
    "cool hiking spots near me",
  ];

  for (const rawQuery of cases) {
    it(`parses activity + nearMe for: ${rawQuery}`, () => {
      const intent = parseSearchQueryIntent(rawQuery);
      expect(intent.nearMe).toBe(true);
      expect(intent.activity?.canonical).toBe("hiking");
    });
  }
});
