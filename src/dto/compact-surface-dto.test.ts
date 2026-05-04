import { describe, expect, it } from "vitest";
import {
  listForbiddenCompactFieldViolations,
  toFeedCardDTO,
  toMapMarkerCompactDTO,
  toPlaybackPostShellDTO,
  toProfileHeaderDTO,
  toSearchMixPreviewDTO,
} from "./compact-surface-dto.js";

function buildFeedCard() {
  return toFeedCardDTO({
    postId: "post-1",
    rankToken: "rank-1",
    author: {
      userId: "user-1",
      handle: "@user.one",
      name: "User One",
      pic: "https://cdn.locava.test/u1.jpg",
    },
    title: "A very long waterfall title that should still stay compact and readable for cards",
    captionPreview:
      "A caption preview that is intentionally verbose so the mapper has to clamp it and keep the feed card tiny.",
    activities: ["waterfall", "hiking", "camping", "travel", "extra"],
    address: "Skamania County, Washington",
    geo: {
      lat: 45.7261286,
      long: -121.6335058,
      city: "Skamania County",
      state: "Washington",
      country: "United States",
      geohash: "c21s0hjnj",
    },
    assets: [
      {
        id: "asset-1",
        type: "video",
        previewUrl: "https://cdn.locava.test/post-1/preview.jpg",
        posterUrl: "https://cdn.locava.test/post-1/poster.jpg",
        originalUrl: "https://cdn.locava.test/post-1/original.mp4",
        streamUrl: "https://cdn.locava.test/post-1/master.m3u8",
        mp4Url: "https://cdn.locava.test/post-1/main720.mp4",
        blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        width: 720,
        height: 1280,
        aspectRatio: 9 / 16,
        orientation: "portrait",
      },
      {
        id: "asset-2",
        type: "video",
        previewUrl: "https://cdn.locava.test/post-1/preview-2.jpg",
      },
    ],
    media: {
      type: "video",
      posterUrl: "https://cdn.locava.test/post-1/poster.jpg",
      aspectRatio: 9 / 16,
      startupHint: "poster_then_preview",
    },
    social: { likeCount: 12, commentCount: 3 },
    viewer: { liked: false, saved: false },
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_001_000,
    assetsReady: true,
  } as never);
}

describe("compact surface dto mappers", () => {
  it("maps feed cards with an explicit whitelist and stable snapshot", () => {
    const dto = buildFeedCard();

    expect(dto).toMatchInlineSnapshot(`
      {
        "activities": [
          "waterfall",
          "hiking",
          "camping",
          "travel",
        ],
        "address": "Skamania County, Washington",
        "assets": [
          {
            "aspectRatio": 0.5625,
            "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
            "height": 1280,
            "id": "asset-1",
            "mp4Url": "https://cdn.locava.test/post-1/main720.mp4",
            "orientation": "portrait",
            "originalUrl": "https://cdn.locava.test/post-1/original.mp4",
            "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
            "previewUrl": "https://cdn.locava.test/post-1/preview.jpg",
            "streamUrl": "https://cdn.locava.test/post-1/master.m3u8",
            "type": "video",
            "width": 720,
          },
          {
            "aspectRatio": null,
            "blurhash": null,
            "height": null,
            "id": "asset-2",
            "mp4Url": null,
            "orientation": null,
            "originalUrl": null,
            "posterUrl": null,
            "previewUrl": "https://cdn.locava.test/post-1/preview-2.jpg",
            "streamUrl": null,
            "type": "video",
            "width": null,
          },
        ],
        "assetsReady": true,
        "author": {
          "avatarUrl": "https://cdn.locava.test/u1.jpg",
          "displayName": "User One",
          "handle": "user.one",
          "name": "User One",
          "pic": "https://cdn.locava.test/u1.jpg",
          "userId": "user-1",
        },
        "captionPreview": "A caption preview that is intentionally verbose so the mapper has to clamp it and keep the feed card tiny.",
        "createdAtMs": 1700000000000,
        "derivedAssetCount": 2,
        "firstAssetUrl": "https://cdn.locava.test/post-1/original.mp4",
        "geo": {
          "city": "Skamania County",
          "country": "United States",
          "geohash": "c21s0hjnj",
          "lat": 45.7261286,
          "long": -121.6335058,
          "state": "Washington",
        },
        "media": {
          "aspectRatio": 0.5625,
          "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
          "startupHint": "poster_then_preview",
          "type": "video",
        },
        "postId": "post-1",
        "rankToken": "rank-1",
        "social": {
          "commentCount": 3,
          "likeCount": 12,
        },
        "title": "A very long waterfall title that should still stay compact and readable for car…",
        "updatedAtMs": 1700000001000,
        "viewer": {
          "liked": false,
          "saved": false,
        },
      }
    `);
    expect(listForbiddenCompactFieldViolations(dto)).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(dto), "utf8")).toBeLessThan(6_000);
  });

  it("maps search previews without leaking full post or user docs", () => {
    const dto = toSearchMixPreviewDTO({
      ...buildFeedCard(),
      locationSummary: "Skamania County, Washington",
    } as never);

    expect(dto.locationSummary).toBe("Skamania County, Washington");
    expect(listForbiddenCompactFieldViolations(dto)).toEqual([]);
  });

  it("maps every compact card asset into the playback shell when compactAssetLimit > 1", () => {
    const card = toFeedCardDTO({
      postId: "multi-img",
      rankToken: "r1",
      author: { userId: "u1", handle: "a", name: null, pic: null },
      title: "Three bridges",
      captionPreview: "caption",
      activities: ["view"],
      assets: [
        {
          id: "image_a_0",
          type: "image",
          previewUrl: "https://cdn.test/a_md.webp",
          posterUrl: null,
          originalUrl: "https://cdn.test/a.jpg",
          aspectRatio: 4 / 3,
        },
        {
          id: "image_a_1",
          type: "image",
          previewUrl: "https://cdn.test/b_md.webp",
          posterUrl: null,
          originalUrl: "https://cdn.test/b.jpg",
          aspectRatio: 4 / 3,
        },
        {
          id: "image_a_2",
          type: "image",
          previewUrl: "https://cdn.test/c_md.webp",
          posterUrl: null,
          originalUrl: "https://cdn.test/c.jpg",
          aspectRatio: 4 / 3,
        },
      ],
      compactAssetLimit: 12,
      media: {
        type: "image",
        posterUrl: "https://cdn.test/a_md.webp",
        aspectRatio: 4 / 3,
        startupHint: "poster_only",
      },
      createdAtMs: 1,
      updatedAtMs: 2,
    } as never);

    const shell = toPlaybackPostShellDTO({ userId: "u1", card });
    expect(shell.assets).toHaveLength(3);
    expect(shell.assets.map((a) => a.id)).toEqual(["image_a_0", "image_a_1", "image_a_2"]);
    expect(shell.assets.map((a) => a.original)).toEqual([
      "https://cdn.test/a.jpg",
      "https://cdn.test/b.jpg",
      "https://cdn.test/c.jpg",
    ]);
  });

  it("maps playback shells to a minimal render/playback contract", () => {
    const shell = toPlaybackPostShellDTO({
      userId: "user-1",
      card: buildFeedCard(),
    });

    expect(shell).toMatchInlineSnapshot(`
      {
        "activities": [
          "waterfall",
          "hiking",
          "camping",
          "travel",
        ],
        "address": "Skamania County, Washington",
        "assets": [
          {
            "aspectRatio": 0.5625,
            "height": 1280,
            "id": "asset-1",
            "orientation": "portrait",
            "original": "https://cdn.locava.test/post-1/main720.mp4",
            "poster": "https://cdn.locava.test/post-1/poster.jpg",
            "thumbnail": "https://cdn.locava.test/post-1/poster.jpg",
            "type": "video",
            "variants": {
              "hls": "https://cdn.locava.test/post-1/master.m3u8",
              "main720": "https://cdn.locava.test/post-1/main720.mp4",
              "main720Avc": "https://cdn.locava.test/post-1/main720.mp4",
              "preview360": "https://cdn.locava.test/post-1/preview.jpg",
              "preview360Avc": "https://cdn.locava.test/post-1/preview.jpg",
            },
            "width": 720,
          },
          {
            "aspectRatio": undefined,
            "height": undefined,
            "id": "asset-2",
            "orientation": undefined,
            "original": "https://cdn.locava.test/post-1/preview-2.jpg",
            "poster": "https://cdn.locava.test/post-1/poster.jpg",
            "thumbnail": "https://cdn.locava.test/post-1/poster.jpg",
            "type": "video",
            "variants": {
              "preview360": "https://cdn.locava.test/post-1/preview-2.jpg",
              "preview360Avc": "https://cdn.locava.test/post-1/preview-2.jpg",
            },
            "width": undefined,
          },
        ],
        "assetsReady": true,
        "caption": "A caption preview that is intentionally verbose so the mapper has to clamp it and keep the feed card tiny.",
        "cardSummary": {
          "activities": [
            "waterfall",
            "hiking",
            "camping",
            "travel",
          ],
          "address": "Skamania County, Washington",
          "assets": [
            {
              "aspectRatio": 0.5625,
              "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
              "height": 1280,
              "id": "asset-1",
              "mp4Url": "https://cdn.locava.test/post-1/main720.mp4",
              "orientation": "portrait",
              "originalUrl": "https://cdn.locava.test/post-1/original.mp4",
              "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "previewUrl": "https://cdn.locava.test/post-1/preview.jpg",
              "streamUrl": "https://cdn.locava.test/post-1/master.m3u8",
              "type": "video",
              "width": 720,
            },
            {
              "aspectRatio": null,
              "blurhash": null,
              "height": null,
              "id": "asset-2",
              "mp4Url": null,
              "orientation": null,
              "originalUrl": null,
              "posterUrl": null,
              "previewUrl": "https://cdn.locava.test/post-1/preview-2.jpg",
              "streamUrl": null,
              "type": "video",
              "width": null,
            },
          ],
          "assetsReady": true,
          "author": {
            "avatarUrl": "https://cdn.locava.test/u1.jpg",
            "displayName": "User One",
            "handle": "user.one",
            "name": "User One",
            "pic": "https://cdn.locava.test/u1.jpg",
            "userId": "user-1",
          },
          "captionPreview": "A caption preview that is intentionally verbose so the mapper has to clamp it and keep the feed card tiny.",
          "createdAtMs": 1700000000000,
          "derivedAssetCount": 2,
          "firstAssetUrl": "https://cdn.locava.test/post-1/original.mp4",
          "geo": {
            "city": "Skamania County",
            "country": "United States",
            "geohash": "c21s0hjnj",
            "lat": 45.7261286,
            "long": -121.6335058,
            "state": "Washington",
          },
          "media": {
            "aspectRatio": 0.5625,
            "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
            "startupHint": "poster_then_preview",
            "type": "video",
          },
          "postId": "post-1",
          "rankToken": "rank-1",
          "social": {
            "commentCount": 3,
            "likeCount": 12,
          },
          "title": "A very long waterfall title that should still stay compact and readable for car…",
          "updatedAtMs": 1700000001000,
          "viewer": {
            "liked": false,
            "saved": false,
          },
        },
        "createdAtMs": 1700000000000,
        "lat": 45.7261286,
        "lng": -121.6335058,
        "mediaType": "video",
        "postId": "post-1",
        "thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",
        "title": "A very long waterfall title that should still stay compact and readable for car…",
        "updatedAtMs": 1700000001000,
        "userId": "user-1",
      }
    `);
    expect(listForbiddenCompactFieldViolations(shell)).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(shell), "utf8")).toBeLessThan(10_000);
  });

  it("maps compact markers for large datasets under payload budget", () => {
    const markers = Array.from({ length: 1602 }, (_, index) =>
      toMapMarkerCompactDTO({
        id: `marker-${index + 1}`,
        postId: `post-${index + 1}`,
        lat: 40 + index * 0.0001,
        lng: -74 - index * 0.0001,
        activity: index % 2 === 0 ? "hike" : "waterfall",
        activities: ["hike", "waterfall"],
        title: `Marker ${index + 1}`,
        createdAt: 1_700_000_000_000 + index,
        ownerId: `owner-${(index % 32) + 1}`,
        thumbnailUrl: `https://cdn.locava.test/markers/${index + 1}.jpg`,
        hasPhoto: true,
        hasVideo: index % 5 === 0,
      }),
    );

    expect(listForbiddenCompactFieldViolations(markers)).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(markers), "utf8")).toBeLessThan(500_000);
  });

  it("maps profile headers with safe defaults", () => {
    const header = toProfileHeaderDTO({
      userId: "user-1",
      handle: null,
      name: null,
      profilePic: "",
      counts: null,
    });

    expect(header).toEqual({
      userId: "user-1",
      handle: "user-1",
      name: "user-1",
      profilePic: null,
      profilePicSmallPath: null,
      profilePicLargePath: null,
      bio: null,
      updatedAtMs: null,
      profileVersion: null,
      counts: {
        posts: 0,
        followers: 0,
        following: 0,
      },
    });
  });

  it("flags forbidden fields when compact boundaries are violated", () => {
    const issues = listForbiddenCompactFieldViolations({
      commentsPreview: [{ text: "hi" }],
      author: {
        fullUser: {
          followers: ["u1"],
        },
      },
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      "commentsPreview",
      "author.fullUser",
      "author.fullUser.followers",
    ]);
  });

  it("marks cover_only when rawFirestoreAssetCount exceeds serialized postcard assets", () => {
    const dto = toFeedCardDTO({
      postId: "p-multi",
      rankToken: "r1",
      author: { userId: "u1", handle: "u", name: null, pic: null },
      activities: [],
      assets: [
        {
          id: "a1",
          type: "image",
          previewUrl: null,
          posterUrl: "https://cdn/1.jpg",
          originalUrl: "https://cdn/1.jpg",
          blurhash: null,
          width: null,
          height: null,
          aspectRatio: null,
          orientation: null,
        },
      ],
      rawFirestoreAssetCount: 3,
      assetCount: 3,
      media: { type: "image", posterUrl: "https://cdn/1.jpg", aspectRatio: 1, startupHint: "poster_only" },
      social: { likeCount: 0, commentCount: 0 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1,
    } as never);
    expect(dto.rawFirestoreAssetCount).toBe(3);
    expect(dto.mediaCompleteness).toBe("cover_only");
    expect(dto.requiresAssetHydration).toBe(true);
  });
});
