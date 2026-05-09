import { afterEach, describe, expect, it, vi } from "vitest";
import * as firestoreClient from "../../repositories/source-of-truth/firestore-client.js";
import {
  buildLegacyExpoPushPayload,
  collectExponentPushTokenTargets,
  inferPushTargetType,
  legacyNotificationPushPublisher,
} from "./legacy-notification-push.publisher.js";

describe("legacy notification push publisher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
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

  it("merges routing meta into stringified data for client dedupe and tap routing", () => {
    const payload = buildLegacyExpoPushPayload(
      {
        senderUserId: "actor-7",
        type: "like",
        message: "liked your post.",
        postId: "post-9",
      },
      { senderName: "Actor" },
      { notificationId: "notif-doc-1", recipientUserId: "recipient-1" },
    );
    const data = payload.data as Record<string, string>;
    expect(data.notificationId).toBe("notif-doc-1");
    expect(data.recipientUserId).toBe("recipient-1");
    expect(data.targetType).toBe("post");
    expect(data.routeIntent).toBe("/display/display");
  });

  it("collectExponentPushTokenTargets dedupes and prefers scalar first with cap", () => {
    const t1 = "ExponentPushToken[aaa]";
    const t2 = "ExponentPushToken[bbb]";
    const t3 = "ExponentPushToken[ccc]";
    const targets = collectExponentPushTokenTargets(
      {
        expoPushToken: t1,
        expoPushTokens: [t2, t1, t3],
        pushTokens: [t2],
      },
      2,
    );
    expect(targets).toEqual([t1, t2]);
  });

  it("inferPushTargetType classifies like as post and follow as user", () => {
    expect(
      inferPushTargetType({
        senderUserId: "a",
        type: "like",
        message: "x",
        postId: "p",
      }),
    ).toBe("post");
    expect(
      inferPushTargetType({
        senderUserId: "a",
        type: "follow",
        message: "x",
      }),
    ).toBe("user");
    expect(
      inferPushTargetType({
        senderUserId: "a",
        type: "chat",
        message: "x",
        chatId: "c1",
      }),
    ).toBe("chat");
  });

  it("sendToRecipient posts to Expo with mocked fetch and strips DeviceNotRegistered tokens", async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    const docMock = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          expoPushToken: "ExponentPushToken[stale]",
          expoPushTokens: [],
          pushTokens: [],
        }),
      }),
      update: updateMock,
    };
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: () => ({
        doc: () => docMock,
      }),
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: { status: "error", message: "DeviceNotRegistered", details: { error: "DeviceNotRegistered" } },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await legacyNotificationPushPublisher.sendToRecipient({
      notificationId: "nid-1",
      recipientUserId: "user-99",
      notificationData: {
        senderUserId: "actor",
        type: "like",
        message: "liked your post.",
        postId: "post-z",
      },
      senderData: { senderName: "Actor" },
    });

    expect(fetchMock).toHaveBeenCalled();
    const rawBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof rawBody).toBe("string");
    const parsed = JSON.parse(String(rawBody)) as { to: string; data: Record<string, string> };
    expect(parsed.to).toBe("ExponentPushToken[stale]");
    expect(parsed.data.notificationId).toBe("nid-1");
    expect(status.attempted).toBe(true);
    expect(status.success).toBe(false);
    expect(updateMock).toHaveBeenCalled();
  });

  it("sendToRecipient marks success when Expo returns ok ticket", async () => {
    const docMock = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          expoPushToken: "ExponentPushToken[good]",
        }),
      }),
      update: vi.fn(),
    };
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: () => ({
        doc: () => docMock,
      }),
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { status: "ok", id: "ticket-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await legacyNotificationPushPublisher.sendToRecipient({
      notificationId: "nid-2",
      recipientUserId: "user-1",
      notificationData: {
        senderUserId: "actor",
        type: "comment",
        message: "commented on your post.",
        postId: "post-q",
      },
      senderData: null,
    });

    expect(status.success).toBe(true);
  });
});
