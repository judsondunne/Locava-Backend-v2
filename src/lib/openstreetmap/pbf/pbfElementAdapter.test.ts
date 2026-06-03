import { describe, expect, it } from "vitest";
import {
  adaptPbfEntityToOverpassElement,
  isPbfEntitySupportedForCopier,
  type PbfRawNode,
  type PbfRawRelation,
  type PbfRawWay,
} from "./pbfElementAdapter.js";

const metadata = {
  sourceProvider: "pbf_local" as const,
  pbfFilePath: "./test.osm.pbf",
  importerVersion: "pbf_copier_v1",
};

describe("pbfElementAdapter", () => {
  it("adapts a node into an Overpass element", () => {
    const node: PbfRawNode = {
      type: "node",
      id: 42,
      lat: 43.7,
      lon: -72.3,
      tags: { tourism: "viewpoint", name: "Lookout" },
    };
    const result = adaptPbfEntityToOverpassElement(node, metadata);
    expect(result).not.toBeNull();
    expect(result?.element.type).toBe("node");
    expect(result?.element.id).toBe(42);
    expect(result?.element.lat).toBe(43.7);
    expect(result?.element.lon).toBe(-72.3);
    expect(result?.element.tags?.tourism).toBe("viewpoint");
    expect(result?.sourceMetadata.osmType).toBe("node");
    expect(result?.sourceMetadata.osmId).toBe(42);
    expect(result?.sourceMetadata.pbfFilePath).toBe("./test.osm.pbf");
  });

  it("adapts a way with geometry", () => {
    const way: PbfRawWay = {
      type: "way",
      id: 7,
      tags: { highway: "path", name: "Mossy Trail" },
      geometry: [
        { lat: 43.7, lon: -72.3 },
        { lat: 43.71, lon: -72.31 },
      ],
    };
    const result = adaptPbfEntityToOverpassElement(way, metadata);
    expect(result).not.toBeNull();
    expect(result?.element.type).toBe("way");
    expect(result?.element.geometry?.length).toBe(2);
  });

  it("forwards relations (V1 keeps members; geometry reconstruction is a known limitation)", () => {
    const relation: PbfRawRelation = {
      type: "relation",
      id: 99,
      tags: { route: "hiking", name: "Long Trail" },
      members: [{ type: "way", ref: 7, role: "main" }],
    };
    const result = adaptPbfEntityToOverpassElement(relation, metadata);
    expect(result).not.toBeNull();
    expect(result?.element.type).toBe("relation");
    expect(result?.element.members?.[0]?.ref).toBe(7);
  });

  it("returns null for invalid ids", () => {
    const bad = adaptPbfEntityToOverpassElement(
      { type: "node", id: Number.NaN as never, lat: 1, lon: 1 },
      metadata
    );
    expect(bad).toBeNull();
  });

  it("nodes without coords are rejected", () => {
    const bad = adaptPbfEntityToOverpassElement(
      { type: "node", id: 1, lat: Number.NaN, lon: -72.3, tags: {} } as PbfRawNode,
      metadata
    );
    expect(bad).toBeNull();
  });

  it("isPbfEntitySupportedForCopier returns true for node/way/relation", () => {
    expect(isPbfEntitySupportedForCopier({ type: "node", id: 1, lat: 0, lon: 0 } as PbfRawNode)).toBe(true);
    expect(isPbfEntitySupportedForCopier({ type: "way", id: 1 } as PbfRawWay)).toBe(true);
    expect(isPbfEntitySupportedForCopier({ type: "relation", id: 1 } as PbfRawRelation)).toBe(true);
  });
});
