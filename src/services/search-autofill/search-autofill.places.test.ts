import { describe, expect, it, beforeAll } from "vitest";
import { searchPlacesIndexService } from "../surfaces/search-places-index.service.js";
import { SearchAutofillService } from "./search-autofill.service.js";

describe("SearchAutofillService place lanes", () => {
  const service = new SearchAutofillService();

  beforeAll(async () => {
    await searchPlacesIndexService.ensureLoading();
    expect(searchPlacesIndexService.isLoaded()).toBe(true);
  }, 120_000);

  function placeTexts(suggestions: Array<{ text?: string; type?: string }>): string[] {
    return suggestions
      .filter((s) => s.type === "town" || s.type === "state")
      .map((s) => String(s.text ?? "").toLowerCase());
  }

  it("returns Hiking for hik", async () => {
    const res = await service.suggest({ query: "hik", mode: "default" });
    const activities = res.suggestions.filter((s) => s.type === "activity").map((s) => s.text);
    expect(activities.some((t) => t?.toLowerCase() === "hiking")).toBe(true);
  });

  it("returns Skiing intent for ski before ski-prefixed town names", async () => {
    const res = await service.suggest({ query: "ski", mode: "default" });
    const firstSkiIntent = res.suggestions.findIndex(
      (s) =>
        (s.type === "activity" && String(s.text).toLowerCase() === "skiing") ||
        (s.type === "mix" && String(s.text).toLowerCase().includes("skiing")),
    );
    const firstTown = res.suggestions.findIndex((s) => s.type === "town");
    expect(firstSkiIntent).toBeGreaterThanOrEqual(0);
    expect(firstTown < 0 || firstSkiIntent < firstTown).toBe(true);
  });

  it("returns Hartland/Hartford-style places for hart, not only Hanover", async () => {
    const res = await service.suggest({ query: "hart", mode: "default" });
    const places = placeTexts(res.suggestions);
    expect(places.some((t) => t.includes("hartland") || t.includes("hartford"))).toBe(true);
    expect(places.every((t) => t.includes("hanover") && !t.includes("hartland") && !t.includes("hartford"))).toBe(
      false,
    );
    const sentences = res.suggestions.filter((s) => s.type === "sentence");
    expect(sentences.some((s) => /hiking in/i.test(String(s.text)))).toBe(false);
  });

  it("includes Hanover for han without hiking-in-Hanover sentences", async () => {
    const res = await service.suggest({ query: "han", mode: "default" });
    const places = placeTexts(res.suggestions);
    expect(places.some((t) => t.includes("hanover"))).toBe(true);
    const sentences = res.suggestions.filter((s) => s.type === "sentence");
    expect(sentences.some((s) => /hiking in/i.test(String(s.text)))).toBe(false);
  });

  it("returns empty or safe results for unlikely query (no Hanover fallback)", async () => {
    const res = await service.suggest({ query: "zzzzunlikely", mode: "default" });
    const places = placeTexts(res.suggestions);
    expect(places.some((t) => t.includes("hanover"))).toBe(false);
  });
});
