import { describe, expect, it } from "vitest";
import { NotificationsRepository } from "../../../repositories/surfaces/notifications.repository.js";

describe("seed likes notification suppression", () => {
  it("does not create notifications when suppressNotification is set", async () => {
    const repository = new NotificationsRepository();
    const result = await repository.createFromMutation({
      type: "like",
      actorId: "seed-user-1",
      targetId: "post-1",
      recipientUserId: "author-1",
      metadata: { suppressNotification: true }
    });
    expect(result.created).toBe(false);
    expect(result.notificationId).toBeNull();
  });

  it("does not create notifications when seeded metadata is set", async () => {
    const repository = new NotificationsRepository();
    const result = await repository.createFromMutation({
      type: "like",
      actorId: "seed-user-1",
      targetId: "post-1",
      recipientUserId: "author-1",
      metadata: { seeded: true }
    });
    expect(result.created).toBe(false);
    expect(result.notificationId).toBeNull();
  });
});
