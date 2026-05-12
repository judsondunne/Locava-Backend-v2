import { describe, expect, it } from "vitest";
import { NotificationsListQuerySchema } from "./notifications-list.contract.js";

describe("notifications list contract", () => {
  it("clamps query limit to max 30", () => {
    const parsed = NotificationsListQuerySchema.parse({ limit: "99" });
    expect(parsed.limit).toBe(30);
  });

  it("defaults limit to 20", () => {
    const parsed = NotificationsListQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
  });
});
