import { describe, expect, it } from "vitest";
import { buildLegacyExpoPushPayload } from "./legacy-notification-push.publisher.js";

describe("legacy notification push publisher", () => {
  it("builds legacy post-like push payloads with deep-link route", () => {
    const payload = buildLegacyExpoPushPayload(
      {
        senderUserId: "actor-1",
        type: "like",
        message: "liked your post.",
        postId: "post-1",
        metadata: {
          postTitle: "Waterfall run",
        },
      },
      {
        senderName: "Actor One",
        senderUsername: "actorone",
      },
    );

    expect(payload).toMatchObject({
      title: "Actor One",
      body: "liked your post",
      data: expect.objectContaining({
        type: "like",
        senderUserId: "actor-1",
        postId: "post-1",
        route: "/display/display",
      }),
    });
  });

  it("builds legacy follow payloads with profile route", () => {
    const payload = buildLegacyExpoPushPayload(
      {
        senderUserId: "actor-2",
        type: "follow",
        message: "followed you.",
        targetUserId: "actor-2",
      },
      {
        senderName: "Actor Two",
      },
    );

    expect(payload).toMatchObject({
      title: "Actor Two",
      body: "followed you",
      data: expect.objectContaining({
        route: "/userDisplay?userId=actor-2",
        profileUserId: "actor-2",
      }),
    });
  });

  it("builds legacy chat payloads with chat route", () => {
    const payload = buildLegacyExpoPushPayload(
      {
        senderUserId: "actor-3",
        type: "chat",
        message: "From River Crew: hello",
        chatId: "chat-1",
        metadata: {
          groupName: "River Crew",
        },
      },
      {
        senderName: "Actor Three",
      },
    );

    expect(payload).toMatchObject({
      title: "Actor Three",
      body: "From River Crew: hello",
      data: expect.objectContaining({
        route: "/chat/chatScreen",
        chatId: "chat-1",
        type: "chat",
      }),
    });
  });

  it("adds rich attachment fields for post-related notifications", () => {
    const payload = buildLegacyExpoPushPayload(
      {
        senderUserId: "actor-4",
        type: "post",
        message: "just posted!",
        postId: "post-2",
        metadata: {
          thumbnailUrl: "https://cdn.example.com/post-thumb.jpg",
        },
      },
      {
        senderName: "Actor Four",
      },
    );

    expect(payload).toMatchObject({
      title: "Actor Four",
      body: "just posted!",
      mutableContent: true,
      richContent: { image: "https://cdn.example.com/post-thumb.jpg" },
      data: expect.objectContaining({
        imageUrl: "https://cdn.example.com/post-thumb.jpg",
      }),
    });
    expect((payload.data as Record<string, unknown>)._richContent).toBe(
      JSON.stringify({ image: "https://cdn.example.com/post-thumb.jpg" }),
    );
  });

  it("adds rich attachment fields for people-based notifications", () => {
    const payload = buildLegacyExpoPushPayload(
      {
        senderUserId: "actor-5",
        type: "follow",
        message: "followed you.",
        targetUserId: "viewer-1",
        metadata: {
          imageUrl: "https://cdn.example.com/profile.jpg",
        },
      },
      {
        senderName: "Actor Five",
      },
    );

    expect(payload).toMatchObject({
      mutableContent: true,
      richContent: { image: "https://cdn.example.com/profile.jpg" },
      data: expect.objectContaining({
        imageUrl: "https://cdn.example.com/profile.jpg",
      }),
    });
  });

  it("does not add rich attachment fields for notifications without image context", () => {
    const payload = buildLegacyExpoPushPayload(
      {
        senderUserId: "actor-6",
        type: "system",
        message: "System message",
      },
      null,
    );

    expect(payload).not.toHaveProperty("mutableContent");
    expect(payload).not.toHaveProperty("richContent");
    expect((payload.data as Record<string, unknown>).imageUrl).toBeUndefined();
  });
});
