import { describe, expect, it } from "vitest";
import { readPostThumbUrl } from "./post-firestore-projection.js";

describe("post-firestore-projection", () => {
  it("prefers displayPhotoLink for thumbnails", () => {
    expect(
      readPostThumbUrl(
        {
          displayPhotoLink: "https://cdn.example/p.jpg",
          photoLink: "https://other"
        },
        "p1"
      )
    ).toBe("https://cdn.example/p.jpg");
  });
});
