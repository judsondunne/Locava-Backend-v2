import { describe, expect, it } from "vitest";
import { buildPostEnvelope } from "./post-envelope.js";

describe("buildPostEnvelope", () => {
  it("preserves playable video variants separately from poster art", () => {
    const envelope = buildPostEnvelope({
      postId: "video-post-1",
      hydrationLevel: "card",
      seed: {
        postId: "video-post-1",
        rankToken: "rank-video-1",
        author: { userId: "u1", handle: "video.author", name: "Video Author", pic: "https://cdn.example.com/u1.jpg" },
        media: {
          type: "video",
          posterUrl: "https://cdn.example.com/poster.jpg",
          aspectRatio: 9 / 16,
          startupHint: "poster_then_preview",
        },
        social: { likeCount: 4, commentCount: 1 },
        viewer: { liked: false, saved: false },
        createdAtMs: 1,
        updatedAtMs: 2,
      },
      sourcePost: {
        postId: "video-post-1",
        userId: "u1",
        userHandle: "video.author",
        userName: "Video Author",
        userPic: "https://cdn.example.com/u1.jpg",
        mediaType: "video",
        displayPhotoLink: "https://cdn.example.com/poster.jpg",
        comments: [
          {
            commentId: "c1",
            content: "great post",
            userId: "u2",
            userName: "Commenter",
            userPic: "https://cdn.example.com/u2.jpg",
            time: 10,
          },
        ],
        assets: [
          {
            id: "asset-video-1",
            type: "video",
            original: "https://cdn.example.com/original.mp4",
            poster: "https://cdn.example.com/poster.jpg",
            variants: {
              hls: "https://cdn.example.com/master.m3u8",
              main720Avc: "https://cdn.example.com/main720-avc.mp4",
              preview360: "https://cdn.example.com/preview360.mp4",
              poster: "https://cdn.example.com/poster.jpg",
            },
          },
        ],
      },
      rawPost: {
        firestoreShape: true,
        nested: { keep: "me" },
      },
      sourceRoute: "test.video",
    });

    const first = (envelope.assets as Array<Record<string, unknown>>)[0];
    expect(first?.streamUrl).toBe("https://cdn.example.com/master.m3u8");
    expect(first?.mp4Url).toBe("https://cdn.example.com/main720-avc.mp4");
    expect(first?.posterUrl).toBe("https://cdn.example.com/poster.jpg");
    expect(first?.streamUrl).not.toBe(first?.posterUrl);
    expect(envelope.hasPlayableVideo).toBe(true);
    expect((envelope.commentsPreview as Array<Record<string, unknown>>)[0]).toMatchObject({
      content: "great post",
      userName: "Commenter",
      userPic: "https://cdn.example.com/u2.jpg",
    });
    expect((envelope.rawPost as Record<string, unknown>).firestoreShape).toBe(true);
    expect((envelope.sourcePost as Record<string, unknown>).postId).toBe("video-post-1");
  });

  it("preserves image gradients, geo, and embedded comments on non-video posts", () => {
    const envelope = buildPostEnvelope({
      postId: "image-post-1",
      hydrationLevel: "detail",
      seed: {
        postId: "image-post-1",
        rankToken: "rank-image-1",
        author: { userId: "u9", handle: "image.author", name: "Image Author", pic: null },
        media: {
          type: "image",
          posterUrl: "https://cdn.example.com/lg.jpg",
          aspectRatio: 1.2,
          startupHint: "poster_only",
        },
        social: { likeCount: 9, commentCount: 2 },
        viewer: { liked: true, saved: false },
        createdAtMs: 5,
        updatedAtMs: 6,
      },
      sourcePost: {
        postId: "image-post-1",
        mediaType: "image",
        address: "Easton, PA",
        lat: 40.69,
        long: -75.21,
        letterboxGradients: [{ top: "#123456", bottom: "#654321" }],
        assets: [
          {
            id: "asset-image-1",
            type: "image",
            variants: {
              lg: "https://cdn.example.com/lg.jpg",
              md: "https://cdn.example.com/md.jpg",
              sm: "https://cdn.example.com/sm.jpg",
            },
          },
          {
            id: "asset-image-2",
            type: "image",
            original: "https://cdn.example.com/2.jpg",
          },
        ],
        comments: [
          { commentId: "c1", text: "hi", userId: "u2", userName: "One", userPic: "https://cdn.example.com/one.jpg", time: 1 },
          { commentId: "c2", content: "there", userId: "u3", userName: "Two", userPic: "https://cdn.example.com/two.jpg", time: 2 },
        ],
      },
      rawPost: { persisted: true },
      sourceRoute: "test.image",
    });

    expect(Array.isArray(envelope.assets)).toBe(true);
    expect((envelope.assets as Array<Record<string, unknown>>)).toHaveLength(2);
    expect(envelope.address).toBe("Easton, PA");
    expect(envelope.lat).toBe(40.69);
    expect(envelope.long).toBe(-75.21);
    expect((envelope.letterboxGradients as Array<Record<string, unknown>>)[0]).toMatchObject({
      top: "#123456",
      bottom: "#654321",
    });
    expect((envelope.commentsPreview as Array<Record<string, unknown>>)).toHaveLength(2);
    expect(envelope.hasEmbeddedComments).toBe(true);
    expect((envelope.rawPost as Record<string, unknown>).persisted).toBe(true);
  });

  it("hydrates legacy photoLink-only posts into openable assets", () => {
    const envelope = buildPostEnvelope({
      postId: "legacy-photo-1",
      hydrationLevel: "card",
      seed: {
        postId: "legacy-photo-1",
        rankToken: "rank-legacy-1",
        author: { userId: "u7", handle: "legacy.author", name: null, pic: null },
        media: {
          type: "image",
          posterUrl: "https://cdn.example.com/legacy.jpg",
          aspectRatio: 1,
          startupHint: "poster_only",
        },
        social: { likeCount: 0, commentCount: 0 },
        viewer: { liked: false, saved: false },
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      sourcePost: {
        postId: "legacy-photo-1",
        photoLink: "https://cdn.example.com/legacy.jpg",
      },
      sourceRoute: "test.legacy",
    });

    const first = (envelope.assets as Array<Record<string, unknown>>)[0];
    expect(first?.originalUrl).toBe("https://cdn.example.com/legacy.jpg");
    expect(first?.posterUrl).toBe("https://cdn.example.com/legacy.jpg");
    expect(envelope.firstAssetUrl).toBe("https://cdn.example.com/legacy.jpg");
  });

  it("keeps marker envelopes lightweight without pretending they contain raw detail", () => {
    const envelope = buildPostEnvelope({
      postId: "marker-only-1",
      hydrationLevel: "marker",
      seed: {
        postId: "marker-only-1",
        rankToken: "rank-marker-1",
        author: { userId: "u5", handle: "marker.author", name: null, pic: null },
        media: {
          type: "image",
          posterUrl: "https://cdn.example.com/marker.jpg",
          aspectRatio: 1,
          startupHint: "poster_only",
        },
        social: { likeCount: 0, commentCount: 0 },
        viewer: { liked: false, saved: false },
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      sourcePost: {
        postId: "marker-only-1",
        thumbUrl: "https://cdn.example.com/marker.jpg",
        mediaType: "image",
      },
      sourceRoute: "test.marker",
    });

    expect(envelope.hydrationLevel).toBe("marker");
    expect(envelope.hasRawPost).toBe(false);
    expect(envelope.rawPost).toBeNull();
    expect(envelope.sourcePost).toBeNull();
    expect((envelope.assets as Array<Record<string, unknown>>)[0]?.posterUrl).toBe("https://cdn.example.com/marker.jpg");
  });
});
