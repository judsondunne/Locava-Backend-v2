import { describe, expect, it, vi } from "vitest";
import { wasabiPublicUrlForKey } from "../storage/wasabi-config.js";
import { LAB_ARTIFACT_KEYS, videosLabKeyPrefix } from "./video-post-encoding.pipeline.js";
import {
  normalizeVideoLabPostFolder,
  repairVideosLabDoublePostPrefixUrlsDeep
} from "./normalizeVideoLabPostFolder.js";

const { headObjectExistsMock } = vi.hoisted(() => ({
  headObjectExistsMock: vi.fn()
}));

vi.mock("../storage/wasabi-staging.service.js", () => ({
  headObjectExists: (...args: unknown[]) => headObjectExistsMock(...args)
}));

describe("normalizeVideoLabPostFolder", () => {
  it('maps bare id to "post_" prefix', () => {
    expect(normalizeVideoLabPostFolder("71abc")).toBe("post_71abc");
  });

  it('keeps a single "post_" prefix', () => {
    expect(normalizeVideoLabPostFolder("post_71abc")).toBe("post_71abc");
  });

  it("collapses legacy double post_ prefix", () => {
    expect(normalizeVideoLabPostFolder("post_post_71abc")).toBe("post_71abc");
  });

  it("collapses repeated double prefixes", () => {
    expect(normalizeVideoLabPostFolder("post_post_post_71abc")).toBe("post_71abc");
  });
});

describe("videosLabKeyPrefix (fast-start lab paths)", () => {
  const assetId = "video_32394e7316_ffba62da82_0";

  it("never emits post_post_ when post id already has post_", () => {
    const postId = "post_71efc895b5108179";
    const prefix = videosLabKeyPrefix(postId, assetId);
    expect(prefix).not.toContain("post_post_");
    expect(prefix).toBe(`videos-lab/post_71efc895b5108179/${assetId}`);
  });

  it("uses one normalized post folder for poster + ladder variant keys", () => {
    const cfg = {
      accessKeyId: "a",
      secretAccessKey: "s",
      region: "us-east-1",
      endpoint: "https://s3.us-east-1.wasabisys.com",
      bucketName: "locava.app"
    };
    const postId = "post_71abc";
    const prefix = videosLabKeyPrefix(postId, assetId);
    const variantKeys = [
      "posterHigh",
      "startup540FaststartAvc",
      "startup720FaststartAvc",
      "preview360Avc",
      "main720Avc"
    ] as const;
    const folders = new Set<string>();
    for (const k of variantKeys) {
      const suffix = LAB_ARTIFACT_KEYS[k];
      const url = wasabiPublicUrlForKey(cfg, `${prefix}/${suffix}`);
      expect(url).not.toContain("post_post_");
      const m = url.match(/\/videos-lab\/(post_[^/]+)\//);
      expect(m?.[1]).toBeTruthy();
      folders.add(m![1]!);
    }
    expect(folders.size).toBe(1);
    expect([...folders][0]).toBe("post_71abc");
  });
});

describe("repairVideosLabDoublePostPrefixUrlsDeep", () => {
  const cfg = {
    accessKeyId: "a",
    secretAccessKey: "s",
    region: "us-east-1",
    endpoint: "https://s3.us-east-1.wasabisys.com",
    bucketName: "locava.app"
  };

  it("rewrites post_post_ URL when normalized object exists", async () => {
    headObjectExistsMock.mockResolvedValue(true);
    const bad =
      "https://s3.us-east-1.wasabisys.com/locava.app/videos-lab/post_post_71abc/video_x_0/startup720_faststart_avc.mp4";
    const good =
      "https://s3.us-east-1.wasabisys.com/locava.app/videos-lab/post_71abc/video_x_0/startup720_faststart_avc.mp4";
    const { value, warnings } = await repairVideosLabDoublePostPrefixUrlsDeep(cfg, { u: bad });
    expect(value.u).toBe(good);
    expect(warnings).toEqual([]);
    expect(headObjectExistsMock).toHaveBeenCalled();
  });

  it("keeps post_post_ URL and warns when normalized object is missing", async () => {
    headObjectExistsMock.mockResolvedValue(false);
    const bad =
      "https://s3.us-east-1.wasabisys.com/locava.app/videos-lab/post_post_71abc/video_x_0/startup720_faststart_avc.mp4";
    const { value, warnings } = await repairVideosLabDoublePostPrefixUrlsDeep(cfg, { u: bad });
    expect(value.u).toBe(bad);
    expect(warnings).toContain("legacy_double_post_prefix_url");
  });
});
