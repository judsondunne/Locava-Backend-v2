import { describe, expect, it } from "vitest";
import { PlaceImageSearchSuccessSchema } from "./types.js";
import { buildApiPlaceQuery, parseSeedIds, VERMONT_PHOTO_QA_SEEDS } from "./seeds.vermont.js";
import { normalizeImageUrl, validateImageMetadata } from "./imageValidator.js";
import {
  averageHash,
  duplicateRate,
  findDuplicateIndex,
  hammingDistance,
} from "./duplicateDetection.js";
import { computeProductionVerdict, scorePlace, summarizeBatch, visionPlaceLabel } from "./scoring.js";
import { renderMarkdownSummary } from "./reportWriter.js";
import type { PlaceQaResult, RunState } from "./types.js";

describe("photo-search-qa seeds", () => {
  it("parses Vermont seed set with unique ids", () => {
    expect(VERMONT_PHOTO_QA_SEEDS.length).toBe(20);
    const ids = new Set(VERMONT_PHOTO_QA_SEEDS.map((s) => s.id));
    expect(ids.size).toBe(20);
  });

  it("builds scoped API place query", () => {
    const seed = VERMONT_PHOTO_QA_SEEDS[0]!;
    expect(buildApiPlaceQuery(seed)).toBe("Stowe VT, Bingham Falls");
  });

  it("parseSeedIds accepts comma list", () => {
    const ids = parseSeedIds("bingham-falls-stowe, quechee-gorge-quechee");
    expect(ids).toEqual(["bingham-falls-stowe", "quechee-gorge-quechee"]);
  });
});

describe("photo-search-qa schema validation", () => {
  it("validates success response shape", () => {
    const parsed = PlaceImageSearchSuccessSchema.safeParse({
      ok: true,
      placeName: "Bingham Falls",
      searchQuery: "Bingham Falls Stowe Vermont",
      source: "serper",
      results: [
        {
          id: "a",
          imageUrl: "https://example.com/a.jpg",
          caption: "Falls",
          sourceName: "Example",
          sourceUrl: "https://example.com/page",
          sourceDomain: "example.com",
          provider: "serper",
          backlinkUrl: "https://example.com/page",
          licenseNote: "test",
          copyrightDisclaimer: "test",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("photo-search-qa image validation", () => {
  it("normalizes image URLs by stripping resize params", () => {
    const a = normalizeImageUrl("https://cdn.example.com/a.jpg?w=100&h=100&token=abc");
    const b = normalizeImageUrl("https://cdn.example.com/a.jpg?token=abc");
    expect(a).toBe(b);
  });

  it("flags missing metadata fields", () => {
    const result = validateImageMetadata({
      id: "x",
      imageUrl: "https://example.com/a.jpg",
      caption: "Cap",
      sourceName: "Name",
      sourceUrl: "https://example.com",
    });
    expect(result.metadataOk).toBe(false);
    expect(result.missingMetadataFields).toContain("sourceDomain");
  });
});

describe("photo-search-qa duplicate detection", () => {
  it("detects exact normalized URL duplicates", () => {
    const urls = ["https://a.com/x.jpg", "https://a.com/x.jpg"];
    const hashes = [1n, 1n];
    expect(findDuplicateIndex(1, urls, hashes, 1n)).toBe(0);
  });

  it("computes hamming distance", () => {
    expect(hammingDistance(0b101n, 0b111n)).toBe(1);
  });

  it("uses average hash for near duplicates", () => {
    const bytes = Uint8Array.from({ length: 128 }, (_, i) => i % 256);
    const hash = averageHash(bytes);
    expect(hash).not.toBeNull();
  });

  it("duplicateRate handles zero total", () => {
    expect(duplicateRate(0, 0)).toBe(0);
  });
});

describe("photo-search-qa scoring", () => {
  it("fails place with insufficient valid images", () => {
    const place = scorePlace({
      seedId: "test",
      placeName: "Test",
      town: "Town",
      state: "VT",
      apiPlaceQuery: "Town VT, Test",
      searchQueryUsed: "Test VT",
      provider: "serper",
      responseMs: 1200,
      ttfbMs: 400,
      imageValidationMs: 300,
      minImages: 4,
      images: [
        {
          imageId: "1",
          imageUrl: "https://example.com/1.jpg",
          httpStatus: 200,
          contentType: "image/jpeg",
          byteSize: 5000,
          width: 800,
          height: 600,
          loadMs: 100,
          loadsOk: true,
          metadataOk: true,
          missingMetadataFields: [],
          sourcePageOk: true,
          duplicateOfIndex: null,
          failureReasons: [],
          vision: null,
          placeLabel: "not_judged",
        },
      ],
    });
    expect(place.passFail).toBe("fail");
    expect(place.failureReasons).toContain("insufficient_valid_images:1<4");
  });

  it("summarizes batch metrics", () => {
    const place = scorePlace({
      seedId: "test",
      placeName: "Test",
      town: "Town",
      state: "VT",
      apiPlaceQuery: "q",
      searchQueryUsed: "q",
      provider: "serper",
      responseMs: 1000,
      ttfbMs: 200,
      imageValidationMs: 100,
      minImages: 4,
      images: [],
      apiError: "No results",
    });
    const batch = summarizeBatch(1, [place]);
    expect(batch.placesTested).toBe(1);
    expect(batch.failed).toBe(1);
  });

  it("maps vision labels", () => {
    expect(
      visionPlaceLabel({
        placeMatchScore: 5,
        visualQualityScore: 5,
        locavaCoolnessScore: 5,
        wrongPlaceRisk: "low",
        visibleSignals: [],
        concerns: [],
        shortReason: "good",
        automated: true,
      }),
    ).toBe("likely_correct");
  });

  it("computes production verdict", () => {
    const places: PlaceQaResult[] = Array.from({ length: 10 }, (_, i) => ({
      seedId: `p${i}`,
      placeName: "P",
      town: "T",
      state: "VT",
      apiPlaceQuery: "q",
      searchQueryUsed: "q",
      provider: "serper",
      totalResults: 4,
      validImageCount: 4,
      brokenImageCount: 0,
      missingMetadataCount: 0,
      duplicateCount: 0,
      avgPlaceMatchScore: 4.5,
      avgVisualQualityScore: 4,
      avgCoolnessScore: 4,
      highWrongPlaceRiskCount: 0,
      responseMs: 1500,
      ttfbMs: 400,
      imageValidationMs: 500,
      estimatedProviderCalls: 1,
      estimatedCredits: 1,
      exactCostKnown: false,
      passFail: "pass",
      failureReasons: [],
      images: [],
    }));
    const batch = summarizeBatch(1, places.slice(0, 5));
    expect(computeProductionVerdict(places, [batch])).toBe("PRODUCTION READY");
  });
});

describe("photo-search-qa report generation", () => {
  it("renders markdown summary", () => {
    const state: RunState = {
      runId: "test-run",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      target: "production",
      baseUrl: "https://example.com",
      batchSize: 5,
      minImages: 4,
      maxCredits: 50,
      completedPlaceIds: [],
      currentBatchNumber: 1,
      estimatedProviderCalls: 0,
      estimatedCredits: 0,
      exactCostKnown: false,
      places: [],
      batches: [],
      visionMode: "manual",
      visionModel: null,
    };
    const md = renderMarkdownSummary(state);
    expect(md).toContain("Locava Photo Search QA Summary");
  });
});
