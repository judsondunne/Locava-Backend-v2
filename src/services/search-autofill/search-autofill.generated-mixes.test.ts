import { describe, expect, it } from "vitest";
import { SearchAutofillService } from "./search-autofill.service.js";

describe("SearchAutofillService generated mixes", () => {
  it("adds a generated mix suggestion for 'best hiking in vermont'", async () => {
    const service = new SearchAutofillService({
      discovery: {
        parseIntent: (q: string) => ({
          activity: { canonical: "hiking", relatedActivities: ["walking", "view"] },
          location: { displayText: "Vermont", normalized: "vermont" },
        }),
        searchUsersForQuery: async () => [],
        loadLocationSuggestions: async () => [],
      } as any,
    });
    const res = await service.suggest({
      query: "best hiking in vermont",
      lat: 44.4759,
      lng: -73.2121,
      mode: "default",
    });
    expect(res.routeName).toBe("search.suggest.get");
    expect(Array.isArray(res.suggestions)).toBe(true);
    const mixRows = res.suggestions.filter((s) => (s as any).type === "mix");
    expect(mixRows.length).toBeGreaterThanOrEqual(2);
    for (const row of mixRows) {
      const mixSpecV1 = (row as any).data?.mixSpecV1;
      expect(mixSpecV1).toBeTruthy();
      expect(String(mixSpecV1.seeds?.primaryActivityId ?? "")).toBe("hiking");
      expect(String(mixSpecV1.v2MixId ?? "")).toMatch(/^(activity:|location_activity:|location_activity_state:|location_activity_city:)/);
    }
  });
});

