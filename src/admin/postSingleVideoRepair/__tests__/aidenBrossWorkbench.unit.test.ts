import { describe, expect, it } from "vitest";
import {
  buildCreatorReelPreviewsFromReelsSummary,
  extractInstagramShortcodesFromPostDoc,
  proxiedReelPosterLikeWebApp,
  resolveTruncatedAdminVideoUploadAgainstReels
} from "../aidenBrossWorkbench.service.js";
import type { InstagramReelSummaryRow } from "../instagramCreatorProfileReels.js";
import {
  AIDEN_BROSS_DEFAULT_REPAIR_QUEUE,
  AIDEN_BROSS_DEFAULT_REPAIR_QUEUE_ROWS,
  AIDEN_BROSS_REFERENCE_POSTER_URLS,
  postIdFromVideosLabPosterUrl
} from "../aidenBrossWorkbench.constants.js";

describe("postIdFromVideosLabPosterUrl", () => {
  it("parses post id from poster URL", () => {
    expect(
      postIdFromVideosLabPosterUrl(
        "https://s3.wasabisys.com/locava.app/videos-lab/post_QFawZvNe38NmKBLOe2NL/video_1776624194939_0/poster_high.jpg"
      )
    ).toBe("QFawZvNe38NmKBLOe2NL");
  });
  it("parses ids with suffix letters from path", () => {
    expect(
      postIdFromVideosLabPosterUrl(
        "https://s3.wasabisys.com/locava.app/videos-lab/post_XD7UC7GqrWlYIwlMto61/video_1776624220611_0/poster_high.jpg"
      )
    ).toBe("XD7UC7GqrWlYIwlMto61");
  });
  it("every constant URL yields a post id", () => {
    for (const u of AIDEN_BROSS_REFERENCE_POSTER_URLS) {
      expect(postIdFromVideosLabPosterUrl(u)).toMatch(/^[A-Za-z0-9_]{8,64}$/);
    }
  });
});

describe("extractInstagramShortcodesFromPostDoc", () => {
  it("finds shortcode in nested caption string", () => {
    const raw = {
      title: "x",
      assets: [{ poster: "https://www.instagram.com/reel/DWPnII7RQ8C/" }]
    };
    expect(extractInstagramShortcodesFromPostDoc(raw as Record<string, unknown>)).toContain("DWPnII7RQ8C");
  });
});

describe("buildCreatorReelPreviewsFromReelsSummary", () => {
  it("maps each reel with Wasabi-only playback and preserves order", () => {
    const rows: InstagramReelSummaryRow[] = [
      {
        shortcode: "ABC",
        instagramUrl: "https://www.instagram.com/reel/ABC/",
        title: "t1",
        caption: null,
        posterUrl: "https://s3.wasabisys.com/locava.app/x/p1.jpg",
        videoUrl: "https://instagram.fagc2-1.fna.fbcdn.net/o1/v/t2/f2/m.mp4",
        wasabiUrl: "https://s3.wasabisys.com/locava.app/admin/a.mp4",
        method: "ytdlp",
        connectionDraft: null
      },
      {
        shortcode: "XYZ",
        instagramUrl: null,
        title: null,
        caption: null,
        posterUrl: null,
        videoUrl: "https://instagram.fagc2-1.fna.fbcdn.net/v.mp4",
        wasabiUrl: null,
        method: null,
        connectionDraft: null
      }
    ];
    const out = buildCreatorReelPreviewsFromReelsSummary(rows);
    expect(out).toHaveLength(2);
    expect(out[0]!.index).toBe(0);
    expect(out[0]!.wasabiPlaybackUrl).toBe("https://s3.wasabisys.com/locava.app/admin/a.mp4");
    expect(out[0]!.hasWasabi).toBe(true);
    expect(out[0]!.copyLinkUrl).toContain("instagram.com/reel/ABC");
    expect(out[1]!.wasabiPlaybackUrl).toBeNull();
    expect(out[1]!.hasWasabi).toBe(false);
  });
});

describe("AIDEN_BROSS_DEFAULT_REPAIR_QUEUE", () => {
  it("has 13 unique post ids and truncated admin-video-uploads prefixes", () => {
    expect(AIDEN_BROSS_DEFAULT_REPAIR_QUEUE).toHaveLength(13);
    expect(AIDEN_BROSS_DEFAULT_REPAIR_QUEUE_ROWS).toHaveLength(13);
    const ids = new Set(AIDEN_BROSS_DEFAULT_REPAIR_QUEUE.map((r) => r.postId));
    expect(ids.size).toBe(13);
    for (let i = 0; i < AIDEN_BROSS_DEFAULT_REPAIR_QUEUE_ROWS.length; i++) {
      const row = AIDEN_BROSS_DEFAULT_REPAIR_QUEUE_ROWS[i]!;
      const parsed = postIdFromVideosLabPosterUrl(row.referencePosterUrl);
      expect(parsed).toBe(AIDEN_BROSS_DEFAULT_REPAIR_QUEUE[i]!.postId);
      expect(row.newOriginalUrl).toContain("admin-video-uploads/");
      expect(row.newOriginalUrl).toMatch(/\.\.\.$/);
    }
  });
});

describe("resolveTruncatedAdminVideoUploadAgainstReels", () => {
  it("resolves truncated prefix to longest matching reel Wasabi URL", () => {
    const full =
      "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635702048_8bjzg5qa4b.mp4";
    const reels = [
      {
        shortcode: "x",
        instagramUrl: null,
        title: null,
        caption: null,
        posterUrl: null,
        videoUrl: null,
        wasabiUrl: full,
        method: null,
        connectionDraft: null
      }
    ];
    const r = resolveTruncatedAdminVideoUploadAgainstReels({
      postId: "QFawZvNe38NmKBLOe2NL",
      newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635702048_8b...",
      reelsSummary: reels
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe(full);
  });

  it("passes through complete https .mp4 without ellipsis", () => {
    const u = "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635702048_8bjzg5qa4b.mp4";
    const r = resolveTruncatedAdminVideoUploadAgainstReels({
      postId: "QFawZvNe38NmKBLOe2NL",
      newOriginalUrl: u,
      reelsSummary: []
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe(u);
  });
});

describe("proxiedReelPosterLikeWebApp", () => {
  it("proxies instagram CDN poster", () => {
    const u = "https://instagram.fagc2-1.fna.fbcdn.net/v/t51.71878-15/x.jpg";
    const p = proxiedReelPosterLikeWebApp(u);
    expect(p).toContain("locava.app/api/instagram-reel/file");
    expect(p).toContain(encodeURIComponent(u));
  });
  it("passes through wasabi poster", () => {
    const u = "https://s3.wasabisys.com/locava.app/b/p.jpg";
    expect(proxiedReelPosterLikeWebApp(u)).toBe(u);
  });
});
