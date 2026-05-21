import { describe, expect, it } from "vitest";
import { enforceLaneSelectionAndDedupe, buildCurationInspectionWarnings } from "../wikiSpotCuratorLaneSelection.js";
import type { WikiCuratorPromptCandidate } from "../wikiSpotCuratorPrompt.js";
import type { WikiSpotCuratorDecisionRow } from "../wikiSpotCurator.schema.js";

function post(partial: Partial<WikiCuratorPromptCandidate> & { postId: string }): WikiCuratorPromptCandidate {
  return {
    postId: partial.postId,
    title: partial.title ?? "T",
    caption: partial.caption ?? null,
    activities: partial.activities ?? [],
    moderatorTier: partial.moderatorTier ?? null,
    day: partial.day ?? "2020-01-01",
    dayScore: partial.dayScore ?? 20,
    latitude: partial.latitude ?? 34,
    longitude: partial.longitude ?? -119,
    coordinateSource: partial.coordinateSource ?? "photo",
    primaryMediaIndex: partial.primaryMediaIndex ?? 0,
    media:
      partial.media ??
      [{ assetTitle: "", imageUrl: "https://example.com/a.jpg", sourceUrl: "", width: 2000, height: 1500, orientation: "landscape", score: 20 }],
    sourcePrimaryUrl: partial.sourcePrimaryUrl ?? null,
    distanceMetersFromAnchor: partial.distanceMetersFromAnchor ?? 500,
    backendDistanceBucket: partial.backendDistanceBucket ?? "core",
    detectedViewHints: partial.detectedViewHints ?? { planeLikely: false, droneLikely: false, helicopterLikely: false, matchedKeywords: [] }
  };
}

function dec(partial: Partial<WikiSpotCuratorDecisionRow> & { postId: string }): WikiSpotCuratorDecisionRow {
  return {
    postId: partial.postId,
    decision: partial.decision ?? "publish",
    moderatorTier: partial.moderatorTier ?? 4,
    visitWorthyScore: partial.visitWorthyScore ?? 8,
    visualAppealScore: partial.visualAppealScore ?? 8,
    authenticityScore: partial.authenticityScore ?? 7,
    captionQualityScore: partial.captionQualityScore ?? 7,
    finalRankForSpot: partial.finalRankForSpot ?? 1,
    shouldUseInFinalSpotSet: partial.shouldUseInFinalSpotSet ?? true,
    refinedTitle: partial.refinedTitle ?? "T",
    refinedCaption: partial.refinedCaption ?? "C",
    reasons: partial.reasons ?? ["r"],
    concerns: partial.concerns ?? [],
    imageNotes: partial.imageNotes ?? [],
    viewType: partial.viewType ?? "unknown",
    visualMagnetScore: partial.visualMagnetScore ?? 5,
    locationRelation: partial.locationRelation ?? "nearby",
    distanceBucket: partial.distanceBucket ?? "nearby",
    distanceMetersFromAnchor: partial.distanceMetersFromAnchor ?? null,
    backendDistanceBucket: partial.backendDistanceBucket ?? "core",
    selectionLane: partial.selectionLane,
    countsAgainstCoreMax: partial.countsAgainstCoreMax,
    curationWarnings: partial.curationWarnings
  };
}

const laneOpts = {
  maxCorePostsPerSpot: 5,
  maxContextPostsPerSpot: 3,
  maxTotalPostsPerSpot: 8,
  rejectPlaneViews: true,
  allowContextualFarRelevant: true,
  coreRadiusMeters: 1000,
  nearbyRadiusMeters: 3000,
  extendedContextRadiusMeters: 20_000
};

describe("enforceLaneSelectionAndDedupe", () => {
  it("hard-skips commercial plane metadata when rejectPlaneViews", () => {
    const map = new Map<string, WikiCuratorPromptCandidate>([
      [
        "p1",
        post({
          postId: "p1",
          title: "View from airplane window over coast",
          detectedViewHints: { planeLikely: true, droneLikely: false, helicopterLikely: false, matchedKeywords: ["plane_window_or_flight_phrase"] }
        })
      ]
    ]);
    const out = enforceLaneSelectionAndDedupe([dec({ postId: "p1", decision: "publish", viewType: "plane" })], map, laneOpts);
    expect(out[0]?.decision).toBe("skip");
  });

  it("allows drone when strong and within caps", () => {
    const map = new Map<string, WikiCuratorPromptCandidate>([
      ["p1", post({ postId: "p1", title: "Cliffs", distanceMetersFromAnchor: 400, backendDistanceBucket: "core" })]
    ]);
    const out = enforceLaneSelectionAndDedupe(
      [dec({ postId: "p1", decision: "publish", viewType: "drone", locationRelation: "exact" })],
      map,
      laneOpts
    );
    expect(out[0]?.decision).toBe("publish");
  });

  it("generic-title regression: high visual magnet contextual publish stays publish in context lane", () => {
    const map = new Map<string, WikiCuratorPromptCandidate>([
      [
        "p1",
        post({
          postId: "p1",
          title: "Ventura County, CA, USA",
          distanceMetersFromAnchor: 25_000,
          backendDistanceBucket: "extended_context",
          media: [
            { assetTitle: "Arch", imageUrl: "https://example.com/1.jpg", sourceUrl: "", width: 3000, height: 2000, orientation: "landscape", score: 22 },
            { assetTitle: "Arch2", imageUrl: "https://example.com/2.jpg", sourceUrl: "", width: 3000, height: 2000, orientation: "landscape", score: 21 }
          ]
        })
      ]
    ]);
    const out = enforceLaneSelectionAndDedupe(
      [
        dec({
          postId: "p1",
          decision: "publish",
          visualMagnetScore: 9,
          visualAppealScore: 9,
          visitWorthyScore: 8,
          locationRelation: "contextual_view",
          distanceMetersFromAnchor: 25_000,
          backendDistanceBucket: "extended_context"
        })
      ],
      map,
      laneOpts
    );
    expect(out[0]?.decision).toBe("publish");
    expect(out[0]?.selectionLane).toBe("context");
  });

  it("demotes publishes beyond maxTotalPostsPerSpot", () => {
    const rows: WikiSpotCuratorDecisionRow[] = [];
    const map = new Map<string, WikiCuratorPromptCandidate>();
    for (let i = 0; i < 10; i++) {
      const id = `p${i}`;
      map.set(
        id,
        post({
          postId: id,
          title: `T${i}`,
          media: [{ assetTitle: "", imageUrl: `https://example.com/${i}.jpg`, sourceUrl: "", width: 2000, height: 1500, orientation: "landscape", score: 20 }]
        })
      );
      rows.push(
        dec({
          postId: id,
          decision: "publish",
          finalRankForSpot: i + 1,
          visitWorthyScore: 9 - i * 0.1,
          visualMagnetScore: 8,
          locationRelation: "exact",
          backendDistanceBucket: "core",
          distanceMetersFromAnchor: 100
        })
      );
    }
    const out = enforceLaneSelectionAndDedupe(rows, map, { ...laneOpts, maxTotalPostsPerSpot: 3, maxCorePostsPerSpot: 3, maxContextPostsPerSpot: 1 });
    expect(out.filter((d) => d.decision === "publish")).toHaveLength(3);
  });
});

describe("buildCurationInspectionWarnings", () => {
  it("warns when high visual magnet is skipped", () => {
    const map = new Map<string, WikiCuratorPromptCandidate>([["p1", post({ postId: "p1" })]]);
    const w = buildCurationInspectionWarnings(
      [dec({ postId: "p1", decision: "skip", visualMagnetScore: 9, concerns: ["too similar"] })],
      map
    );
    expect(w.some((x) => x.message.includes("High visual magnet"))).toBe(true);
  });
});
