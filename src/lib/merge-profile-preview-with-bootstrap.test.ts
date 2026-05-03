import { describe, expect, it } from "vitest";
import { mergeProfilePreviewWithBootstrap } from "./merge-profile-preview-with-bootstrap.js";

describe("mergeProfilePreviewWithBootstrap", () => {
  it("prefers bootstrap avatar and counts over empty preview placeholders", () => {
    const merged = mergeProfilePreviewWithBootstrap(
      {
        handle: "chat",
        name: "Chat Name",
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
      },
      {
        handle: "real",
        name: "Real Name",
        profilePic: "https://cdn.example.com/bootstrap.jpg",
        followersCount: 12,
        followingCount: 5,
        postsCount: 40,
      }
    );
    expect(merged.profilePic).toBe("https://cdn.example.com/bootstrap.jpg");
    expect(merged.followersCount).toBe(12);
    expect(merged.postsCount).toBe(40);
  });

  it("does not let preview zero counts beat bootstrap non-zero counts", () => {
    const merged = mergeProfilePreviewWithBootstrap(
      { followersCount: 0, postsCount: 0 },
      { followersCount: 3, postsCount: 10 }
    );
    expect(merged.followersCount).toBe(3);
    expect(merged.postsCount).toBe(10);
  });
});
