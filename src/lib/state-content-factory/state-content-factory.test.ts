import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import { PUBLIC_PUBLISH_NOT_IMPLEMENTED, assertNoPublicPublish } from "./assertNoPublicPublish.js";
import { evaluateGeneratedPostQuality } from "./evaluateGeneratedPostQuality.js";
import { selectPlaceCandidates } from "./selectPlaceCandidates.js";
import {
  budgetExceededReason,
  createStateContentFactoryBudget,
  firestoreReadBudgetWarning,
} from "./stateContentFactoryBudget.js";
import { clearStateContentFactoryRuns } from "./stateContentFactoryRunStore.js";
import type { PlaceCandidate } from "../place-candidates/types.js";
import type { WikimediaGeneratedPost } from "../wikimediaMvp/WikimediaMvpTypes.js";

vi.mock("../place-candidates/generateStatePlaceCandidates.js", () => ({
  generateStatePlaceCandidates: vi.fn(),
}));
vi.mock("../wikimediaMvp/WikimediaMvpRunner.js", () => ({
  runWikimediaMvpPlace: vi.fn(),
}));

import { generateStatePlaceCandidates } from "../place-candidates/generateStatePlaceCandidates.js";
import { runWikimediaMvpPlace } from "../wikimediaMvp/WikimediaMvpRunner.js";
import { startStateContentFactoryRun } from "./stateContentFactoryDevRunner.js";
import { getStateContentFactoryRun } from "./stateContentFactoryRunStore.js";

function candidate(partial: Partial<PlaceCandidate> & Pick<PlaceCandidate, "placeCandidateId" | "name">): PlaceCandidate {
  return {
    state: "Vermont",
    stateCode: "VT",
    country: "US",
    lat: 44.0,
    lng: -72.7,
    categories: ["park"],
    candidateTier: "A",
    sourceIds: {},
    sourceUrls: {},
    rawSources: ["wikidata"],
    sourceConfidence: 1,
    locavaScore: 80,
    locavaPriorityScore: 70,
    eligibleForMediaPipeline: true,
    blocked: false,
    priorityQueue: "P0",
    signals: {
      hasCoordinates: true,
      hasWikipedia: false,
      hasWikidata: true,
      hasCommonsCategory: false,
      hasUsefulCategory: true,
      isOutdoorLikely: true,
      isLandmarkLikely: true,
      isTourismLikely: true,
      isTooGeneric: false,
    },
    debug: {
      matchedSourceCategories: [],
      normalizedFrom: [],
      scoreReasons: [],
      tierReasons: [],
      dedupeKey: partial.placeCandidateId,
    },
    ...partial,
  };
}

function generatedPost(partial: Partial<WikimediaGeneratedPost> = {}): WikimediaGeneratedPost {
  return {
    postId: "post_1",
    groupId: "group_1",
    placeName: "Test Place",
    generatedTitle: "Title",
    titleReasoning: [],
    titleConfidence: "high",
    activities: [],
    activityReasoning: [],
    status: "KEEP",
    rejectionReasons: [],
    reasoning: [],
    groupMethod: "exactDate",
    assetCount: 1,
    locatedAssetCount: 1,
    selectedLocation: { candidateId: "c1", latitude: 44.0, longitude: -72.7, reasoning: "asset_geotag" },
    groupedCandidateIds: ["c1"],
    media: [
      {
        candidateId: "c1",
        sourceTitle: "File:Test.jpg",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Test.jpg",
        thumbnailUrl: null,
        fullImageUrl: "https://upload.wikimedia.org/test.jpg",
        author: "Author",
        license: "CC",
        credit: "Credit",
        suppliesPostLocation: true,
        hasRealAssetLocation: true,
        assetLatitude: 44.0,
        assetLongitude: -72.7,
        hasAssetCoordinates: true,
        assetDistanceMilesFromPlace: 0.5,
        mediaPlaceMatchScore: 70,
        mediaPlaceMismatchReasons: [],
        sourceConfidenceRank: 1,
      },
    ],
    dryRunPostPreview: { title: "Title", caption: "Caption", lat: 44.0, lng: -72.7 },
    candidateReasoning: [],
    ...partial,
  };
}

describe("state content factory helpers", () => {
  it("selects eligible candidates by queue priority and caps count", () => {
    const selected = selectPlaceCandidates({
      candidates: [
        candidate({ placeCandidateId: "p2", name: "P2", priorityQueue: "P2", locavaPriorityScore: 99 }),
        candidate({ placeCandidateId: "p0", name: "P0", priorityQueue: "P0", locavaPriorityScore: 10 }),
        candidate({ placeCandidateId: "blocked", name: "Blocked", blocked: true }),
      ],
      priorityQueues: ["P0", "P1", "P2", "P3"],
      maxPlacesToProcess: 2,
    });
    expect(selected.map((row) => row.placeCandidateId)).toEqual(["p0", "p2"]);
  });

  it("rejects previews without media or attribution", () => {
    const rejected = evaluateGeneratedPostQuality({
      candidate: candidate({ placeCandidateId: "a", name: "A" }),
      generatedPost: generatedPost({ media: [], assetCount: 0 }),
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.reasons).toContain("missing_media");
    expect(rejected.ruleFailures).toContain("missing_media");
  });

  it("marks valid previews stageable with attribution", () => {
    const stageable = evaluateGeneratedPostQuality({
      candidate: candidate({ placeCandidateId: "a", name: "A" }),
      generatedPost: generatedPost(),
    });
    expect(stageable.status).toBe("stageable");
    expect(stageable.duplicateHash).toMatch(/^[a-f0-9]{40}$/);
    expect(stageable.ruleFailures.length).toBe(0);
  });

  it("throws on public publish attempts", () => {
    expect(() => assertNoPublicPublish()).toThrow(PUBLIC_PUBLISH_NOT_IMPLEMENTED);
  });

  it("enforces dry-run write budget caps", () => {
    const budget = createStateContentFactoryBudget({ runMode: "dry_run", maxPlacesToProcess: 3 });
    budget.firestoreReads = 26;
    expect(budgetExceededReason(budget, 0)).toBe("READ_BUDGET_EXCEEDED");
  });

  it("does not warn on firestore reads when usage is zero", () => {
    const budget = createStateContentFactoryBudget({ runMode: "dry_run", maxPlacesToProcess: 3 });
    expect(firestoreReadBudgetWarning(budget).shouldWarn).toBe(false);
  });
});

describe("state content factory orchestrator", () => {
  beforeEach(() => {
    clearStateContentFactoryRuns();
    vi.clearAllMocks();
  });

  it("dry_run increments wouldWrite and never stages posts", async () => {
    vi.mocked(generateStatePlaceCandidates).mockResolvedValue({
      ok: true,
      dryRun: true,
      mode: "fast_targeted",
      sourceMode: "fast_targeted",
      partial: false,
      timeout: false,
      stateName: "Vermont",
      stateCode: "VT",
      sourcesUsed: ["wikidata"],
      candidates: [candidate({ placeCandidateId: "p0", name: "Place A" })],
      topCandidatesForMediaPipeline: [],
      rejected: [],
      totals: {
        rawCandidates: 1,
        normalizedCandidates: 1,
        dedupedCandidates: 1,
        rejectedCandidates: 0,
        returnedCandidates: 1,
      },
      eligibleCandidates: [candidate({ placeCandidateId: "p0", name: "Place A" })],
      blockedCandidates: [],
      events: [],
      elapsedMs: 10,
    } as never);
    const post = generatedPost();
    vi.mocked(runWikimediaMvpPlace).mockResolvedValue({
      runId: "wm_1",
      placeResult: {
        placeName: "Place A",
        normalizedPlaceName: "place a",
        wikimediaQueryTerms: ["Place A, Vermont, VT"],
        candidateCount: 1,
        keptCount: 1,
        rejectedCount: 0,
        reviewCount: 0,
        totalRuntimeMs: 10,
        budget: { wikimediaRequests: 2 },
        errors: [],
        warnings: [],
        candidateAnalysis: [],
        generatedPosts: [post],
        assetGroups: [
          {
            groupId: post.groupId,
            placeName: "Place A",
            groupKey: "k",
            groupMethod: "exactDate",
            hasLocatedAsset: true,
            locatedAssetCount: 1,
            assetCount: 1,
            assets: [],
            representativeAssetId: "c1",
            generatedTitle: "Title",
            activities: [],
            status: "KEEP",
            rejectionReasons: [],
            reasoning: [],
          },
        ],
        summary: {
          candidateCount: 1,
          assetGroupsCount: 1,
          generatedPostsCount: 1,
          keptGeneratedPostsCount: 1,
          reviewGeneratedPostsCount: 0,
          rejectedGeneratedPostsCount: 0,
          rejectedNoLocationGroupCount: 0,
          multiAssetPostCount: 0,
          singleAssetPostCount: 1,
          budget: { wikimediaRequests: 2 },
        },
        candidates: [],
      },
      summary: {
        candidateCount: 1,
        assetGroupsCount: 1,
        generatedPostsCount: 1,
        keptGeneratedPostsCount: 1,
        reviewGeneratedPostsCount: 0,
        rejectedGeneratedPostsCount: 0,
        rejectedNoLocationGroupCount: 0,
        multiAssetPostCount: 0,
        singleAssetPostCount: 1,
        budget: { wikimediaRequests: 2 },
      },
    } as never);

    const run = startStateContentFactoryRun({
      env: { NODE_ENV: "test" } as never,
      config: {
        runKind: "full",
        stateName: "Vermont",
        stateCode: "VT",
        runMode: "dry_run",
        placeSource: "wikidata",
        placeDiscoveryMode: "fast_targeted",
        candidateLimit: 10,
        priorityQueues: ["P0", "P1"],
        maxPlacesToProcess: 1,
        includeMediaSignals: true,
        qualityThreshold: "normal",
        qualityPreviewMode: "preview_all",
        maxPostPreviewsPerPlace: 1,
        maxAssetsPerPostPreview: 8,
        groupTimeWindowMinutes: 180,
        totalTimeoutMs: 30_000,
        perPlaceTimeoutMs: 10_000,
        wikimediaFetchAllExhaustive: false,
        allowStagingWrites: false,
        allowPublicPublish: false,
      },
    });
    await vi.waitFor(() => {
      const current = getStateContentFactoryRun(run.runId);
      expect(current?.status).toBe("completed");
    });
    const finished = getStateContentFactoryRun(run.runId);
    expect(finished?.result?.dryRun).toBe(true);
    expect(finished?.result?.wikimediaFetchAllExhaustive).toBe(false);
    expect(finished?.result?.publicPostsWritten).toBe(0);
    expect(finished?.result?.actualWrites.stagedGeneratedPosts).toBe(0);
    expect(finished?.result?.wouldWrite.stagedGeneratedPosts).toBeGreaterThan(0);
  });
});

describe("state content factory routes", () => {
  it("returns 404 when dev page disabled", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({ method: "GET", url: "/dev/state-content-factory" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 when dev page enabled", async () => {
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_STATE_CONTENT_FACTORY_DEV_PAGE: "true",
    });
    const res = await app.inject({ method: "GET", url: "/dev/state-content-factory" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});
