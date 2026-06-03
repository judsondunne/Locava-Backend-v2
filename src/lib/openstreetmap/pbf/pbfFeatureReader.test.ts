import { describe, expect, it } from "vitest";
import {
  buildPbfAdapterMetadata,
  createSyntheticPbfFeatureReader,
  probePbfParserAvailability,
  resetPbfParserAvailabilityCacheForTests,
} from "./pbfFeatureReader.js";

describe("pbfFeatureReader — synthetic reader", () => {
  it("opens, yields chunks, then closes", async () => {
    const reader = createSyntheticPbfFeatureReader({
      filePath: "./synthetic.osm.pbf",
      fileSizeBytes: 1024,
      entities: Array.from({ length: 5 }, (_, i) => ({
        type: "node" as const,
        id: i,
        lat: 43.7 + i * 0.001,
        lon: -72.3,
        tags: { amenity: "cafe", name: "Cafe " + i },
      })),
      chunkSize: 2,
    });

    const opened = await reader.open({ filePath: "./synthetic.osm.pbf" });
    expect(opened.parserId).toBe("synthetic-pbf-reader");
    expect(opened.fileSizeBytes).toBe(1024);

    const chunks = [];
    for await (const chunk of reader.read()) {
      chunks.push(chunk);
    }
    expect(chunks.flatMap((c) => c.entities)).toHaveLength(5);
    await reader.close();
  });

  it("buildPbfAdapterMetadata detects geofabrik file names", () => {
    const md = buildPbfAdapterMetadata({ filePath: "/data/us-latest.osm.pbf" });
    expect(md.sourceProvider).toBe("geofabrik_pbf");
    expect(md.importerVersion).toBe("pbf_copier_v1");
  });

  it("resolves way geometry from node refs in stream order", async () => {
    const reader = createSyntheticPbfFeatureReader({
      entities: [
        { type: "node", id: 10, lat: 43.7, lon: -72.3, tags: {} },
        { type: "node", id: 11, lat: 43.71, lon: -72.31, tags: {} },
        {
          type: "way",
          id: 20,
          refs: [10, 11],
          tags: { highway: "path", name: "Ref-only Trail" },
        },
      ],
      chunkSize: 10,
    });

    const entities = [];
    for await (const chunk of reader.read()) {
      entities.push(...chunk.entities);
    }
    const way = entities.find((e) => e.type === "way");
    expect(way?.type).toBe("way");
    if (way?.type === "way") {
      expect(way.geometry).toHaveLength(2);
    }
  });

  it("buildPbfAdapterMetadata defaults to pbf_local for local files", () => {
    const md = buildPbfAdapterMetadata({ filePath: "/data/foo.osm.pbf" });
    expect(md.sourceProvider).toBe("pbf_local");
  });
});

describe("pbfFeatureReader — parser availability", () => {
  it("reports availability deterministically (cached)", async () => {
    resetPbfParserAvailabilityCacheForTests();
    const first = await probePbfParserAvailability();
    const second = await probePbfParserAvailability();
    expect(first.parserId).toBe("osm-pbf-parser-node");
    expect(typeof first.parserAvailable).toBe("boolean");
    expect(first).toEqual(second);
  });
});
