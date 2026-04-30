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
});
