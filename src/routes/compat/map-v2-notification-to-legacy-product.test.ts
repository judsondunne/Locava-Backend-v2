import { describe, expect, it } from "vitest";
import { mapV2NotificationRowToLegacyProductItem } from "./map-v2-notification-to-legacy-product.js";

describe("mapV2NotificationRowToLegacyProductItem", () => {
  it("maps readState and preview to legacy read/message/timestamp", () => {
    const row = mapV2NotificationRowToLegacyProductItem(
      {
        notificationId: "n1",
        type: "like",
        actorId: "u_actor",
        actor: { userId: "u_actor", handle: "actor", name: "Actor", pic: "https://cdn.example/p.jpg" },
        targetId: "post_1",
        createdAtMs: 1_700_000_000_000,
        readState: "unread",
        preview: { text: "liked your post", thumbUrl: "https://cdn.example/t.jpg" }
      },
      0
    );
    expect(row.read).toBe(false);
    expect(row.seen).toBe(false);
    expect(row.message).toBe("liked your post");
    expect(row.timestamp).toBe(1_700_000_000);
    expect(row.postId).toBe("post_1");
    expect((row.metadata as Record<string, unknown>)?.postThumbUrl).toBe("https://cdn.example/t.jpg");
  });

  it("maps follow type without postId", () => {
    const row = mapV2NotificationRowToLegacyProductItem(
      {
        notificationId: "n2",
        type: "follow",
        actorId: "u_follower",
        actor: { userId: "u_follower", handle: "f", name: "F", pic: null },
        targetId: "u_follower",
        createdAtMs: 1_700_000_100_000,
        readState: "read",
        preview: { text: "started following you", thumbUrl: null }
      },
      0
    );
    expect(row.read).toBe(true);
    expect(row.postId).toBeUndefined();
  });
});
