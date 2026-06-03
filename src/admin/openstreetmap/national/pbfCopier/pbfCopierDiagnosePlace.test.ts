import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PbfRawEntity } from "../../../../lib/openstreetmap/pbf/pbfElementAdapter.js";
import { buildSyntheticReaderFactory } from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import { diagnosePlaceInPbf } from "./pbfCopierDiagnosePlace.js";

const tmpRoot = path.join(os.tmpdir(), "locava-pbf-diagnose-tests");

async function makeFakePbfFile(name: string): Promise<string> {
  await fs.mkdir(tmpRoot, { recursive: true });
  const fullPath = path.join(tmpRoot, name);
  await fs.writeFile(fullPath, Buffer.alloc(512));
  return fullPath;
}

describe("diagnosePlaceInPbf", () => {
  it("returns exact classifier reason for Cedar Beach hamlet vs beach way fixture", async () => {
    const file = await makeFakePbfFile("cedar-beach-fixture.osm.pbf");
    const entities: PbfRawEntity[] = [
      {
        type: "node",
        id: 1001,
        lat: 44.0,
        lon: -73.2,
        tags: { name: "Cedar Beach", place: "hamlet" },
      },
      {
        type: "way",
        id: 2002,
        tags: { name: "Cedar Beach", natural: "beach" },
        geometry: [
          { lat: 44.01, lon: -73.21 },
          { lat: 44.011, lon: -73.209 },
          { lat: 44.012, lon: -73.208 },
        ],
      },
    ];

    const result = await diagnosePlaceInPbf({
      filePath: file,
      searchText: "Cedar Beach",
      hooks: { readerFactory: buildSyntheticReaderFactory({ entities, chunkSize: 1 }) },
      includePublicOnly: true,
      includeReviewDocs: false,
    });

    expect(result.matches.length).toBe(2);
    const hamlet = result.matches.find((m) => m.osmType === "node");
    const beachWay = result.matches.find((m) => m.osmType === "way");
    expect(hamlet).toBeTruthy();
    expect(hamlet?.nameOnlyPlaceWithBeachInName).toBe(true);
    expect(hamlet?.diagnosticNote).toMatch(/populated[- ]place/i);
    expect(hamlet?.rejectionReason === "missing_category" || hamlet?.classifierDecision === "reject").toBe(true);

    expect(beachWay).toBeTruthy();
    expect(beachWay?.passedTagFilter).toBe(true);
    expect(beachWay?.classifierDecision).toBe("spot");
    expect(beachWay?.primaryCategory).toBeTruthy();
    expect(beachWay?.activities.length).toBeGreaterThan(0);
    expect(beachWay?.wouldBuildSpot || beachWay?.wouldBuildRoute).toBe(true);
  });

  it("scans through nodes into ways when no raw cap is set", async () => {
    const file = await makeFakePbfFile("nodes-then-ways.osm.pbf");
    const junkNodes: PbfRawEntity[] = Array.from({ length: 120 }, (_, i) => ({
      type: "node" as const,
      id: i + 1,
      lat: 43.7,
      lon: -72.3,
      tags: { note: `junk-${i}` },
    }));
    const ways: PbfRawEntity[] = [
      {
        type: "way",
        id: 9001,
        tags: { name: "Hidden Falls", natural: "waterfall" },
        geometry: [
          { lat: 43.71, lon: -72.31 },
          { lat: 43.711, lon: -72.309 },
        ],
      },
    ];

    const result = await diagnosePlaceInPbf({
      filePath: file,
      searchText: "Hidden Falls",
      maxRawObjectsToScan: null,
      hooks: {
        readerFactory: buildSyntheticReaderFactory({
          entities: [...junkNodes, ...ways],
          chunkSize: 25,
        }),
      },
    });

    expect(result.nodesScanned).toBeGreaterThan(100);
    expect(result.waysScanned).toBeGreaterThan(0);
    expect(result.fileEnded).toBe(true);
    expect(result.rawScanLimitReached).toBe(false);
  });
});
