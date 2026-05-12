import { describe, expect, it } from "vitest";
import { applyTargetedPlaceCandidateQuality } from "./applyTargetedPlaceCandidateQuality.js";
import { normalizeWikidataPlaceCandidate } from "./normalizePlaceCandidate.js";
import { scorePlaceCandidate } from "./scorePlaceCandidate.js";
import { resolveUsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import type { PlaceCandidate } from "./types.js";

const state = resolveUsStatePlaceConfig({ stateName: "Vermont", stateCode: "VT" });

function polish(raw: Parameters<typeof normalizeWikidataPlaceCandidate>[0]): PlaceCandidate {
  return applyTargetedPlaceCandidateQuality(
    scorePlaceCandidate(normalizeWikidataPlaceCandidate(raw, state, false)),
  );
}

describe("pipeline quality and priority", () => {
  it("prioritizes quarry and waterfall candidates for immediate media", () => {
    const quarry = polish({
      source: "wikidata",
      qid: "Q1",
      name: "Rock of Ages Granite Quarry",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["quarry"],
      targetedCategoryHints: ["quarry"],
      sourceBucketIds: ["quarry"],
      sourceBucketLabels: ["quarry"],
    });
    const waterfall = polish({
      source: "wikidata",
      qid: "Q2",
      name: "Moss Glen Falls",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["waterfall"],
      targetedCategoryHints: ["waterfall"],
    });
    expect(quarry.eligibleForMediaPipeline).toBe(true);
    expect(waterfall.eligibleForMediaPipeline).toBe(true);
    expect(waterfall.priorityQueue).toBe("P0");
    expect(waterfall.recommendedAction).toBe("RUN_MEDIA_NOW");
  });

  it("keeps generic hills, ponds, and rivers eligible as backlog", () => {
    const hill = polish({
      source: "wikidata",
      qid: "Q3",
      name: "Burnt Mountain",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["mountain"],
      targetedCategoryHints: ["mountain"],
    });
    const pond = polish({
      source: "wikidata",
      qid: "Q4",
      name: "Johnson Pond",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["lake"],
      targetedCategoryHints: ["lake"],
    });
    const river = polish({
      source: "wikidata",
      qid: "Q5",
      name: "East Brook",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["river"],
      targetedCategoryHints: ["river"],
    });
    expect(hill.candidateTier).not.toBe("A");
    expect(pond.candidateTier).not.toBe("A");
    expect(river.candidateTier).not.toBe("A");
    expect(hill.eligibleForMediaPipeline).toBe(true);
    expect(pond.eligibleForMediaPipeline).toBe(true);
    expect(river.eligibleForMediaPipeline).toBe(true);
    expect(pond.priorityQueue).toBe("P3");
    expect(pond.recommendedAction).toBe("KEEP_BACKLOG");
  });

  it("blocks cemetery from quarry bucket", () => {
    const cemetery = polish({
      source: "wikidata",
      qid: "Q6",
      name: "Hope Cemetery",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["cemetery"],
      targetedCategoryHints: ["quarry"],
      sourceBucketIds: ["quarry"],
    });
    expect(cemetery.blocked).toBe(true);
    expect(cemetery.eligibleForMediaPipeline).toBe(false);
    expect(cemetery.blockReasons).toContain("actual_type_cemetery");
    expect(cemetery.recommendedAction).toBe("BLOCK");
  });

  it("boosts media signal score into priority", () => {
    const candidate = polish({
      source: "wikidata",
      qid: "Q7",
      name: "Hamilton Falls",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["waterfall"],
      targetedCategoryHints: ["waterfall"],
    });
    const withMedia = applyTargetedPlaceCandidateQuality({
      ...candidate,
      mediaSignalScore: 20,
      mediaSignals: {
        checked: true,
        hasWikidataImage: true,
        hasCommonsCategory: true,
        mediaAvailability: "strong",
      },
    });
    expect((withMedia.locavaPriorityScore ?? 0)).toBeGreaterThan(candidate.locavaPriorityScore ?? 0);
  });

  it("ranks gorge and notch candidates highly", () => {
    const gorge = polish({
      source: "wikidata",
      qid: "Q8",
      name: "Huntington Gorge",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["gorge"],
      targetedCategoryHints: ["gorge"],
    });
    const notch = polish({
      source: "wikidata",
      qid: "Q9",
      name: "Smugglers Notch",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["mountain pass"],
      targetedCategoryHints: ["mountain"],
    });
    expect(gorge.eligibleForMediaPipeline).toBe(true);
    expect(notch.eligibleForMediaPipeline).toBe(true);
    expect(gorge.priorityQueue).toBe("P0");
    expect(notch.priorityQueue).toBe("P0");
  });

  it("does not let quarry bucket hints override cemetery actual type", () => {
    const cemetery = polish({
      source: "wikidata",
      qid: "Q10",
      name: "Graniteville Cemetery",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["cemetery"],
      targetedCategoryHints: ["quarry"],
      sourceBucketIds: ["quarry"],
    });
    expect(cemetery.primaryCategory).not.toBe("quarry");
    expect(cemetery.debug.bucketHintSuppressedReasons).toContain("actual_type_cemetery");
    expect(cemetery.blocked).toBe(true);
  });

  it("keeps obvious gems eligible without media signals", () => {
    const gem = polish({
      source: "wikidata",
      qid: "Q11",
      name: "Hamilton Falls",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["waterfall"],
      targetedCategoryHints: ["waterfall"],
    });
    expect(gem.eligibleForMediaPipeline).toBe(true);
    expect(gem.mediaSignalScore ?? 0).toBe(0);
  });

  it("keeps named lakes eligible at P1 or P2", () => {
    const lake = polish({
      source: "wikidata",
      qid: "Q12",
      name: "Lake Champlain",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["lake"],
      targetedCategoryHints: ["lake"],
    });
    const localLake = polish({
      source: "wikidata",
      qid: "Q13",
      name: "Lake Dunmore",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["lake"],
      targetedCategoryHints: ["lake"],
    });
    expect(lake.eligibleForMediaPipeline).toBe(true);
    expect(localLake.eligibleForMediaPipeline).toBe(true);
    expect(["P1", "P2"]).toContain(lake.priorityQueue);
    expect(localLake.priorityQueue).toBe("P2");
  });

  it("deduplicates repeated priority reasons", () => {
    const waterfall = polish({
      source: "wikidata",
      qid: "Q14",
      name: "Moss Glen Falls",
      lat: 44.1,
      lng: -72.9,
      instanceLabels: ["waterfall"],
      targetedCategoryHints: ["waterfall"],
    });
    const uniqueReasons = new Set(waterfall.priorityReasons ?? []);
    expect((waterfall.priorityReasons ?? []).length).toBe(uniqueReasons.size);
  });
});
