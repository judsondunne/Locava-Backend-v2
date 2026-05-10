import { describe, expect, it } from "vitest";
import { applyCanonicalRoutingOnLegacyNotificationDoc } from "./notifications.repository.js";

describe("applyCanonicalRoutingOnLegacyNotificationDoc", () => {
  it("adds post routeIntent for post_like and preserves postId", () => {
    const doc: Record<string, unknown> = {
      type: "post_like",
      postId: "post-99",
      senderUserId: "actor-1",
    };
    applyCanonicalRoutingOnLegacyNotificationDoc(doc, {
      type: "post_like",
      actorId: "actor-1",
      targetId: "post-99",
    });
    expect(doc.targetType).toBe("post");
    expect(doc.targetId).toBe("post-99");
    expect(doc.routeIntent).toEqual({ targetType: "post", postId: "post-99", targetId: "post-99" });
  });

  it("adds user routeIntent for new_follower", () => {
    const doc: Record<string, unknown> = {
      type: "new_follower",
      senderUserId: "actor-2",
    };
    applyCanonicalRoutingOnLegacyNotificationDoc(doc, {
      type: "new_follower",
      actorId: "actor-2",
      targetId: "actor-2",
    });
    expect(doc.targetType).toBe("user");
    expect(doc.routeIntent).toEqual({ targetType: "user", userId: "actor-2", targetId: "actor-2" });
  });

  it("adds chat routeIntent for dm", () => {
    const doc: Record<string, unknown> = {
      type: "dm",
      chatId: "chat-77",
    };
    applyCanonicalRoutingOnLegacyNotificationDoc(doc, {
      type: "dm",
      actorId: "actor-3",
      targetId: "chat-77",
    });
    expect(doc.targetType).toBe("chat");
    expect(doc.routeIntent).toEqual({ targetType: "chat", chatId: "chat-77", targetId: "chat-77" });
  });
});
