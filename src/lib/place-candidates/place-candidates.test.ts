import { describe, expect, it } from "vitest";
import { classifyPlaceCandidateTier } from "./classifyPlaceCandidateTier.js";
import { totalsByPrimaryCategory, totalsByTier } from "./aggregatePlaceCandidateTotals.js";
import { dedupePlaceCandidates, shouldMergeByNameAndCoords } from "./dedupePlaceCandidates.js";
import { normalizeCategoryLabels, normalizeWikidataPlaceCandidate } from "./normalizePlaceCandidate.js";
import { scorePlaceCandidate } from "./scorePlaceCandidate.js";
import { comparePlaceCandidates, sortPlaceCandidates, sortPlaceCandidatesByScore } from "./sortPlaceCandidates.js";
import { resolveUsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import type { PlaceCandidate } from "./types.js";

function baseCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    placeCandidateId: "abc123",
    name: "Example Falls",
    state: "Pennsylvania",
    stateCode: "PA",
    country: "US",
    lat: 40.1,
    lng: -75.1,
    categories: ["waterfall"],
    primaryCategory: "waterfall",
    candidateTier: "C",
    sourceIds: { wikidata: "Q1" },
    sourceUrls: { wikidata: "https://www.wikidata.org/wiki/Q1" },
    rawSources: ["wikidata"],
    sourceConfidence: 0.7,
    locavaScore: 0,
    signals: {
      hasCoordinates: true,
      hasWikipedia: true,
      hasWikidata: true,
      hasCommonsCategory: true,
      hasImageField: true,
      hasUsefulCategory: true,
      isOutdoorLikely: true,
      isLandmarkLikely: false,
      isTourismLikely: false,
      isTooGeneric: false,
    },
    debug: {
      matchedSourceCategories: ["waterfall"],
      normalizedFrom: ["wikidata"],
      scoreReasons: [],
      tierReasons: [],
      dedupeKey: "Q1",
    },
    ...overrides,
  };
}

describe("place candidate normalization and scoring", () => {
  it("gives waterfall a high Locava score and tier A", () => {
    const scored = scorePlaceCandidate(baseCandidate());
    expect(scored.locavaScore).toBeGreaterThanOrEqual(70);
    expect(scored.candidateTier).toBe("A");
  });

  it("classifies cave, beach, and park as tier A", () => {
    expect(scorePlaceCandidate(baseCandidate({ primaryCategory: "cave", categories: ["cave"] })).candidateTier).toBe("A");
    expect(scorePlaceCandidate(baseCandidate({ primaryCategory: "beach", categories: ["beach"] })).candidateTier).toBe("A");
    expect(
      scorePlaceCandidate(
        baseCandidate({
          primaryCategory: "park",
          categories: ["park"],
          debug: { ...baseCandidate().debug, matchedSourceCategories: ["state park"] },
        }),
      ).candidateTier,
    ).toBe("A");
  });

  it("classifies museum as tier B", () => {
    const scored = scorePlaceCandidate(
      baseCandidate({
        categories: ["museum"],
        primaryCategory: "museum",
        signals: { ...baseCandidate().signals, isOutdoorLikely: false, isLandmarkLikely: true },
        debug: { ...baseCandidate().debug, matchedSourceCategories: ["museum"] },
      }),
    );
    expect(scored.candidateTier).toBe("B");
  });

  it("classifies cemetery and generic monument as tier C", () => {
    expect(
      scorePlaceCandidate(
        baseCandidate({
          name: "Old Cemetery",
          categories: ["cemetery"],
          primaryCategory: "cemetery",
          debug: { ...baseCandidate().debug, matchedSourceCategories: ["cemetery"] },
        }),
      ).candidateTier,
    ).toBe("C");
    expect(
      scorePlaceCandidate(
        baseCandidate({
          name: "Town Monument",
          categories: ["landmark"],
          primaryCategory: "landmark",
          signals: {
            ...baseCandidate().signals,
            isOutdoorLikely: false,
            hasWikipedia: false,
            hasCommonsCategory: false,
            hasImageField: false,
            isLandmarkLikely: true,
          },
          debug: { ...baseCandidate().debug, matchedSourceCategories: ["monument"] },
        }),
      ).candidateTier,
    ).toBe("C");
  });

  it("classifies minor architecture as tier C", () => {
    const scored = scorePlaceCandidate(
      baseCandidate({
        name: "Smith Law Office",
        categories: ["architecture"],
        primaryCategory: "architecture",
        signals: { ...baseCandidate().signals, isOutdoorLikely: false },
        debug: { ...baseCandidate().debug, matchedSourceCategories: ["building"] },
      }),
    );
    expect(scored.candidateTier).toBe("C");
  });

  it("rejects missing coordinates", () => {
    const scored = scorePlaceCandidate(
      baseCandidate({ signals: { ...baseCandidate().signals, hasCoordinates: false } }),
    );
    expect(scored.locavaScore).toBe(0);
    expect(scored.candidateTier).toBe("REJECTED");
    expect(scored.debug.scoreReasons).toContain("missing_coordinates");
  });

  it("normalizes categories deterministically", () => {
    const normalized = normalizeCategoryLabels(["state park", "tourist attraction"]);
    expect(normalized.primaryCategory).toBe("park");
    expect(normalized.categories).toContain("park");
    expect(normalized.categories).toContain("landmark");
  });

  it("normalizes wikidata raw candidate", () => {
    const state = resolveUsStatePlaceConfig({ stateName: "Pennsylvania", stateCode: "PA" });
    const candidate = normalizeWikidataPlaceCandidate(
      {
        source: "wikidata",
        qid: "Q42",
        name: "Ricketts Glen State Park",
        lat: 41.3,
        lng: -76.3,
        instanceLabels: ["state park"],
        wikipediaUrl: "https://en.wikipedia.org/wiki/Ricketts_Glen_State_Park",
      },
      state,
      false,
    );
    expect(candidate.primaryCategory).toBe("park");
    expect(candidate.sourceIds.wikidata).toBe("Q42");
  });
});

describe("place candidate dedupe", () => {
  it("merges duplicate same QID", () => {
    const a = scorePlaceCandidate(baseCandidate({ locavaScore: 50, sourceIds: { wikidata: "Q9" } }));
    const b = scorePlaceCandidate(
      baseCandidate({
        placeCandidateId: "other",
        locavaScore: 80,
        sourceIds: { wikidata: "Q9" },
        categories: ["park"],
        primaryCategory: "park",
      }),
    );
    const deduped = dedupePlaceCandidates([a, b]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.locavaScore).toBeGreaterThanOrEqual(80);
    expect(deduped[0]?.categories).toEqual(expect.arrayContaining(["waterfall", "park"]));
  });

  it("merges duplicate same name and nearby coords", () => {
    const a = baseCandidate({ sourceIds: { wikidata: "Q1" }, locavaScore: 60 });
    const b = baseCandidate({
      placeCandidateId: "b",
      sourceIds: { wikidata: "Q2" },
      lat: 40.10001,
      lng: -75.10001,
      locavaScore: 75,
    });
    expect(shouldMergeByNameAndCoords(a, b)).toBe(true);
    const deduped = dedupePlaceCandidates([scorePlaceCandidate(a), scorePlaceCandidate(b)]);
    expect(deduped).toHaveLength(1);
  });

  it("does not merge same name far apart", () => {
    const a = baseCandidate({ sourceIds: { wikidata: "Q1" } });
    const b = baseCandidate({
      placeCandidateId: "b",
      sourceIds: { wikidata: "Q2" },
      lat: 41.5,
      lng: -76.5,
    });
    expect(shouldMergeByNameAndCoords(a, b)).toBe(false);
    expect(dedupePlaceCandidates([scorePlaceCandidate(a), scorePlaceCandidate(b)])).toHaveLength(2);
  });
});

describe("state config", () => {
  it("resolves Pennsylvania", () => {
    const state = resolveUsStatePlaceConfig({ stateName: "Pennsylvania", stateCode: "PA" });
    expect(state.wikidataQid).toBe("Q1400");
  });

  it("returns useful error for unsupported state", () => {
    expect(() => resolveUsStatePlaceConfig({ stateName: "Atlantis" })).toThrow(/Unsupported state/);
  });
});

describe("tier and sorting", () => {
  it("sorts candidates by tier then score", () => {
    const waterfall = scorePlaceCandidate(baseCandidate({ name: "Falls", locavaScore: 80, candidateTier: "A" }));
    const museum = scorePlaceCandidate(
      baseCandidate({
        name: "Museum",
        categories: ["museum"],
        primaryCategory: "museum",
        locavaScore: 90,
        candidateTier: "B",
        debug: { ...baseCandidate().debug, matchedSourceCategories: ["museum"] },
      }),
    );
    const cemetery = scorePlaceCandidate(
      baseCandidate({
        name: "Cemetery",
        categories: ["cemetery"],
        primaryCategory: "cemetery",
        locavaScore: 95,
        candidateTier: "C",
        debug: { ...baseCandidate().debug, matchedSourceCategories: ["cemetery"] },
      }),
    );
    const sorted = sortPlaceCandidates([cemetery, museum, waterfall]);
    expect(sorted.map((row) => row.candidateTier)).toEqual(["A", "B", "C"]);
  });

  it("builds media pipeline list from A and B only", () => {
    const rows = sortPlaceCandidatesByScore(
      [
        scorePlaceCandidate(baseCandidate({ candidateTier: "A" })),
        scorePlaceCandidate(
          baseCandidate({
            categories: ["museum"],
            primaryCategory: "museum",
            debug: { ...baseCandidate().debug, matchedSourceCategories: ["museum"] },
          }),
        ),
        scorePlaceCandidate(
          baseCandidate({
            categories: ["cemetery"],
            primaryCategory: "cemetery",
            debug: { ...baseCandidate().debug, matchedSourceCategories: ["cemetery"] },
          }),
        ),
      ].filter((row) => row.candidateTier === "A" || row.candidateTier === "B"),
    );
    expect(rows.every((row) => row.candidateTier === "A" || row.candidateTier === "B")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("counts tier breakdown deterministically", () => {
    const rows = [
      scorePlaceCandidate(baseCandidate()),
      scorePlaceCandidate(
        baseCandidate({
          categories: ["museum"],
          primaryCategory: "museum",
          debug: { ...baseCandidate().debug, matchedSourceCategories: ["museum"] },
        }),
      ),
      scorePlaceCandidate(
        baseCandidate({
          categories: ["cemetery"],
          primaryCategory: "cemetery",
          debug: { ...baseCandidate().debug, matchedSourceCategories: ["cemetery"] },
        }),
      ),
    ];
    expect(totalsByTier(rows)).toEqual({ A: 1, B: 1, C: 1, REJECTED: 0 });
    expect(totalsByPrimaryCategory(rows).waterfall).toBe(1);
  });

  it("is deterministic", () => {
    const first = scorePlaceCandidate(baseCandidate());
    const second = scorePlaceCandidate(baseCandidate());
    expect(first).toEqual(second);
    expect(comparePlaceCandidates(first, second)).toBe(0);
    expect(classifyPlaceCandidateTier(first)).toEqual(classifyPlaceCandidateTier(second));
  });
});
