import fs from "node:fs/promises";
import path from "node:path";
import {
  US_STATE_CODE_TO_NAME,
  buildCityRegionId,
  buildStateRegionId,
  normalizeSearchText,
  resolveStateNameFromAny,
} from "../../lib/search-query-intent.js";

function distanceMilesApprox(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy) * 69;
}

type PlaceRow = {
  name?: string;
  asciiName?: string;
  alternateNames?: string[];
  countryCode?: string;
  admin1Code?: string;
  population?: number;
  lat?: number;
  lng?: number;
};

export type SearchIndexedPlace = {
  text: string;
  cityRegionId: string;
  stateRegionId: string;
  searchKey: string;
  population: number;
  countryCode: string;
  stateName: string;
  lat: number | null;
  lng: number | null;
};

type SeedPlaceDefinition = {
  text: string;
  stateName: string;
  population: number;
  lat: number | null;
  lng: number | null;
  aliases?: string[];
};

const SEED_PLACE_DEFINITIONS: SeedPlaceDefinition[] = [
  {
    text: "Burlington",
    stateName: "Vermont",
    population: 44743,
    lat: 44.4759,
    lng: -73.2121,
    aliases: ["burlington vt", "burlington vermont", "uvm"],
  },
  {
    text: "Hanover",
    stateName: "New Hampshire",
    population: 11589,
    lat: 43.7022,
    lng: -72.2896,
    aliases: ["upper valley", "hanover nh", "hanover new hampshire"],
  },
  {
    text: "Boulder",
    stateName: "Colorado",
    population: 108250,
    lat: 40.01499,
    lng: -105.27055,
    aliases: ["boulder co", "boulder colorado"],
  },
  {
    text: "Easton",
    stateName: "Pennsylvania",
    population: 28392,
    lat: 40.68843,
    lng: -75.22073,
    aliases: ["easton pa", "easton pennsylvania"],
  },
  {
    text: "Philadelphia",
    stateName: "Pennsylvania",
    population: 1567442,
    lat: 39.95258,
    lng: -75.16522,
    aliases: ["philly", "philadelphia pa", "phil"],
  },
  {
    text: "Seattle",
    stateName: "Washington",
    population: 755078,
    lat: 47.60621,
    lng: -122.33207,
    aliases: ["seattle wa", "seattle washington"],
  },
  {
    text: "San Francisco",
    stateName: "California",
    population: 808437,
    lat: 37.77493,
    lng: -122.41942,
    aliases: ["bay area", "san francisco ca", "sf", "san francisco california"],
  },
  {
    text: "Austin",
    stateName: "Texas",
    population: 979882,
    lat: 30.26715,
    lng: -97.74306,
    aliases: ["austin tx", "austin texas"],
  },
  {
    text: "Phoenix",
    stateName: "Arizona",
    population: 1660272,
    lat: 33.44838,
    lng: -112.07404,
    aliases: ["phoenix az", "phoenix arizona"],
  },
  {
    text: "New York",
    stateName: "New York",
    population: 8804190,
    lat: 40.71278,
    lng: -74.00594,
    aliases: ["nyc", "new york city", "new york ny"],
  },
];

class SearchPlacesIndexService {
  private loaded = false;
  private loading = false;
  private loadScheduled = false;
  /** Singleflight: all callers share one load; concurrent suggest requests await the same promise. */
  private loadPromise: Promise<void> | null = null;
  private lastLoadTotalMs = 0;
  private lastIndexedWorkMs = 0;
  private prefixMap = new Map<string, SearchIndexedPlace[]>();
  private exactMap = new Map<string, SearchIndexedPlace>();
  private readonly seedEntries: Array<{ searchKey: string; place: SearchIndexedPlace }> = [];
  private readonly seedExactMap = new Map<string, SearchIndexedPlace>();
  private readonly seedPlaces: SearchIndexedPlace[] = [];
  private readonly allPlaces: SearchIndexedPlace[] = [];
  private loadError: string | null = null;

  constructor() {
    this.initializeSeeds();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getLoadError(): string | null {
    return this.loadError;
  }

  getLoaderDiagnostics(): {
    loaded: boolean;
    loading: boolean;
    loadInFlight: boolean;
    places: number;
    prefixes: number;
    lastLoadTotalMs: number;
    lastIndexedWorkMs: number;
    loadError: string | null;
  } {
    return {
      loaded: this.loaded,
      loading: this.loading,
      loadInFlight: this.loading || this.loadPromise != null,
      places: this.exactMap.size,
      prefixes: this.prefixMap.size,
      lastLoadTotalMs: this.lastLoadTotalMs,
      lastIndexedWorkMs: this.lastIndexedWorkMs,
      loadError: this.loadError,
    };
  }

  /**
   * Start loading (or join in-flight load). Safe to call repeatedly.
   */
  ensureLoading(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loadPromise) {
      this.loadPromise = this.executeLoad().finally(() => {
        this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  /**
   * Interactive suggest: wait up to `timeoutMs` for index readiness so place rows are not served
   * from seeds-only while GeoNames is still loading.
   */
  async awaitLoadedForInteractiveSuggest(timeoutMs: number): Promise<{ awaitedMs: number; loaded: boolean }> {
    const started = Date.now();
    if (this.loaded) return { awaitedMs: 0, loaded: true };
    const load = this.ensureLoading();
    if (timeoutMs <= 0) {
      return { awaitedMs: Date.now() - started, loaded: this.loaded };
    }
    await Promise.race([
      load,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
    return { awaitedMs: Date.now() - started, loaded: this.loaded };
  }

  /** @deprecated Prefer ensureLoading — kept for callers that relied on delayed kick; delay default is now 0. */
  scheduleLoad(delayMs = 0): void {
    if (this.loaded || this.loading || this.loadScheduled) return;
    this.loadScheduled = true;
    const timer = setTimeout(() => {
      this.loadScheduled = false;
      void this.ensureLoading();
    }, Math.max(0, delayMs));
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  /**
   * Defer full index load until after backend grace + idle tick so app-open routes never share the
   * process with a multi-hundred-ms JSON/index build.
   */
  scheduleDeferredIdleLoad(totalDelayMs: number): void {
    if (this.loaded || this.loading || this.loadScheduled) return;
    this.loadScheduled = true;
    const timer = setTimeout(() => {
      this.loadScheduled = false;
      void new Promise<void>((r) => setImmediate(r)).then(() => this.ensureLoading());
    }, Math.max(0, totalDelayMs));
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  async load(): Promise<void> {
    return this.ensureLoading();
  }

  private async executeLoad(): Promise<void> {
    if (this.loaded) return;
    this.loading = true;
    this.loadScheduled = false;
    this.loadError = null;
    const loopStart = Date.now();
    let blockedEventLoopMs = 0;
    try {
      const localDataPath = path.resolve(process.cwd(), "src", "data", "geonames-places.json");
      const legacyDataPath = path.resolve(process.cwd(), "..", "Locava Backend", "src", "data", "geonames-places.json");
      let dataPath = localDataPath;
      try {
        await fs.access(localDataPath);
      } catch {
        dataPath = legacyDataPath;
      }
      const raw = await fs.readFile(dataPath, "utf8");
      const rows = JSON.parse(raw) as PlaceRow[];
      const chunk = 2000;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const sliceStart = Date.now();
        for (const row of slice) {
          const countryCode = String(row.countryCode ?? "").trim().toUpperCase();
          const admin1Code = String(row.admin1Code ?? "").trim().toUpperCase();
          const stateName = US_STATE_CODE_TO_NAME[admin1Code];
          const name = String(row.name ?? row.asciiName ?? "").trim();
          if (!countryCode || !admin1Code || !stateName || !name) continue;
          const population = Number(row.population ?? 0);
          if (!Number.isFinite(population) || population <= 0) continue;
          const place: SearchIndexedPlace = {
            text: name,
            cityRegionId: buildCityRegionId(countryCode, stateName, name),
            stateRegionId: buildStateRegionId(countryCode, stateName),
            searchKey: normalizeSearchText(name),
            population,
            countryCode,
            stateName,
            lat: Number.isFinite(Number(row.lat)) ? Number(row.lat) : null,
            lng: Number.isFinite(Number(row.lng)) ? Number(row.lng) : null,
          };
          this.allPlaces.push(place);
          this.addCandidate(place);
          for (const alt of row.alternateNames ?? []) {
            const alias = String(alt ?? "").trim();
            if (!alias) continue;
            this.addCandidate({ ...place, searchKey: normalizeSearchText(alias) });
          }
        }
        blockedEventLoopMs += Date.now() - sliceStart;
        if (i + chunk < rows.length) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      let prefixIdx = 0;
      for (const [key, bucket] of this.prefixMap.entries()) {
        bucket.sort((a, b) => b.population - a.population || a.text.localeCompare(b.text));
        this.prefixMap.set(key, bucket);
        prefixIdx += 1;
        if (prefixIdx % 500 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      this.loaded = true;
      const totalMs = Date.now() - loopStart;
      this.lastLoadTotalMs = totalMs;
      this.lastIndexedWorkMs = blockedEventLoopMs;
      if (process.env.NODE_ENV === "production") {
        console.log(
          `[SEARCH_PLACES_INDEX] loaded=true places=${this.exactMap.size} prefixes=${this.prefixMap.size} totalMs=${totalMs} indexedWorkMs=${blockedEventLoopMs}`
        );
      } else {
        console.log(
          `[SEARCH_PLACES_INDEX] loaded=true places=${this.exactMap.size} prefixes=${this.prefixMap.size} source=${dataPath} totalMs=${totalMs} indexedWorkMs=${blockedEventLoopMs}`
        );
      }
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error);
      console.warn(`[SEARCH_PLACES_INDEX] load_failed error=${this.loadError}`);
    } finally {
      this.loading = false;
    }
  }

  search(
    query: string,
    limit = 6,
    opts?: { viewerLat?: number | null; viewerLng?: number | null },
  ): SearchIndexedPlace[] {
    const q = normalizeSearchText(query);
    if (q.length < 2) return [];
    const seedMatches = this.searchSeeds(q, limit);
    if (!this.loaded) {
      const shouldSchedule = process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";
      if (shouldSchedule) void this.ensureLoading();
      return seedMatches;
    }

    const viewer =
      typeof opts?.viewerLat === "number" &&
      Number.isFinite(opts.viewerLat) &&
      typeof opts?.viewerLng === "number" &&
      Number.isFinite(opts.viewerLng)
        ? { lat: opts.viewerLat, lng: opts.viewerLng }
        : null;

    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const lastTok = tokens[tokens.length - 1] ?? "";
      const stateName = resolveStateNameFromAny(lastTok);
      if (stateName) {
        const cityPart = tokens.slice(0, -1).join(" ");
        const cityNorm = normalizeSearchText(cityPart);
        if (cityNorm.length >= 1) {
          const prefix = cityNorm.slice(0, 3);
          const bucket = this.prefixMap.get(prefix) ?? [];
          const stateNorm = normalizeSearchText(stateName);
          const matches = bucket.filter((row) => {
            if (normalizeSearchText(row.stateName) !== stateNorm) return false;
            return (
              row.searchKey.startsWith(cityNorm) ||
              cityNorm.startsWith(row.searchKey) ||
              row.searchKey.includes(cityNorm) ||
              cityNorm.includes(row.searchKey)
            );
          });
          const ranked = this.rankPlaceCandidates(matches, q, cityNorm, viewer);
          return this.mergePlaces(seedMatches, ranked, limit);
        }
      }
    }

    const bucket = this.prefixMap.get(q.slice(0, 3)) ?? [];
    const fullMatches = bucket.filter((row) => row.searchKey.includes(q));
    const rankedSingle = this.rankPlaceCandidates(fullMatches, q, q, viewer);
    return this.mergePlaces(seedMatches, rankedSingle, limit);
  }

  private rankPlaceCandidates(
    rows: SearchIndexedPlace[],
    _fullQuery: string,
    cityOrPrimaryToken: string,
    viewer: { lat: number; lng: number } | null,
  ): SearchIndexedPlace[] {
    const primary = cityOrPrimaryToken;
    const scored = rows.map((row) => {
      let match = 0;
      if (row.searchKey === primary) match = 1000;
      else if (row.searchKey.startsWith(primary)) match = 700;
      else if (primary.startsWith(row.searchKey)) match = 600;
      else if (row.searchKey.includes(primary)) match = 400;
      else match = 200;
      let distBias = 0;
      if (viewer && row.lat != null && row.lng != null) {
        const d = distanceMilesApprox(viewer, { lat: row.lat, lng: row.lng });
        distBias = Math.max(0, 40 - Math.min(d, 400)) * 0.08;
      }
      const pop = Math.log10(row.population + 1) * 12;
      return { row, score: match + pop + distBias };
    });
    scored.sort((a, b) => b.score - a.score || a.row.text.localeCompare(b.row.text));
    return scored.map((s) => s.row).slice(0, Math.max(1, Math.min(48, rows.length)));
  }

  searchExact(query: string): SearchIndexedPlace | null {
    const normalized = normalizeSearchText(query);
    if (normalized.length < 2) return null;
    if (!this.loaded) {
      const shouldSchedule = process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";
      if (shouldSchedule) void this.ensureLoading();
      return this.seedExactMap.get(normalized) ?? null;
    }
    return this.seedExactMap.get(normalized) ?? this.exactMap.get(normalized) ?? null;
  }

  reverseLookup(lat: number, lng: number): SearchIndexedPlace | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const candidates = this.loaded ? this.allPlaces : this.seedPlaces;
    let best: { place: SearchIndexedPlace; distanceSq: number } | null = null;
    for (const place of candidates) {
      if (place.lat == null || place.lng == null) continue;
      const dLat = lat - place.lat;
      const dLng = lng - place.lng;
      const distanceSq = dLat * dLat + dLng * dLng;
      if (!best || distanceSq < best.distanceSq) {
        best = { place, distanceSq };
      }
    }
    if (!best) return null;
    const distanceMiles = Math.sqrt(best.distanceSq) * 69;
    if (distanceMiles > 150) return null;
    return best.place;
  }

  private initializeSeeds(): void {
    for (const seed of SEED_PLACE_DEFINITIONS) {
      const place: SearchIndexedPlace = {
        text: seed.text,
        cityRegionId: buildCityRegionId("US", seed.stateName, seed.text),
        stateRegionId: buildStateRegionId("US", seed.stateName),
        searchKey: normalizeSearchText(seed.text),
        population: seed.population,
        countryCode: "US",
        stateName: seed.stateName,
        lat: seed.lat,
        lng: seed.lng,
      };
      this.seedPlaces.push(place);
      this.addSeedEntry(place, seed.text);
      for (const alias of seed.aliases ?? []) {
        this.addSeedEntry(place, alias);
      }
    }
  }

  private addSeedEntry(place: SearchIndexedPlace, rawSearchKey: string): void {
    const searchKey = normalizeSearchText(rawSearchKey);
    if (searchKey.length < 2) return;
    this.seedEntries.push({ searchKey, place });
    const existing = this.seedExactMap.get(searchKey);
    if (!existing || existing.population < place.population) {
      this.seedExactMap.set(searchKey, place);
    }
  }

  private searchSeeds(query: string, limit: number): SearchIndexedPlace[] {
    const normalized = normalizeSearchText(query);
    if (normalized.length < 2) return [];
    const ranked = this.seedEntries
      .filter(({ searchKey, place }) =>
        searchKey.includes(normalized) || place.searchKey.includes(normalized),
      )
      .sort((a, b) => {
        const aStarts = a.searchKey.startsWith(normalized) || a.place.searchKey.startsWith(normalized) ? 1 : 0;
        const bStarts = b.searchKey.startsWith(normalized) || b.place.searchKey.startsWith(normalized) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        return b.place.population - a.place.population || a.place.text.localeCompare(b.place.text);
      })
      .map(({ place }) => place);
    return this.mergePlaces([], ranked, limit);
  }

  private mergePlaces(
    leading: SearchIndexedPlace[],
    trailing: SearchIndexedPlace[],
    limit: number,
  ): SearchIndexedPlace[] {
    const seen = new Set<string>();
    const merged: SearchIndexedPlace[] = [];
    for (const row of [...leading, ...trailing]) {
      const key = `${row.cityRegionId}:${row.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= Math.max(1, Math.min(24, limit))) break;
    }
    return merged;
  }

  private addCandidate(place: SearchIndexedPlace): void {
    if (place.searchKey.length < 2) return;
    const current = this.exactMap.get(place.searchKey);
    if (!current || current.population < place.population) {
      this.exactMap.set(place.searchKey, place);
    }
    const bucketKey = place.searchKey.slice(0, 3);
    const bucket = this.prefixMap.get(bucketKey) ?? [];
    if (!bucket.some((row) => row.searchKey === place.searchKey)) {
      bucket.push(place);
    }
    this.prefixMap.set(bucketKey, bucket);
  }

  /**
   * Vitest: the module singleton may already have loaded production GeoNames data from another suite.
   */
  resetForTests(): void {
    if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") return;
    this.loaded = false;
    this.loading = false;
    this.loadScheduled = false;
    this.loadPromise = null;
    this.lastLoadTotalMs = 0;
    this.lastIndexedWorkMs = 0;
    this.loadError = null;
    this.prefixMap.clear();
    this.exactMap.clear();
    this.allPlaces.length = 0;
    this.seedEntries.length = 0;
    this.seedExactMap.clear();
    this.seedPlaces.length = 0;
    this.initializeSeeds();
  }
}

export const searchPlacesIndexService = new SearchPlacesIndexService();

export function resetSearchPlacesIndexForTests(): void {
  searchPlacesIndexService.resetForTests();
}
