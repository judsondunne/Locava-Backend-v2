import { describe, expect, it } from "vitest";
import {
  buildDateProximitySegments,
  groupCommonsItemsByDate,
  type CommonsByDateItem,
} from "./fetchCommonsSearchGroupedByDate.js";

function item(partial: Partial<CommonsByDateItem> & Pick<CommonsByDateItem, "title" | "dateKey">): CommonsByDateItem {
  return {
    pageUrl: "https://commons.example/wiki/File:X.jpg",
    thumbUrl: null,
    fileUrl: null,
    mime: "image/jpeg",
    width: 1,
    height: 1,
    timestamp: null,
    lat: null,
    lon: null,
    ...partial,
  };
}

describe("groupCommonsItemsByDate", () => {
  it("sorts newest dates first and orders items by timestamp within a day", () => {
    const buckets = groupCommonsItemsByDate([
      item({ title: "A", dateKey: "2020-01-02", timestamp: "2020-01-02T01:00:00Z" }),
      item({ title: "B", dateKey: "2020-01-01", timestamp: "2020-01-01T12:00:00Z" }),
      item({ title: "C", dateKey: "2020-01-02", timestamp: "2020-01-02T18:00:00Z" }),
    ]);
    expect(buckets.map((b) => b.date)).toEqual(["2020-01-02", "2020-01-01"]);
    expect(buckets[0]!.items.map((i) => i.title)).toEqual(["C", "A"]);
  });

  it("places unknown last", () => {
    const buckets = groupCommonsItemsByDate([
      item({ title: "U", dateKey: "unknown" }),
      item({ title: "D", dateKey: "2021-06-01", timestamp: "2021-06-01T00:00:00Z" }),
    ]);
    expect(buckets.map((b) => b.date)).toEqual(["2021-06-01", "unknown"]);
  });
});

describe("buildDateProximitySegments", () => {
  it("merges same-day photos within ~½ mile and omits geoHint for a single cluster", () => {
    const segs = buildDateProximitySegments([
      item({
        title: "Near A",
        dateKey: "2020-06-01",
        lat: 38.0,
        lon: -85.0,
        timestamp: "2020-06-01T10:00:00Z",
      }),
      item({
        title: "Near B",
        dateKey: "2020-06-01",
        lat: 38.002,
        lon: -85.0,
        timestamp: "2020-06-01T09:00:00Z",
      }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.geoHint).toBeNull();
    expect(segs[0]!.items).toHaveLength(2);
  });

  it("splits same calendar day when GPS clusters are farther than ~½ mile", () => {
    const segs = buildDateProximitySegments([
      item({
        title: "Far A",
        dateKey: "2020-06-01",
        lat: 38.0,
        lon: -85.0,
        timestamp: "2020-06-01T12:00:00Z",
      }),
      item({
        title: "Far B",
        dateKey: "2020-06-01",
        lat: 38.012,
        lon: -85.0,
        timestamp: "2020-06-01T11:00:00Z",
      }),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.geoHint).toBeTruthy();
    expect(segs[1]!.geoHint).toBeTruthy();
    expect(segs.every((s) => s.items.length === 1)).toBe(true);
  });
});
