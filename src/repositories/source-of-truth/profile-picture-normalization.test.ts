import { describe, expect, it } from "vitest";
import { resolveProfilePicture } from "./profile-firestore.adapter.js";

describe("resolveProfilePicture", () => {
  it("normalizes profile picture when only size-specific paths exist", () => {
    const resolved = resolveProfilePicture({
      profilePicSmallPath: "https://cdn.example.com/p-small.jpg",
      profilePicMediumPath: "https://cdn.example.com/p-medium.jpg",
      profilePicLargePath: "https://cdn.example.com/p-large.jpg"
    });
    expect(resolved.url).toBe("https://cdn.example.com/p-large.jpg");
    expect(resolved.profilePicSmallPath).toBe("https://cdn.example.com/p-small.jpg");
    expect(resolved.profilePicLargePath).toBe("https://cdn.example.com/p-large.jpg");
  });
});
