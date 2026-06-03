import { describe, expect, it, vi } from "vitest";
import { buildUnexploredTilesFromDocs } from "./osmNationalTileWriter.service.js";
import type { UnexploredSpot } from "../../../contracts/entities/osm-national-entities.contract.js";

describe("osmNationalTileWriter", () => {
  it("publicOnly tiles include only publicMapEligible", () => {
    const spots: UnexploredSpot[] = [
      {
        id: "s1",
        kind: "unexplored_spot",
        origin: "generated_osm",
        sourceFamily: "openstreetmap",
        sourceIds: ["1"],
        sourceKeys: ["node/1"],
        sourceAttribution: {},
        sourceDatasets: [],
        displayName: "Public Spot",
        category: "viewpoint",
        categories: ["viewpoint"],
        activities: ["hiking"],
        lat: 43.7,
        lng: -72.3,
        publicMapEligible: true,
        undiscovered: true,
        needsCapture: true,
        hasUserMedia: false,
        confidence: "high",
        locavaScore: 80,
        displayPriority: "high",
        showAtZoom: 12,
        sourceTags: {},
        rawProperties: {},
        classification: { algorithmVersion: "v1", reason: "ok", tagSignals: [], negativeSignals: [], warnings: [] },
        import: {
          runId: "r",
          stateCode: "VT",
          chunkId: "c",
          importedAt: new Date().toISOString(),
          pipelineVersion: "v1",
          writeMode: false,
          writeTarget: "none",
        },
        audit: {
          createdBy: "national_osm_importer",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          contentHash: "abc",
        },
        stateCode: "VT",
        mapReadiness: "ready",
      },
      {
        ...({} as UnexploredSpot),
        id: "s2",
        displayName: "Hidden Spot",
        publicMapEligible: false,
        lat: 43.71,
        lng: -72.31,
        mapReadiness: "hidden",
      } as UnexploredSpot,
    ];

    const tiles = buildUnexploredTilesFromDocs({
      runId: "run1",
      spots,
      routes: [],
      regionBbox: { minLat: 43.6, minLng: -72.4, maxLat: 43.8, maxLng: -72.2 },
      publicOnly: true,
      includeReviewItems: false,
      minZoom: 10,
      maxZoom: 10,
    });

    const allItems = tiles.flatMap((t) => t.items);
    expect(allItems.some((i) => i.displayName === "Public Spot")).toBe(true);
    expect(allItems.some((i) => i.displayName === "Hidden Spot")).toBe(false);
  });

  it("tile docs are compact", () => {
    const tiles = buildUnexploredTilesFromDocs({
      runId: "run1",
      spots: [],
      routes: [],
      regionBbox: { minLat: 43.6, minLng: -72.4, maxLat: 43.8, maxLng: -72.2 },
      publicOnly: false,
      includeReviewItems: true,
      minZoom: 10,
      maxZoom: 10,
    });
    for (const tile of tiles) {
      expect(tile.items.length).toBeLessThanOrEqual(200);
      expect(JSON.stringify(tile).length).toBeLessThan(500_000);
    }
  });
});

import { writeUnexploredChunkDocs } from "./osmNationalWriter.service.js";
import type { OsmNationalRun } from "../../../contracts/entities/osm-national-entities.contract.js";
import { emptyOsmNationalCounts } from "../../../contracts/entities/osm-national-entities.contract.js";
import * as spotsAdapter from "../../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js";

describe("osmNationalWriter", () => {
  it("dryRun writes no unexplored docs", async () => {
    const spy = vi.spyOn(spotsAdapter, "bulkWriteUnexploredSpots");
    const run = {
      runId: "r1",
      writeMode: false,
      writeTarget: "none",
      config: { dryRunOnly: true, maxWritesPerSecond: 0 },
    } as OsmNationalRun;
    const result = await writeUnexploredChunkDocs({ run, spots: [], routes: [] });
    expect(result.skippedBecauseDryRun).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
