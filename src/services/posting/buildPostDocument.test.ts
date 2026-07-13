import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { buildNativePostDocument, type BuildNativePostDocumentInput } from "./buildPostDocument.js";

function makeBaseInput(
  overrides: Partial<BuildNativePostDocumentInput> = {},
): BuildNativePostDocumentInput {
  const nowTs = Timestamp.fromMillis(1_746_662_400_000);
  return {
    postId: "post_test_1",
    effectiveUserId: "target-user-1",
    viewerId: "admin-user-1",
    sessionId: "session-1",
    stagedSessionId: "staged-1",
    idempotencyKey: "idem-1",
    nowMs: 1_746_662_400_000,
    nowTs,
    user: {
      handle: "targethandle",
      name: "Target User",
      profilePic: "https://cdn.example/target.jpg",
    },
    title: "Title",
    content: "Caption",
    activities: ["coffee"],
    lat: 37.77,
    lng: -122.42,
    address: "San Francisco, CA",
    privacy: "Public Spot",
    tags: [],
    texts: [],
    recordings: [],
    assembled: {
      mediaType: "video",
      primaryDisplayUrl: "https://cdn.example/p0.jpg",
      assets: [
        {
          id: "asset-0",
          type: "video",
          original: "https://cdn.example/v0.mp4",
          poster: "https://cdn.example/p0.jpg",
        },
      ],
      hasVideo: true,
      imageCoverReady: true,
      imageVariantsPending: false,
      videoCount: 1,
      imageCount: 0,
      variantUrlCount: 0,
    } as BuildNativePostDocumentInput["assembled"],
    geo: {
      cityRegionId: "US-CA-San-Francisco",
      stateRegionId: "US-CA",
      countryRegionId: "US",
      geohash: "9q8yyk8yt",
      geoData: { country: "US", state: "CA", city: "San Francisco" },
      addressDisplayName: "San Francisco, CA",
      locationDisplayName: "San Francisco, CA",
      fallbackPrecision: "address",
      reverseGeocodeStatus: "resolved",
      source: "manual",
    },
    ...overrides,
  };
}

describe("buildNativePostDocument", () => {
  it("uses the effective user for ownership and compatibility author fields", () => {
    const nowTs = Timestamp.fromMillis(1_746_662_400_000);
    const post = buildNativePostDocument({
      postId: "post_test_1",
      effectiveUserId: "target-user-1",
      viewerId: "admin-user-1",
      sessionId: "session-1",
      stagedSessionId: "staged-1",
      idempotencyKey: "idem-1",
      nowMs: 1_746_662_400_000,
      nowTs,
      user: {
        handle: "targethandle",
        name: "Target User",
        profilePic: "https://cdn.example/target.jpg",
      },
      title: "Title",
      content: "Caption",
      activities: ["coffee"],
      lat: 37.77,
      lng: -122.42,
      address: "San Francisco, CA",
      privacy: "Public Spot",
      tags: [],
      texts: [],
      recordings: [],
      assembled: {
        mediaType: "image",
        primaryDisplayUrl: "https://cdn.example/p0.jpg",
        assets: [
          {
            id: "asset-0",
            type: "image",
            original: "https://cdn.example/p0.jpg",
          },
        ],
        hasVideo: false,
        imageCoverReady: true,
        imageVariantsPending: false,
        videoCount: 0,
        imageCount: 1,
        variantUrlCount: 0,
      },
      geo: {
        cityRegionId: "US-CA-San-Francisco",
        stateRegionId: "US-CA",
        countryRegionId: "US",
        geohash: "9q8yyk8yt",
        geoData: {
          country: "US",
          state: "CA",
          city: "San Francisco",
        },
        addressDisplayName: "San Francisco, CA",
        locationDisplayName: "San Francisco, CA",
        fallbackPrecision: "address",
        reverseGeocodeStatus: "resolved",
        source: "manual",
      },
    });

    expect(post.userId).toBe("target-user-1");
    expect(post.ownerId).toBe("target-user-1");
    expect(post.authorId).toBe("target-user-1");
    expect(post.creatorId).toBe("target-user-1");
    expect(post.createdBy).toBe("target-user-1");
    expect(post.postedBy).toBe("target-user-1");
    expect(post.userHandle).toBe("targethandle");
    expect(post.userName).toBe("Target User");
    expect(post.userPic).toBe("https://cdn.example/target.jpg");
  });

  it("flags the post as a reel and persists editProject when a timeline project is present", () => {
    const editProject = {
      version: 2,
      schemaVersion: 2,
      targetFormat: { width: 1080, height: 1920, fps: 30 },
      tracks: [
        {
          id: "track-media-1",
          type: "media",
          clips: [{ clipId: "c1", type: "video", uri: "file://v.mp4", startMs: 0, durationMs: 4000 }],
        },
      ],
    };
    const post = buildNativePostDocument(makeBaseInput({ editProject }));
    expect(post.reel).toBe(true);
    expect(post.editProject).toEqual(editProject);
  });

  it("does not flag regular posts (no editProject) as reels", () => {
    const post = buildNativePostDocument(makeBaseInput());
    expect(post.reel).toBeUndefined();
    expect(post.editProject).toBeUndefined();
  });

  it("does not flag as a reel when editProject is an empty object", () => {
    const post = buildNativePostDocument(makeBaseInput({ editProject: {} }));
    expect(post.reel).toBeUndefined();
    expect(post.editProject).toBeUndefined();
  });
});
