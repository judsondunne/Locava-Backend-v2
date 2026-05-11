import { describe, expect, it } from "vitest";
import {
  computeDuplicatePairs,
  summarizePostVideoPlayback,
  type UserPostLight
} from "../userPostDuplicatesScan.service.js";

describe("computeDuplicatePairs", () => {
  it("finds same lat/lng and same title", () => {
    const posts: UserPostLight[] = [
      { postId: "post_a", title: "Run", lat: 1, lng: 2 },
      { postId: "post_b", title: "Run", lat: 1, lng: 2 },
      { postId: "post_c", title: "Other", lat: 9, lng: 9 }
    ];
    const m = computeDuplicatePairs(posts);
    expect(m.size).toBe(1);
    const row = [...m.values()][0]!;
    expect(row.postIdA).toBe("post_a");
    expect(row.postIdB).toBe("post_b");
    expect(row.reasons).toContain("same_lat_lng");
    expect(row.reasons).toContain("same_title");
    expect(row.sharedTitle).toBe("Run");
    expect(row.sharedLatLng).toEqual({ lat: 1, lng: 2 });
  });

  it("ignores empty titles for title dupes", () => {
    const posts: UserPostLight[] = [
      { postId: "post_a", title: "", lat: 1, lng: 1 },
      { postId: "post_b", title: "", lat: 2, lng: 2 }
    ];
    expect(computeDuplicatePairs(posts).size).toBe(0);
  });

  it("summarizePostVideoPlayback reads defaultUrl and hasAudio", () => {
    const raw = {
      media: {
        assets: [
          {
            id: "a1",
            type: "video",
            hasAudio: false,
            video: {
              playback: { defaultUrl: "https://cdn.example/clip.mp4" }
            }
          }
        ]
      }
    };
    const s = summarizePostVideoPlayback(raw);
    expect(s.hasVideoAsset).toBe(true);
    expect(s.defaultPlaybackUrl).toBe("https://cdn.example/clip.mp4");
    expect(s.hasAudio).toBe(false);
  });

  it("summarizePostVideoPlayback infers audio from codecs.audio none", () => {
    const raw = {
      assets: [
        {
          id: "v0",
          type: "video",
          codecs: { audio: "none" },
          video: { playback: { defaultUrl: "https://x/y.mp4" } }
        }
      ]
    };
    const s = summarizePostVideoPlayback(raw);
    expect(s.hasAudio).toBe(false);
    expect(s.defaultPlaybackUrl).toBe("https://x/y.mp4");
  });

  it("emits multiple pairs for three same-title posts", () => {
    const posts: UserPostLight[] = [
      { postId: "post_1", title: "X", lat: null, lng: null },
      { postId: "post_2", title: "X", lat: null, lng: null },
      { postId: "post_3", title: "X", lat: null, lng: null }
    ];
    const m = computeDuplicatePairs(posts);
    expect(m.size).toBe(3);
  });
});
