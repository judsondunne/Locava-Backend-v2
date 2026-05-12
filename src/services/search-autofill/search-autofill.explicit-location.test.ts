import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FIRESTORE_TEST_MODE ??= "disabled";
});

import { getSuggestionsFromLibrary } from "./autofill-library.js";
import { SearchAutofillService } from "./search-autofill.service.js";

describe("autofill explicit location guard", () => {
  it("library skips viewer near-me and viewer-city templates when explicitLocationText is set", async () => {
    const rows = await getSuggestionsFromLibrary({
      query: "best food in boston",
      placeContext: {
        cityName: "Easton",
        stateName: "Pennsylvania",
        cityRegionId: "us:pa:easton",
        stateRegionId: "us:pa",
      },
      explicitLocationText: "boston",
    });
    const texts = rows.map((r) => r.text.toLowerCase());
    expect(texts.some((t) => t.includes("near me"))).toBe(false);
    expect(texts.some((t) => t.includes("easton"))).toBe(false);
    expect(texts.some((t) => t.includes("boston"))).toBe(true);
  });

  it("does not duplicate viewer town when query already ends with same explicit town", async () => {
    const rows = await getSuggestionsFromLibrary({
      query: "best food in easton",
      placeContext: {
        cityName: "Easton",
        stateName: "Pennsylvania",
        cityRegionId: "us:pa:easton",
        stateRegionId: "us:pa",
      },
      explicitLocationText: "easton",
    });
    const texts = rows.map((r) => r.text.toLowerCase());
    expect(texts.some((t) => t.includes("near me"))).toBe(false);
    expect(texts.filter((t) => t.includes("easton")).length).toBeGreaterThan(0);
  });

  it("end-to-end suggest: best food in boston avoids near me / viewer easton rows", async () => {
    const service = new SearchAutofillService();
    const res = await service.suggest({
      query: "best food in boston",
      lat: 40.6884,
      lng: -75.2207,
      mode: "default",
      viewerId: null,
    });
    const texts = res.suggestions.map((s) => String(s.text ?? "").toLowerCase());
    expect(texts.some((t) => t.includes("near me"))).toBe(false);
    expect(texts.some((t) => t.includes("easton"))).toBe(false);
  });

  it("regression: coffee prefix still yields near-me templates without explicit location", async () => {
    const rows = await getSuggestionsFromLibrary({
      // Prefix aligns with food_drink near-me rows via applyPrefix (see autofill-library).
      query: "coffee",
      placeContext: {
        cityName: "Easton",
        stateName: "Pennsylvania",
        cityRegionId: "us:pa:easton",
        stateRegionId: "us:pa",
      },
      explicitLocationText: null,
    });
    const texts = rows.map((r) => r.text.toLowerCase());
    expect(texts.some((t) => t.includes("near me"))).toBe(true);
  });
});
