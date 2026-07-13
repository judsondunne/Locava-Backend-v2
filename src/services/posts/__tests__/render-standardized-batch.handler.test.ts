/**
 * Ensures render-standardized-batch reads posts via Firestore getAll chunks
 * (not N concurrent .get() calls) while preserving order and response shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let fakeDb: {
  collection: (name: string) => unknown;
  getAll: (...args: unknown[]) => Promise<unknown[]>;
} | null = null;
let getAllCalls: Array<{ ids: string[]; fieldMask?: string[] }> = [];
let postGetCalls = 0;
let userDocs: Record<string, Record<string, unknown>> = {};

vi.mock("../../../repositories/source-of-truth/firestore-client.js", () => ({
  getFirestoreSourceClient: () => fakeDb,
}));

const PLAYABLE_VIDEO_URL =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_x/video_0/startup720_faststart_avc.mp4";
const POSTER_URL =
  "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_0_poster.jpg";

function baseVideoDoc(postId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: postId,
    postId,
    media: {
      assetCount: 1,
      assets: [
        {
          id: "video_0",
          index: 0,
          type: "video",
          video: {
            originalUrl: PLAYABLE_VIDEO_URL,
            posterUrl: POSTER_URL,
            posterHighUrl: POSTER_URL,
            thumbnailUrl: POSTER_URL,
            durationSec: 12,
            hasAudio: true,
            playback: {
              primaryUrl: PLAYABLE_VIDEO_URL,
              startupUrl: PLAYABLE_VIDEO_URL,
              goodNetworkUrl: PLAYABLE_VIDEO_URL,
              weakNetworkUrl: null,
              poorNetworkUrl: null,
              defaultUrl: PLAYABLE_VIDEO_URL,
              highQualityUrl: null,
              fallbackUrl: null,
              upgradeUrl: null,
              hlsUrl: null,
              previewUrl: null,
              selectedReason: "canonical",
            },
            variants: {
              preview360: null,
              preview360Avc: null,
              main720: null,
              main720Avc: null,
              main1080: null,
              main1080Avc: null,
              startup540Faststart: null,
              startup540FaststartAvc: null,
              startup720Faststart: null,
              startup720FaststartAvc: PLAYABLE_VIDEO_URL,
              startup1080Faststart: null,
              startup1080FaststartAvc: null,
              upgrade1080Faststart: null,
              upgrade1080FaststartAvc: null,
              hls: null,
              hlsAvcMaster: null,
            },
            readiness: {
              assetsReady: true,
              instantPlaybackReady: true,
              faststartVerified: false,
              processingStatus: "ready",
            },
            codecs: { video: "avc1", audio: "aac" },
            technical: {
              sourceCodec: "avc1",
              playbackCodec: "avc1",
              audioCodec: "aac",
              bitrateKbps: 1200,
              sizeBytes: 4567890,
              width: 720,
              height: 1280,
            },
          },
          presentation: {
            carouselFitWidth: true,
            letterboxGradient: { top: "#000000", bottom: "#000000" },
            resizeMode: "contain",
          },
          source: {
            kind: "canonical",
            legacySourcesConsidered: [],
            legacyVariantUrlsMerged: false,
            originalAssetId: "video_0",
            primarySources: ["render-pipeline"],
          },
        },
      ],
      assetsReady: true,
      completeness: "complete",
      cover: {
        assetId: "video_0",
        type: "video",
        url: POSTER_URL,
        thumbUrl: POSTER_URL,
        posterUrl: POSTER_URL,
        width: 720,
        height: 1280,
        aspectRatio: 0.5625,
        gradient: { top: "#000000", bottom: "#000000" },
      },
      coverAssetId: "video_0",
      hasMultipleAssets: false,
      instantPlaybackReady: true,
      presentation: { carouselFitWidth: true, resizeMode: "contain" },
      primaryAssetId: "video_0",
      rawAssetCount: 1,
      status: "ready",
    },
    author: {
      userId: "u1",
      displayName: "Author One",
      handle: "author1",
      profilePicUrl: "https://cdn/p.jpg",
    },
    classification: {
      activities: ["hiking"],
      primaryActivity: "hiking",
      mediaKind: "video",
      visibility: "public",
      isBoosted: false,
      reel: false,
      settingType: "outdoor",
      moderatorTier: 0,
      source: "user",
      privacyLabel: "Public Spot",
    },
    compatibility: {
      displayPhotoLink: POSTER_URL,
      mediaType: "video",
      photoLink: POSTER_URL,
      photoLinks2: null,
      photoLinks3: null,
      thumbUrl: POSTER_URL,
      posterUrl: POSTER_URL,
      fallbackVideoUrl: null,
    },
    engagement: {
      commentCount: 0,
      commentsVersion: 0,
      likeCount: 0,
      likesVersion: 0,
      saveCount: 0,
      savesVersion: 0,
      shareCount: 0,
      showComments: true,
      showLikes: true,
      viewCount: 0,
    },
    engagementPreview: { recentComments: [], recentLikers: [] },
    lifecycle: {
      createdAt: "2026-05-01T00:00:00.000Z",
      createdAtMs: 1746086400000,
      deletedAt: null,
      isDeleted: false,
      lastMediaUpdatedAt: "2026-05-01T00:00:00.000Z",
      lastUserVisibleAt: "2026-05-01T00:00:00.000Z",
      status: "active",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    location: {
      coordinates: { geohash: "9q8yy", lat: 19.6, lng: -155.9 },
      display: { address: "Hilo, HI", label: "Hilo, HI", name: "Hilo", subtitle: "" },
      place: { placeId: null, placeName: null, precision: "city", source: "google" },
      regions: {
        city: "Hilo",
        cityRegionId: "hilo",
        country: "US",
        countryRegionId: "us",
        state: "HI",
        stateRegionId: "hi",
      },
    },
    ranking: { aggregates: {}, rollup: {} },
    schema: {
      canonicalizedAt: "2026-05-01T00:00:00.000Z",
      canonicalizedBy: "test",
      migrationRunId: null,
      name: "locava.post",
      restoreBackupDocId: "",
      restorePreviewOnly: false,
      restoreRunId: "",
      restoreSourceName: "test",
      restoredAt: "2026-05-01T00:00:00.000Z",
      restoredFromCanonicalBackup: false,
      sourceShape: "root_standardized",
      version: 2,
    },
    text: {
      title: "Mauna Kea sunrise",
      caption: "",
      description: "",
      content: "",
      searchableText: "",
    },
    ...overrides,
  };
}

function buildDb(docsById: Record<string, Record<string, unknown> | null>) {
  return {
    collection(name: string) {
      if (name === "users") {
        return {
          doc(userId: string) {
            return {
              id: userId,
              path: `users/${userId}`,
              async get() {
                const data = userDocs[userId] ?? { blockedUsers: [] };
                return {
                  exists: true,
                  id: userId,
                  data: () => data,
                };
              },
            };
          },
        };
      }
      expect(name).toBe("posts");
      return {
        doc(postId: string) {
          return {
            id: postId,
            path: `posts/${postId}`,
            async get() {
              postGetCalls += 1;
              const data = docsById[postId];
              if (data === undefined || data === null) {
                return { exists: false, id: postId, data: () => undefined };
              }
              return { exists: true, id: postId, data: () => data };
            },
          };
        },
      };
    },
    async getAll(...args: unknown[]) {
      const maybeOpts = args[args.length - 1];
      const hasFieldMask =
        maybeOpts &&
        typeof maybeOpts === "object" &&
        !("id" in (maybeOpts as object)) &&
        "fieldMask" in (maybeOpts as object);
      const refs = (hasFieldMask ? args.slice(0, -1) : args) as Array<{ id: string; path: string }>;
      const fieldMask = hasFieldMask
        ? ([...(maybeOpts as { fieldMask: string[] }).fieldMask] as string[])
        : undefined;
      getAllCalls.push({ ids: refs.map((r) => r.id), fieldMask });
      return refs.map((ref) => {
        if (ref.path?.startsWith("users/")) {
          const data = userDocs[ref.id] ?? { blockedUsers: [] };
          return { exists: true, id: ref.id, data: () => data };
        }
        const data = docsById[ref.id];
        if (data === undefined || data === null) {
          return { exists: false, id: ref.id, data: () => undefined };
        }
        return { exists: true, id: ref.id, data: () => data };
      });
    },
  };
}

describe("handleRenderStandardizedBatch getAll batching", () => {
  beforeEach(() => {
    vi.resetModules();
    fakeDb = null;
    getAllCalls = [];
    postGetCalls = 0;
    userDocs = {};
  });

  it("reads posts via getAll chunks (not per-doc .get) and preserves order", async () => {
    const ids = Array.from({ length: 35 }, (_, i) => `post_${String(i).padStart(2, "0")}`);
    const docsById: Record<string, Record<string, unknown> | null> = {};
    for (const id of ids) {
      docsById[id] = baseVideoDoc(id);
    }
    // One missing in the middle
    docsById["post_10"] = null;

    fakeDb = buildDb(docsById);
    const { handleRenderStandardizedBatch } = await import("../render-standardized-batch.handler.js");
    const result = await handleRenderStandardizedBatch({
      viewerId: "viewer-1",
      postIds: ids,
      surface: "profile_grid",
    });

    expect(postGetCalls).toBe(0);
    const postChunks = getAllCalls.filter((c) => !c.fieldMask);
    const userChunks = getAllCalls.filter((c) => c.fieldMask?.includes("blockedUsers"));
    expect(userChunks).toHaveLength(1);
    expect(userChunks[0]?.ids).toEqual(["viewer-1"]);
    expect(postChunks).toHaveLength(2);
    expect(postChunks[0]?.ids).toHaveLength(30);
    expect(postChunks[1]?.ids).toHaveLength(5);
    expect(result.missing).toEqual(["post_10"]);
    expect(result.posts).toHaveLength(34);
    expect(result.posts.map((p) => p.id ?? (p as { postId?: string }).postId)).toEqual(
      ids.filter((id) => id !== "post_10"),
    );
    expect(result.rejected).toEqual([]);
  });

  it("rejects private posts for non-authors without using per-doc .get", async () => {
    const publicId = "post_public";
    const privateId = "post_private";
    fakeDb = buildDb({
      [publicId]: baseVideoDoc(publicId),
      [privateId]: baseVideoDoc(privateId, {
        classification: {
          activities: ["hiking"],
          primaryActivity: "hiking",
          mediaKind: "video",
          visibility: "private",
          isBoosted: false,
          reel: false,
          settingType: "outdoor",
          moderatorTier: 0,
          source: "user",
          privacyLabel: "Private Spot",
        },
        author: {
          userId: "someone-else",
          displayName: "Author One",
          handle: "author1",
          profilePicUrl: "https://cdn/p.jpg",
        },
      }),
    });

    const { handleRenderStandardizedBatch } = await import("../render-standardized-batch.handler.js");
    const result = await handleRenderStandardizedBatch({
      viewerId: "viewer-1",
      postIds: [publicId, privateId],
      surface: "profile_grid",
    });

    expect(postGetCalls).toBe(0);
    expect(getAllCalls.some((c) => c.fieldMask?.includes("blockedUsers"))).toBe(true);
    expect(getAllCalls.some((c) => !c.fieldMask && c.ids.includes(publicId))).toBe(true);
    expect(result.posts).toHaveLength(1);
    expect(result.rejected).toEqual([
      {
        postId: privateId,
        reason: "forbidden",
        issues: ["visibility:forbidden"],
      },
    ]);
  });
});
