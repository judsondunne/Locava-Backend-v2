import fs from "node:fs/promises";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetSearchPlacesIndexForTests, searchPlacesIndexService } from "./search-places-index.service.js";

describe("searchPlacesIndexService", () => {
  beforeEach(() => {
    resetSearchPlacesIndexForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "yields the event loop during large index builds so other work can progress",
    async () => {
      const rows = Array.from({ length: 8_000 }, (_, i) => ({
        countryCode: "US",
        admin1Code: "VT",
        name: `City${i}`,
        asciiName: `City${i}`,
        population: 5_000 + i,
        lat: 44.1,
        lng: -73.1,
      }));
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(rows));

      let spinCount = 0;
      const spinWhileLoading = async (): Promise<void> => {
        for (let i = 0; i < 50_000; i += 1) {
          const d = searchPlacesIndexService.getLoaderDiagnostics();
          if (d.loadError) throw new Error(d.loadError);
          if (d.loaded) return;
          if (d.loading) spinCount += 1;
          await new Promise<void>((r) => setImmediate(r));
        }
        throw new Error("search places load did not finish");
      };

      await Promise.all([searchPlacesIndexService.load(), spinWhileLoading()]);

      const diag = searchPlacesIndexService.getLoaderDiagnostics();
      expect(diag.loaded).toBe(true);
      expect(diag.places).toBeGreaterThan(500);
      expect(spinCount).toBeGreaterThan(2);
    },
    20_000
  );
});
