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
    canonicalAliasMode: "app_post_v2_only",
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
        "appPostV2": {
          "assets": [
            {
              "fallbackVideoUrl": "https://cdn.locava.test/post-1/main720.mp4",
              "id": "asset-1",
              "image": null,
              "imageUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "index": 0,
              "mediaType": "video",
              "playback": {
                "defaultUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "fallbackUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "goodNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "highQualityUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "hlsUrl": "https://cdn.locava.test/post-1/master.m3u8",
                "poorNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "previewUrl": "https://cdn.locava.test/post-1/preview.jpg",
                "primaryUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "selectedReason": "synthetic_seed_playback",
                "startupUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "upgradeUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "weakNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
              },
              "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "presentation": {
                "letterboxGradient": null,
              },
              "thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "type": "video",
              "url": "https://cdn.locava.test/post-1/main720.mp4",
              "video": {
                "durationSec": null,
                "hasAudio": null,
                "originalUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "playback": {
                  "defaultUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "fallbackUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "goodNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "highQualityUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "hlsUrl": "https://cdn.locava.test/post-1/master.m3u8",
                  "poorNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "previewUrl": "https://cdn.locava.test/post-1/preview.jpg",
                  "primaryUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "selectedReason": "synthetic_seed_playback",
                  "startupUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "upgradeUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "weakNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                },
                "posterHighUrl": null,
                "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "readiness": {
                  "assetsReady": true,
                  "faststartVerified": true,
                  "instantPlaybackReady": true,
                  "processingStatus": "completed",
                },
                "technical": {
                  "audioCodec": null,
                  "bitrateKbps": null,
                  "height": null,
                  "playbackCodec": null,
                  "sizeBytes": null,
                  "sourceCodec": null,
                  "width": null,
                },
                "thumbnailUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "variants": {
                  "hls": "https://cdn.locava.test/post-1/master.m3u8",
                  "hlsAvcMaster": null,
                  "main1080": null,
                  "main1080Avc": null,
                  "main720": "https://cdn.locava.test/post-1/main720.mp4",
                  "main720Avc": "https://cdn.locava.test/post-1/main720.mp4",
                  "preview360": null,
                  "preview360Avc": null,
                  "startup1080Faststart": null,
                  "startup1080FaststartAvc": null,
                  "startup540Faststart": null,
                  "startup540FaststartAvc": null,
                  "startup720Faststart": null,
                  "startup720FaststartAvc": null,
                  "upgrade1080Faststart": null,
                  "upgrade1080FaststartAvc": null,
                },
              },
              "videoUrl": "https://cdn.locava.test/post-1/main720.mp4",
            },
            {
              "fallbackVideoUrl": null,
              "id": "asset-2",
              "image": null,
              "imageUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "index": 1,
              "mediaType": "video",
              "playback": {
                "defaultUrl": null,
                "fallbackUrl": null,
                "goodNetworkUrl": null,
                "highQualityUrl": null,
                "hlsUrl": null,
                "poorNetworkUrl": null,
                "previewUrl": null,
                "primaryUrl": null,
                "selectedReason": "original_unverified_fallback",
                "startupUrl": null,
                "upgradeUrl": null,
                "weakNetworkUrl": null,
              },
              "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "presentation": {
                "letterboxGradient": null,
              },
              "thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "type": "video",
              "url": null,
              "video": {
                "durationSec": null,
                "hasAudio": null,
                "originalUrl": null,
                "playback": {
                  "defaultUrl": null,
                  "fallbackUrl": null,
                  "goodNetworkUrl": null,
                  "highQualityUrl": null,
                  "hlsUrl": null,
                  "poorNetworkUrl": null,
                  "previewUrl": null,
                  "primaryUrl": null,
                  "selectedReason": "original_unverified_fallback",
                  "startupUrl": null,
                  "upgradeUrl": null,
                  "weakNetworkUrl": null,
                },
                "posterHighUrl": null,
                "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "readiness": {
                  "assetsReady": false,
                  "faststartVerified": false,
                  "instantPlaybackReady": false,
                  "processingStatus": null,
                },
                "technical": {
                  "audioCodec": null,
                  "bitrateKbps": null,
                  "height": null,
                  "playbackCodec": null,
                  "sizeBytes": null,
                  "sourceCodec": null,
                  "width": null,
                },
                "thumbnailUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "variants": {
                  "hls": null,
                  "hlsAvcMaster": null,
                  "main1080": null,
                  "main1080Avc": null,
                  "main720": null,
                  "main720Avc": null,
                  "preview360": null,
                  "preview360Avc": null,
                  "startup1080Faststart": null,
                  "startup1080FaststartAvc": null,
                  "startup540Faststart": null,
                  "startup540FaststartAvc": null,
                  "startup720Faststart": null,
                  "startup720FaststartAvc": null,
                  "upgrade1080Faststart": null,
                  "upgrade1080FaststartAvc": null,
                },
              },
              "videoUrl": null,
            },
          ],
          "author": {
            "displayName": "User One",
            "handle": "@user.one",
            "profilePicUrl": "https://cdn.locava.test/u1.jpg",
            "userId": "user-1",
          },
          "classification": {
            "activities": [
              "waterfall",
              "hiking",
              "camping",
              "travel",
              "extra",
            ],
            "isBoosted": false,
            "mediaKind": "video",
            "moderatorTier": null,
            "primaryActivity": "waterfall",
            "privacyLabel": null,
            "reel": false,
            "settingType": null,
            "source": "user",
            "visibility": "unknown",
          },
          "compatibility": {
            "displayPhotoLink": "https://cdn.locava.test/post-1/poster.jpg",
            "fallbackVideoUrl": "https://cdn.locava.test/post-1/main720.mp4",
            "mediaType": "video",
            "photoLink": "https://cdn.locava.test/post-1/poster.jpg",
            "photoLinks2": "https://cdn.locava.test/post-1/main720.mp4",
            "photoLinks3": "https://cdn.locava.test/post-1/main720.mp4",
            "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
            "thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",
          },
          "engagement": {
            "commentCount": 3,
            "commentsVersion": 3,
            "likeCount": 12,
            "likesVersion": 12,
            "saveCount": 0,
            "savesVersion": 0,
            "shareCount": 0,
            "showComments": null,
            "showLikes": null,
            "viewCount": 0,
          },
          "engagementPreview": {
            "recentComments": [],
            "recentLikers": [],
          },
          "fallbackVideoUrl": "https://cdn.locava.test/post-1/main720.mp4",
          "id": "post-1",
          "lifecycle": {
            "createdAt": null,
            "createdAtMs": 1700000000000,
            "isDeleted": false,
            "status": "active",
            "updatedAt": null,
          },
          "location": {
            "coordinates": {
              "geohash": "c21s0hjnj",
              "lat": 45.7261286,
              "lng": -121.6335058,
            },
            "display": {
              "address": "Skamania County, Washington",
              "label": "Skamania County, Washington",
              "name": "Skamania County, Washington",
              "subtitle": "Skamania County, United States",
            },
            "place": {
              "placeId": null,
              "placeName": null,
              "precision": "unknown",
              "source": "unknown",
            },
            "regions": {
              "city": "Skamania County",
              "cityRegionId": null,
              "country": "United States",
              "countryRegionId": null,
              "state": "Washington",
              "stateRegionId": null,
            },
          },
          "media": {
            "assetCount": 2,
            "assets": [
              {
                "fallbackVideoUrl": "https://cdn.locava.test/post-1/main720.mp4",
                "id": "asset-1",
                "image": null,
                "imageUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "index": 0,
                "mediaType": "video",
                "playback": {
                  "defaultUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "fallbackUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "goodNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "highQualityUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "hlsUrl": "https://cdn.locava.test/post-1/master.m3u8",
                  "poorNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "previewUrl": "https://cdn.locava.test/post-1/preview.jpg",
                  "primaryUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "selectedReason": "synthetic_seed_playback",
                  "startupUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "upgradeUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "weakNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                },
                "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "presentation": {
                  "letterboxGradient": null,
                },
                "thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "type": "video",
                "url": "https://cdn.locava.test/post-1/main720.mp4",
                "video": {
                  "durationSec": null,
                  "hasAudio": null,
                  "originalUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  "playback": {
                    "defaultUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "fallbackUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "goodNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "highQualityUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "hlsUrl": "https://cdn.locava.test/post-1/master.m3u8",
                    "poorNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "previewUrl": "https://cdn.locava.test/post-1/preview.jpg",
                    "primaryUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "selectedReason": "synthetic_seed_playback",
                    "startupUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "upgradeUrl": "https://cdn.locava.test/post-1/main720.mp4",
                    "weakNetworkUrl": "https://cdn.locava.test/post-1/main720.mp4",
                  },
                  "posterHighUrl": null,
                  "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
                  "readiness": {
                    "assetsReady": true,
                    "faststartVerified": true,
                    "instantPlaybackReady": true,
                    "processingStatus": "completed",
                  },
                  "technical": {
                    "audioCodec": null,
                    "bitrateKbps": null,
                    "height": null,
                    "playbackCodec": null,
                    "sizeBytes": null,
                    "sourceCodec": null,
                    "width": null,
                  },
                  "thumbnailUrl": "https://cdn.locava.test/post-1/poster.jpg",
                  "variants": {
                    "hls": "https://cdn.locava.test/post-1/master.m3u8",
                    "hlsAvcMaster": null,
                    "main1080": null,
                    "main1080Avc": null,
                    "main720": "https://cdn.locava.test/post-1/main720.mp4",
                    "main720Avc": "https://cdn.locava.test/post-1/main720.mp4",
                    "preview360": null,
                    "preview360Avc": null,
                    "startup1080Faststart": null,
                    "startup1080FaststartAvc": null,
                    "startup540Faststart": null,
                    "startup540FaststartAvc": null,
                    "startup720Faststart": null,
                    "startup720FaststartAvc": null,
                    "upgrade1080Faststart": null,
                    "upgrade1080FaststartAvc": null,
                  },
                },
                "videoUrl": "https://cdn.locava.test/post-1/main720.mp4",
              },
              {
                "fallbackVideoUrl": null,
                "id": "asset-2",
                "image": null,
                "imageUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "index": 1,
                "mediaType": "video",
                "playback": {
                  "defaultUrl": null,
                  "fallbackUrl": null,
                  "goodNetworkUrl": null,
                  "highQualityUrl": null,
                  "hlsUrl": null,
                  "poorNetworkUrl": null,
                  "previewUrl": null,
                  "primaryUrl": null,
                  "selectedReason": "original_unverified_fallback",
                  "startupUrl": null,
                  "upgradeUrl": null,
                  "weakNetworkUrl": null,
                },
                "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "presentation": {
                  "letterboxGradient": null,
                },
                "thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",
                "type": "video",
                "url": null,
                "video": {
                  "durationSec": null,
                  "hasAudio": null,
                  "originalUrl": null,
                  "playback": {
                    "defaultUrl": null,
                    "fallbackUrl": null,
                    "goodNetworkUrl": null,
                    "highQualityUrl": null,
                    "hlsUrl": null,
                    "poorNetworkUrl": null,
                    "previewUrl": null,
                    "primaryUrl": null,
                    "selectedReason": "original_unverified_fallback",
                    "startupUrl": null,
                    "upgradeUrl": null,
                    "weakNetworkUrl": null,
                  },
                  "posterHighUrl": null,
                  "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
                  "readiness": {
                    "assetsReady": false,
                    "faststartVerified": false,
                    "instantPlaybackReady": false,
                    "processingStatus": null,
                  },
                  "technical": {
                    "audioCodec": null,
                    "bitrateKbps": null,
                    "height": null,
                    "playbackCodec": null,
                    "sizeBytes": null,
                    "sourceCodec": null,
                    "width": null,
                  },
                  "thumbnailUrl": "https://cdn.locava.test/post-1/poster.jpg",
                  "variants": {
                    "hls": null,
                    "hlsAvcMaster": null,
                    "main1080": null,
                    "main1080Avc": null,
                    "main720": null,
                    "main720Avc": null,
                    "preview360": null,
                    "preview360Avc": null,
                    "startup1080Faststart": null,
                    "startup1080FaststartAvc": null,
                    "startup540Faststart": null,
                    "startup540FaststartAvc": null,
                    "startup720Faststart": null,
                    "startup720FaststartAvc": null,
                    "upgrade1080Faststart": null,
                    "upgrade1080FaststartAvc": null,
                  },
                },
                "videoUrl": null,
              },
            ],
            "assetsReady": true,
            "completeness": "complete",
            "cover": {
              "aspectRatio": null,
              "assetId": "asset-1",
              "gradient": null,
              "height": null,
              "posterUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",
              "type": "video",
              "url": "https://cdn.locava.test/post-1/poster.jpg",
              "width": null,
            },
            "coverAssetId": "asset-1",
            "hasMultipleAssets": true,
            "instantPlaybackReady": true,
            "primaryAssetId": "asset-1",
            "rawAssetCount": 2,
            "status": "ready",
          },
          "mediaType": "video",
          "photoLinks2": "https://cdn.locava.test/post-1/main720.mp4",
          "photoLinks3": "https://cdn.locava.test/post-1/main720.mp4",
          "schema": {
            "name": "locava.appPost",
            "normalizedFromLegacy": true,
            "sourcePostSchemaVersion": 2,
            "version": 2,
          },
          "text": {
            "caption": "A caption preview that is intentionally verbose so the mapper has to clamp it and keep the feed card tiny.",
            "content": "",
            "description": "",
            "searchableText": "A very long waterfall title that should still stay compact and readable for cards A caption preview that is intentionally verbose so the mapper has to clamp it and keep the feed card tiny. waterfall hiking camping travel extra Skamania County, Washington",
            "title": "A very long waterfall title that should still stay compact and readable for cards",
          },
          "viewerState": {
            "followsAuthor": false,
            "liked": false,
            "saved": false,
            "savedCollectionIds": [],
          },
        },
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
        "postContractVersion": 3,
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
    /** Compact first-paint cards can still carry canonical playback truth; keep the single-card budget tight. */
    expect(Buffer.byteLength(JSON.stringify(dto), "utf8")).toBeLessThan(14_500);
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

  it("maps legacy multi-image Firestore raw into appPost.media.assets with same cardinality as source assets[]", () => {
    const raw = {
      id: "post_legacy_multi",
      postId: "post_legacy_multi",
      userId: "u1",
      userHandle: "writer",
      userName: "Writer",
      userPic: null,
      title: "t",
      caption: "c",
      activities: [],
      address: "",
      lat: 1,
      long: 2,
      geoData: {},
      displayPhotoLink: "https://cdn/a1.jpg",
      thumbUrl: "https://cdn/a1.jpg",
      mediaType: "image",
      time: Date.now(),
      assets: [
        {
          id: "a1",
          type: "image",
          original: "https://cdn/a1.jpg",
          variants: { md: { webp: "https://cdn/a1-md.webp" }, thumb: { webp: "https://cdn/a1-thumb.webp" } }
        },
        {
          id: "a2",
          type: "image",
          original: "https://cdn/a2.jpg",
          variants: { md: { webp: "https://cdn/a2-md.webp" }, thumb: { webp: "https://cdn/a2-thumb.webp" } }
        }
      ]
    };
    const dto = toFeedCardDTO({
      postId: "post_legacy_multi",
      rankToken: "r1",
      sourceRawPost: raw as never,
      author: { userId: "u1", handle: "writer", name: "Writer", pic: null },
      activities: [],
      assets: raw.assets as never,
      compactAssetLimit: 12,
      rawFirestoreAssetCount: 2,
      assetCount: 2,
      hasMultipleAssets: true,
      media: { type: "image", posterUrl: "https://cdn/a1.jpg", aspectRatio: 1, startupHint: "poster_only" },
      social: { likeCount: 0, commentCount: 0 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const ap = dto.appPost as { media?: { assets?: unknown[]; assetCount?: number } } | undefined;
    expect(Array.isArray(ap?.media?.assets)).toBe(true);
    expect(ap?.media?.assets?.length).toBe(2);
    expect(ap?.media?.assetCount).toBe(2);
    expect(dto.assets?.length).toBe(2);
  });

  it("does not downgrade a video asset to image when poster exists", () => {
    const raw = {
      id: "video_poster_regression",
      classification: { mediaKind: "video" },
      media: {
        status: "ready",
        assetsReady: true,
        instantPlaybackReady: true,
        completeness: "complete",
        assetCount: 1,
        rawAssetCount: 1,
        hasMultipleAssets: false,
        primaryAssetId: "video_asset_1",
        coverAssetId: "video_asset_1",
        cover: { assetId: "video_asset_1", type: "video", url: "https://cdn/poster.jpg", thumbUrl: "https://cdn/poster.jpg", posterUrl: "https://cdn/poster.jpg", width: null, height: null, aspectRatio: null, gradient: null },
        assets: [
          {
            id: "video_asset_1",
            index: 0,
            type: "video",
            image: null,
            presentation: { letterboxGradient: null },
            video: {
              originalUrl: "https://cdn/original.mp4",
              posterUrl: "https://cdn/poster.jpg",
              posterHighUrl: null,
              thumbnailUrl: "https://cdn/poster.jpg",
              durationSec: null,
              hasAudio: true,
              playback: { startupUrl: "https://cdn/startup720.mp4", defaultUrl: "https://cdn/startup720.mp4", primaryUrl: "https://cdn/startup720.mp4" },
              variants: {},
              readiness: { assetsReady: true, instantPlaybackReady: true, faststartVerified: true, processingStatus: "ready" },
              technical: { sourceCodec: null, playbackCodec: null, audioCodec: null, bitrateKbps: null, sizeBytes: null, width: null, height: null }
            }
          }
        ]
      },
      compatibility: { photoLink: "https://cdn/poster.jpg", displayPhotoLink: "https://cdn/poster.jpg", thumbUrl: "https://cdn/poster.jpg", posterUrl: "https://cdn/poster.jpg", mediaType: "video", photoLinks2: "https://cdn/startup720.mp4", photoLinks3: "https://cdn/startup720.mp4", fallbackVideoUrl: "https://cdn/original.mp4" }
    };
    const dto = toFeedCardDTO({
      postId: "video_poster_regression",
      rankToken: "r",
      sourceRawPost: raw as never,
      author: { userId: "u1", handle: "u1", name: "u1", pic: null },
      assets: [
        {
          id: "video_asset_1",
          type: "video",
          posterUrl: "https://cdn/poster.jpg",
          previewUrl: "https://cdn/poster.jpg",
          originalUrl: "https://cdn/original.mp4",
          mp4Url: "https://cdn/startup720.mp4"
        }
      ],
      media: { type: "video", posterUrl: "https://cdn/poster.jpg", startupHint: "poster_then_preview" },
      createdAtMs: 1,
      updatedAtMs: 1
    } as never);
    const appPost = dto.appPost as { media?: { assets?: Array<{ type?: string; id?: string; video?: { playback?: { startupUrl?: string | null } } }> } };
    expect(appPost.media?.assets?.[0]?.id).toBe("video_asset_1");
    expect(appPost.media?.assets?.[0]?.type).toBe("video");
    expect(appPost.media?.assets?.[0]?.video?.playback?.startupUrl).toBeTruthy();
  });
});
