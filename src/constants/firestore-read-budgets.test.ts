import { describe, expect, it } from "vitest";
import {
  NEAR_ME_COLD_MAX_DOCS,
  NOTIFICATIONS_LIST_MAX_DOCS,
  REEL_POOL_COLD_MAX_DOCS,
  TOP_ACTIVITIES_COLD_FALLBACK_MAX_DOCS,
} from "./firestore-read-budgets.js";

describe("firestore read budgets", () => {
  it("keeps containment ceilings stable", () => {
    expect(NOTIFICATIONS_LIST_MAX_DOCS).toBe(30);
    expect(NEAR_ME_COLD_MAX_DOCS).toBe(120);
    expect(REEL_POOL_COLD_MAX_DOCS).toBe(50);
    expect(TOP_ACTIVITIES_COLD_FALLBACK_MAX_DOCS).toBe(50);
  });
});
