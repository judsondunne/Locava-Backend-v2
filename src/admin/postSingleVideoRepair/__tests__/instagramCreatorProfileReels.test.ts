import { describe, expect, it } from "vitest";
import {
  buildReelsSummaryFromInstagramCreatorProfile,
  findReelRowForInstagramShortcode,
  findReelRowForLocavaPostId,
  isInstagramOrMetaCdnUrl,
  pickPlaybackUrlFromReelRow
} from "../instagramCreatorProfileReels.js";

describe("buildReelsSummaryFromInstagramCreatorProfile", () => {
  it("merges wasabiByShortcode with case-insensitive shortcode key", () => {
    const data = {
      reels: [{ shortcode: "AbC", videoUrl: "https://cdninstagram.com/x.mp4" }],
      ingest: {
        wasabiByShortcode: {
          abc: { url: "https://s3.wasabisys.com/bucket/file.mp4" }
        }
      }
    };
    const rows = buildReelsSummaryFromInstagramCreatorProfile(data);
    expect(rows[0]?.wasabiUrl).toBe("https://s3.wasabisys.com/bucket/file.mp4");
  });

  it("merges ingest.wasabiByShortcode.url into wasabiUrl", () => {
    const data = {
      reels: [{ shortcode: "ABC", videoUrl: "https://cdn.example/old.mp4" }],
      ingest: {
        wasabiByShortcode: {
          ABC: { url: "https://s3.wasabisys.com/bucket/new.mp4" }
        }
      }
    };
    const rows = buildReelsSummaryFromInstagramCreatorProfile(data);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.wasabiUrl).toBe("https://s3.wasabisys.com/bucket/new.mp4");
    expect(pickPlaybackUrlFromReelRow(rows[0])).toBe("https://s3.wasabisys.com/bucket/new.mp4");
  });
});

describe("pickPlaybackUrlFromReelRow", () => {
  it("does not use Instagram CDN videoUrl when wasabi is absent", () => {
    const row = {
      shortcode: "x",
      instagramUrl: null,
      title: null,
      caption: null,
      posterUrl: null,
      videoUrl: "https://scontent.cdninstagram.com/foo.mp4",
      wasabiUrl: null,
      method: null,
      connectionDraft: null
    };
    expect(pickPlaybackUrlFromReelRow(row)).toBeNull();
    expect(isInstagramOrMetaCdnUrl(row.videoUrl)).toBe(true);
  });

  it("does not use non-IG videoUrl when wasabi missing (Wasabi-only playback)", () => {
    const row = {
      shortcode: "x",
      instagramUrl: null,
      title: null,
      caption: null,
      posterUrl: null,
      videoUrl: "https://files.example.com/reel.mp4",
      wasabiUrl: null,
      method: null,
      connectionDraft: null
    };
    expect(pickPlaybackUrlFromReelRow(row)).toBeNull();
  });
});

describe("findReelRowForInstagramShortcode", () => {
  it("matches case-insensitively", () => {
    const rows = [
      {
        shortcode: "DWPnII7RQ8C",
        instagramUrl: null,
        title: null,
        caption: null,
        posterUrl: null,
        videoUrl: null,
        wasabiUrl: "https://s3.wasabisys.com/x.mp4",
        method: null,
        connectionDraft: null
      }
    ];
    expect(findReelRowForInstagramShortcode(rows, "dwpnii7rq8c")?.wasabiUrl).toBe("https://s3.wasabisys.com/x.mp4");
  });
});

describe("findReelRowForLocavaPostId", () => {
  it("finds reel when wasabi path contains post id (bare Firestore doc id matches videos-lab/post_<id>/…)", () => {
    const docId = "QFawZvNe38NmKBLOe2NL";
    const labSeg = `post_${docId}`;
    const rows = [
      {
        shortcode: "x",
        instagramUrl: null,
        title: null,
        caption: null,
        posterUrl: `https://s3.wasabisys.com/locava.app/videos-lab/${labSeg}/v/poster_high.jpg`,
        videoUrl: null,
        wasabiUrl: `https://s3.wasabisys.com/locava.app/videos-lab/${labSeg}/v/original.mp4`,
        method: null,
        connectionDraft: null
      }
    ];
    const hit = findReelRowForLocavaPostId(rows, docId);
    expect(hit?.wasabiUrl).toContain(labSeg);
  });
});
