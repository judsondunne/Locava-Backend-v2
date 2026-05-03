import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FIRESTORE_TEST_MODE ??= "disabled";
});

import { SearchAutofillService } from "./search-autofill.service.js";

describe("SearchAutofillService sentence suggestions", () => {
  it('preserves leading phrase for "best places to swim in ver"', async () => {
    const service = new SearchAutofillService();
    const res = await service.suggest({
      query: "best places to swim in ver",
      mode: "default",
      // Avoid collections lookup path for this test.
      viewerId: null,
      lat: null,
      lng: null,
    });
    const texts = res.suggestions.map((s) => String(s.text ?? "").trim());
    expect(texts).toContain("Best places to swim in Vermont");
  });

  it('ranks sentence parsing completion first for "best hiking in ve"', async () => {
    const service = new SearchAutofillService();
    const res = await service.suggest({
      query: "best hiking in ve",
      mode: "default",
      viewerId: null,
      lat: null,
      lng: null,
    });
    const first = String(res.suggestions[0]?.text ?? "").trim().toLowerCase();
    expect(first).toBe("best hiking in vermont");
  });
});

