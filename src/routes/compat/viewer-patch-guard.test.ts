import { describe, expect, it } from "vitest";
import { applyViewerPatchGuarded } from "./viewer-patch-guard.js";

describe("viewer patch guard", () => {
  it("ignores generated fallback identity values and blank profilePic", () => {
    const base = {
      userId: "u1",
      handle: "leaf",
      name: "Leaf",
      profilePic: "https://cdn.locava.test/profile.jpg",
      onboardingComplete: true,
      createdAt: null,
      featureFlags: {},
    };
    const next = applyViewerPatchGuarded(base, {
      handle: "user_xe9nUoYB",
      name: "user_xe9nUoYB",
      profilePic: " ",
      settings: { language: "en" },
    });
    expect(next.handle).toBe("leaf");
    expect(next.name).toBe("Leaf");
    expect(next.profilePic).toBe("https://cdn.locava.test/profile.jpg");
    expect(next.settings?.language).toBe("en");
  });
});
