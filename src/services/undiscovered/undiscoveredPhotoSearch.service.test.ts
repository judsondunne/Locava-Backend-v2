import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../config/env.js";
import type { UndiscoveredPhotoSearchCache } from "../../contracts/surfaces/undiscovered-photo-search.contract.js";
import { resetInFlightDedupeForTests } from "../../cache/in-flight-dedupe.js";
import {
  resetUndiscoveredPhotoSearchBudgetForTests,
} from "../../lib/undiscovered/undiscoveredPhotoSearchBudget.js";

const processPbfAssetPreviewSpotMock = vi.fn();
const getUnexploredDocForPhotoSearchMock = vi.fn();
const writeUnexploredPhotoSearchMock = vi.fn();
const readUnexploredPhotoSearchAfterRefreshMock = vi.fn();

vi.mock("../../lib/pbf/pbfAssetPreviewSpot.js", () => ({
  processPbfAssetPreviewSpot: (...args: unknown[]) => processPbfAssetPreviewSpotMock(...args),
}));

vi.mock("../../repositories/source-of-truth/unexplored-photo-search-firestore.adapter.js", () => ({
  getUnexploredDocForPhotoSearch: (...args: unknown[]) => getUnexploredDocForPhotoSearchMock(...args),
  writeUnexploredPhotoSearch: (...args: unknown[]) => writeUnexploredPhotoSearchMock(...args),
  readUnexploredPhotoSearchAfterRefresh: (...args: unknown[]) =>
    readUnexploredPhotoSearchAfterRefreshMock(...args),
}));

import { searchPlaceWebImagesForUndiscovered } from "./undiscoveredPhotoSearch.service.js";

const env = {} as AppEnv;

function futureIso(days = 30): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function readyCache(overrides: Partial<UndiscoveredPhotoSearchCache> = {}): UndiscoveredPhotoSearchCache {
  return {
    schema: "locava.undiscoveredPhotoSearch",
    version: 1,
    status: "ready",
    query: '"Quechee Gorge" "Quechee" "Vermont" photos',
    provider: "serper",
    validator: "metadata_v3",
    fetchedAt: new Date().toISOString(),
    expiresAt: futureIso(),
    resultCount: 1,
    results: [
      {
        id: "img-1",
        rank: 1,
        thumbnailUrl: "https://example.com/a.jpg",
        imageUrl: "https://example.com/a.jpg",
        sourceUrl: "https://example.com/page",
        sourceTitle: "Quechee Gorge",
        sourceDomain: "example.com",
        provider: "serper",
        width: 800,
        height: 600,
        attributionText: "Quechee Gorge · example.com",
        license: null,
        copyrightNotice: null,
        disclaimer: "Image/result is from the web source shown. Locava does not own or claim this image.",
        confidence: 18,
        validationStatus: "accepted",
        fetchedAt: new Date().toISOString(),
      },
    ],
    error: null,
    ...overrides,
  };
}

function baseDoc() {
  return {
    id: "spot-1",
    displayName: "Quechee Gorge",
    location: { city: "Quechee", state: "Vermont" },
    category: "waterfall",
    lat: 43.5,
    lng: -72.4,
  };
}

function providerPreviewResult() {
  return {
    item: {
      assetPreview: {
        query: '"Quechee Gorge" "Quechee" "Vermont" photos',
        provider: "serper",
        assetStatus: "found",
        externalAssets: [
          {
            id: "img-1",
            rank: 1,
            imageUrl: "https://example.com/a.jpg",
            caption: "Quechee Gorge",
            sourceName: "example.com",
            sourceUrl: "https://example.com/page",
            sourceDomain: "example.com",
            provider: "serper",
            assetMatchScore: 18,
            assetMatchConfidence: "high",
            assetMatchReasons: [],
            backlinkUrl: "https://example.com/page",
          },
        ],
        fetchedAt: new Date().toISOString(),
      },
    },
  };
}

describe("undiscoveredPhotoSearch.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInFlightDedupeForTests();
    resetUndiscoveredPhotoSearchBudgetForTests();
    process.env.UNDISCOVERED_PHOTO_SEARCH_ENABLED = "true";
    process.env.UNDISCOVERED_PHOTO_SEARCH_MAX_PROVIDER_CALLS_PER_DAY = "500";
    writeUnexploredPhotoSearchMock.mockResolvedValue(undefined);
  });

  it("ignores cached empty results and re-fetches from provider", async () => {
    const emptyCache: UndiscoveredPhotoSearchCache = {
      schema: "locava.undiscoveredPhotoSearch",
      version: 1,
      status: "empty",
      query: "Lye Brook Trail Arlington Vermont",
      provider: "serper",
      validator: "metadata_v3",
      fetchedAt: new Date().toISOString(),
      expiresAt: futureIso(),
      resultCount: 0,
      results: [],
      error: null,
    };
    getUnexploredDocForPhotoSearchMock.mockResolvedValue({ ...baseDoc(), photoSearch: emptyCache });
    processPbfAssetPreviewSpotMock.mockResolvedValue(providerPreviewResult());

    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "spot-1" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(processPbfAssetPreviewSpotMock).toHaveBeenCalledTimes(1);
    expect(result.response.items.length).toBeGreaterThan(0);
  });

  it("returns cache hit without calling provider", async () => {
    const cache = readyCache();
    getUnexploredDocForPhotoSearchMock.mockResolvedValue({ ...baseDoc(), photoSearch: cache });

    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "spot-1" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.cached).toBe(true);
    expect(result.response.cacheStatus).toBe("hit");
    expect(result.response.items).toHaveLength(1);
    expect(processPbfAssetPreviewSpotMock).not.toHaveBeenCalled();
  });

  it("calls provider on cache miss and writes normalized photoSearch", async () => {
    getUnexploredDocForPhotoSearchMock.mockResolvedValue(baseDoc());
    processPbfAssetPreviewSpotMock.mockResolvedValue(providerPreviewResult());

    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "spot-1" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(processPbfAssetPreviewSpotMock).toHaveBeenCalledTimes(1);
    expect(processPbfAssetPreviewSpotMock.mock.calls[0][1]).toEqual({
      env,
      visionMode: "off",
      strictTitleSourceMatch: false,
      scoringProfile: "undiscovered_app",
    });
    expect(processPbfAssetPreviewSpotMock.mock.calls[0][1]).not.toHaveProperty("geminiApiKey");
    expect(writeUnexploredPhotoSearchMock).toHaveBeenCalled();
    const written = writeUnexploredPhotoSearchMock.mock.calls.at(-1)?.[2];
    expect(written.validator).toBe("metadata_v3");
    expect(written.results[0]).toMatchObject({
      sourceUrl: "https://example.com/page",
      sourceDomain: "example.com",
      attributionText: expect.any(String),
      disclaimer: expect.any(String),
    });
    expect(result.response.items[0]?.sourceDomain).toBe("example.com");
  });

  it("forceRefresh bypasses valid cache", async () => {
    getUnexploredDocForPhotoSearchMock.mockResolvedValue({
      ...baseDoc(),
      photoSearch: readyCache(),
    });
    processPbfAssetPreviewSpotMock.mockResolvedValue(providerPreviewResult());

    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "spot-1", forceRefresh: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.cacheStatus).toBe("refreshed");
    expect(processPbfAssetPreviewSpotMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for missing doc", async () => {
    getUnexploredDocForPhotoSearchMock.mockResolvedValue(null);
    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "missing" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(404);
  });

  it("returns safe failed response when provider fails", async () => {
    getUnexploredDocForPhotoSearchMock.mockResolvedValue(baseDoc());
    processPbfAssetPreviewSpotMock.mockResolvedValue({
      item: {
        assetPreview: {
          query: "test",
          provider: "serper",
          assetStatus: "error",
          externalAssets: [],
          lookupError: "upstream timeout",
          fetchedAt: new Date().toISOString(),
        },
      },
    });

    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "spot-1" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.cacheStatus).toBe("failed");
    expect(result.response.items).toHaveLength(0);
  });

  it("returns budget_exceeded without provider call when daily cap hit", async () => {
    process.env.UNDISCOVERED_PHOTO_SEARCH_MAX_PROVIDER_CALLS_PER_DAY = "1";
    resetUndiscoveredPhotoSearchBudgetForTests();
    getUnexploredDocForPhotoSearchMock.mockResolvedValue(baseDoc());
    processPbfAssetPreviewSpotMock.mockResolvedValue(providerPreviewResult());

    await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "spot-1-a" },
    });
    processPbfAssetPreviewSpotMock.mockClear();

    const result = await searchPlaceWebImagesForUndiscovered({
      env,
      viewerId: "viewer-1",
      body: { collection: "unexploredSpots", id: "spot-1-b" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.cacheStatus).toBe("failed");
    expect(processPbfAssetPreviewSpotMock).not.toHaveBeenCalled();
  });

  it("never imports Gemini modules in service source", async () => {
    const serviceSource = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./undiscoveredPhotoSearch.service.ts", import.meta.url), "utf8"),
    );
    expect(serviceSource).not.toContain("judgePbfAssetPhotoWithGemini");
    expect(serviceSource).not.toContain("resolvePbfAssetGeminiConfig");
    expect(serviceSource).not.toContain("geminiApiKey");
  });
});
