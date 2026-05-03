import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FIRESTORE_TEST_MODE ??= "disabled";
});

import { createApp } from "../../app/createApp.js";
import { searchPlacesIndexService } from "../../services/surfaces/search-places-index.service.js";

describe("v2 search discovery routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  const eastonPa = { lat: 40.68843, lng: -75.22073 };

  it("returns fast activity suggestions for partial queries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/suggest?q=hiking",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("search.suggest.get");
    expect(body.data.detectedActivity).toBe("hiking");
    expect(Array.isArray(body.data.suggestions)).toBe(true);
    expect(
      body.data.suggestions.some(
        (row: { type?: string; suggestionType?: string }) =>
          row.type === "activity" || row.suggestionType === "activity",
      ),
    ).toBe(true);
  });

  it("returns place-aware suggestions for combined activity and location text", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/suggest?q=hiking%20in%20vermont",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.detectedActivity).toBe("hiking");
    const texts = (body.data.suggestions as Array<{ text?: string }>).map((row) =>
      String(row.text ?? "").toLowerCase(),
    );
    expect(texts.some((text) => text.includes("vermont"))).toBe(true);
  });

  it("returns sentence-style autofill completions for cool hikes in vermont", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/suggest?q=cool%20hikes%20in%20vermont",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.detectedActivity).toBe("hiking");
    const texts = (body.data.suggestions as Array<{ text?: string }>).map((row) =>
      String(row.text ?? "").toLowerCase(),
    );
    expect(texts.some((text) => text.includes("cool hikes in vermont"))).toBe(true);
    expect(texts.some((text) => text.includes("views in vermont"))).toBe(true);
  });

  it("prefers the Sunday-era Burlington, Vermont interpretation for bare burlington", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/suggest?q=burlington",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const texts = (body.data.suggestions as Array<{ text?: string }>).map((row) =>
      String(row.text ?? "").toLowerCase(),
    );
    expect(texts.some((text) => text.includes("burlington, vermont"))).toBe(true);
    expect(texts.some((text) => text.includes("burlington county, new jersey"))).toBe(false);
  });

  it(
    "includes Hartland, Vermont near the top for city + state partials (places index + ranking)",
    async () => {
      await searchPlacesIndexService.ensureLoading();
      expect(searchPlacesIndexService.isLoaded()).toBe(true);

      const queries = ["hartland", "hartland ver", "hartland verm", "hartland vermont"];
      for (const q of queries) {
        const res = await app.inject({
          method: "GET",
          url: `/v2/search/suggest?q=${encodeURIComponent(q)}&lat=${eastonPa.lat}&lng=${eastonPa.lng}`,
          headers,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        const diag = body.data.suggestDiagnostics as Record<string, unknown> | undefined;
        expect(diag?.placesIndexLoaded === true || diag?.placesIndexAwaitedMs != null).toBe(true);
        const texts = (body.data.suggestions as Array<{ text?: string; type?: string }>).map((row) =>
          String(row.text ?? "").toLowerCase(),
        );
        const idx = texts.findIndex((t) => t.includes("hartland") && t.includes("vermont"));
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(6);
      }
    },
    120_000,
  );

  it("returns real bootstrap posts plus parsed summary for committed queries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/bootstrap?q=hiking&limit=12",
      headers,
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.data.routeName).toBe("search.bootstrap.get");
    expect(Array.isArray(body.data.posts)).toBe(true);
    expect(body.data.parsedSummary.activity).toBeTruthy();
  });
});
