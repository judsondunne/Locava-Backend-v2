import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { buildNativePostDocument } from "./buildPostDocument.js";

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
});
