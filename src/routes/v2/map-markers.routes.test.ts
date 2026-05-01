import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalCache } from "../../cache/global-cache.js";

const fetchAllMock = vi.fn();
const fetchByOwnerMock = vi.fn();

vi.mock("../../repositories/source-of-truth/map-markers-firestore.adapter.js", () => {
  return {
    MapMarkersFirestoreAdapter: class {
      fetchAll = fetchAllMock;
      fetchByOwner = fetchByOwnerMock;
    }
  };
});

describe("v2 map markers route", () => {
  beforeEach(async () => {
    fetchAllMock.mockReset();
    fetchByOwnerMock.mockReset();
    await globalCache.del("map:markers:v1");
    await globalCache.del("map:markers:v2");
    await globalCache.del("map:markers:v2:all");
    await globalCache.del("map:markers:v2:all:payload:compact");
    await globalCache.del("map:markers:v2:all:payload:full");
    await globalCache.del("map:markers:v2:240");
    await globalCache.del("map:markers:v2:60");
    await globalCache.del("map:markers:v2:owner:public:u1");
    await globalCache.del("map:markers:v2:owner:public:u1:payload:compact");
    await globalCache.del("map:markers:v2:owner:self:u1");
    await globalCache.del("map:markers:v2:owner:self:u1:payload:compact");
  });

  it("defaults to the full marker universe cache key when no limit is provided", async () => {
    fetchAllMock.mockResolvedValue({
      markers: [],
      count: 0,
      generatedAt: 123,
      version: "map-markers-v2",
      etag: "\"all\"",
      queryCount: 1,
      readCount: 0,
      invalidCoordinateDrops: 0
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/markers",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    expect(response.statusCode).toBe(200);
    expect(fetchAllMock).toHaveBeenCalledWith({ maxDocs: 5000 });
  }, 15_000);

  it("uses ownerId filter to fetch markers server-side", async () => {
    fetchByOwnerMock.mockResolvedValue({
      markers: [],
      count: 0,
      generatedAt: 123,
      version: "map-markers-v2-owner",
      etag: "\"owner\"",
      queryCount: 1,
      readCount: 0,
      invalidCoordinateDrops: 0
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/markers?ownerId=u1&limit=60",
      headers: { "x-viewer-id": "someone-else", "x-viewer-roles": "internal" }
    });
    expect(response.statusCode).toBe(200);
    expect(fetchByOwnerMock).toHaveBeenCalledWith({ ownerId: "u1", maxDocs: 60, includeNonPublic: false });
  });

  it("includes non-public markers when requesting own ownerId", async () => {
    fetchByOwnerMock.mockResolvedValue({
      markers: [],
      count: 0,
      generatedAt: 123,
      version: "map-markers-v2-owner",
      etag: "\"self\"",
      queryCount: 1,
      readCount: 0,
      invalidCoordinateDrops: 0
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/markers?ownerId=u1&limit=60",
      headers: { "x-viewer-id": "u1", "x-viewer-roles": "internal" }
    });
    expect(response.statusCode).toBe(200);
    expect(fetchByOwnerMock).toHaveBeenCalledWith({ ownerId: "u1", maxDocs: 60, includeNonPublic: true });
  });

  it("returns marker records from source docs", async () => {
    fetchAllMock.mockResolvedValue({
      markers: [
        {
          id: "p1",
          postId: "p1",
          lat: 40.7,
          lng: -74.0,
          activity: "hike",
          activities: ["hike"],
          createdAt: 100,
          visibility: "public",
          ownerId: "u1",
          thumbnailUrl: "https://cdn/p1.jpg",
          hasPhoto: true,
          hasVideo: false
        }
      ],
      count: 1,
      generatedAt: 123,
      version: "map-markers-v1",
      etag: "\"abc\"",
      queryCount: 1,
      readCount: 1,
      invalidCoordinateDrops: 2
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/markers",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.routeName).toBe("map.markers.get");
    expect(data.count).toBe(1);
    expect(data.markers[0].lat).toBe(40.7);
    expect(data.markers[0].activity).toBe("hike");
    expect(data.markers[0].activities).toEqual(["hike"]);
    expect(data.markers[0].ownerId).toBeUndefined();
    expect(data.markers[0].thumbnailUrl).toBe("https://cdn/p1.jpg");
    expect(data.markers[0].openPayload).toBeUndefined();
    expect(data.markers[0].description).toBeUndefined();
    expect(data.markers[0].comments).toBeUndefined();
    expect(data.diagnostics.payloadMode).toBe("compact");
    expect(data.diagnostics.invalidCoordinateDrops).toBe(2);
    expect(response.headers.etag).toBe("\"abc\"");
  });

  it("supports explicit full payload mode", async () => {
    fetchAllMock.mockResolvedValue({
      markers: [
        {
          id: "p1",
          postId: "p1",
          lat: 40.7,
          lng: -74.0,
          activity: "hike",
          activities: ["hike"],
          ownerId: "u1",
          thumbnailUrl: "https://cdn/p1.jpg",
          hasPhoto: true,
          hasVideo: false
        }
      ],
      count: 1,
      generatedAt: 123,
      version: "map-markers-v1",
      etag: "\"abc2\"",
      queryCount: 1,
      readCount: 1,
      invalidCoordinateDrops: 0
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/markers?payloadMode=full",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.markers[0].thumbnailUrl).toBe("https://cdn/p1.jpg");
    expect(data.markers[0].openPayload?.postId).toBe("p1");
    expect(data.diagnostics.payloadMode).toBe("full");
  });

  it("keeps compact marker payloads under budget for large marker sets", async () => {
    fetchAllMock.mockResolvedValue({
      markers: Array.from({ length: 1602 }, (_, index) => ({
        id: `p${index + 1}`,
        postId: `p${index + 1}`,
        lat: 40.7 + index * 0.0001,
        lng: -74 + index * 0.0001,
        activity: index % 2 === 0 ? "hike" : "waterfall",
        activities: ["hike", "waterfall"],
        title: `Marker ${index + 1}`,
        createdAt: 1_700_000_000_000 + index,
        visibility: "public",
        ownerId: `u${(index % 40) + 1}`,
        thumbnailUrl: `https://cdn/p${index + 1}.jpg`,
        hasPhoto: true,
        hasVideo: index % 5 === 0,
      })),
      count: 1602,
      generatedAt: 123,
      version: "map-markers-v2",
      etag: "\"big\"",
      queryCount: 1,
      readCount: 0,
      invalidCoordinateDrops: 0,
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/markers?payloadMode=compact",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.body, "utf8")).toBeLessThan(500_000);
    const data = response.json().data;
    expect(data.markers[0].openPayload).toBeUndefined();
  });

  it("returns 304 when etag matches", async () => {
    fetchAllMock.mockResolvedValue({
      markers: [],
      count: 0,
      generatedAt: 123,
      version: "map-markers-v1",
      etag: "\"same\"",
      queryCount: 1,
      readCount: 0,
      invalidCoordinateDrops: 0
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    await app.inject({
      method: "GET",
      url: "/v2/map/markers",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    const second = await app.inject({
      method: "GET",
      url: "/v2/map/markers",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal",
        "if-none-match": "\"same\""
      }
    });
    expect(second.statusCode).toBe(304);
  });

  it("uses cache-hit path without extra db reads", async () => {
    fetchAllMock.mockResolvedValue({
      markers: [],
      count: 0,
      generatedAt: 123,
      version: "map-markers-v1",
      etag: "\"cached\"",
      queryCount: 1,
      readCount: 10,
      invalidCoordinateDrops: 0
    });
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    await app.inject({
      method: "GET",
      url: "/v2/map/markers",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    const warm = await app.inject({
      method: "GET",
      url: "/v2/map/markers",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    expect(warm.statusCode).toBe(200);
    expect(warm.json().meta.db.reads).toBe(0);
    expect(warm.json().meta.db.queries).toBe(0);
  });

  it("returns non-200 when firestore fails", async () => {
    fetchAllMock.mockRejectedValue(new Error("firestore_timeout"));
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/map/markers",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" }
    });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error.details.routeName).toBe("map.markers.get");
  });
});
