import { describe, expect, it } from "vitest";
import type { MasterPostAssetV2, MasterPostV2 } from "../../../contracts/master-post-v2.types.js";
import {
  analyzeVideoAssetPlaybackReadiness,
  compactCanonicalPostForLiveWrite,
  evaluatePostRebuildReadiness,
  isCompactCanonicalPostV2
} from "./compactCanonicalPostV2.js";

function videoPlaybackUrls(u: string) {
  return {
    defaultUrl: u,
    primaryUrl: u,
    startupUrl: u,
    highQualityUrl: u,
    upgradeUrl: u,
    hlsUrl: null as string | null,
    fallbackUrl: "https://cdn.example/orig.mp4",
    previewUrl: null as string | null
  };
}

function videoAsset(playbackReady: boolean, faststartVerified: boolean): MasterPostAssetV2 {
  const u = "https://cdn.example/startup720_faststart_avc.mp4";
  return {
    id: "va1",
    index: 0,
    type: "video",
    source: {
      kind: "assets",
      originalAssetId: "va1",
      primarySources: [],
      legacySourcesConsidered: [],
      legacyVariantUrlsMerged: false
    },
    image: null,
    video: {
      originalUrl: "https://cdn.example/orig.mp4",
      posterUrl: null,
      posterHighUrl: null,
      playback: videoPlaybackUrls(u),
      variants: {
        startup720FaststartAvc: u,
        startup540FaststartAvc: "https://cdn.example/startup540_faststart_avc.mp4"
      },
      durationSec: 12,
      hasAudio: true,
      codecs: null,
      technical: { sourceCodec: "h264", playbackCodec: "h264", audioCodec: "aac" },
      bitrateKbps: 2000,
      sizeBytes: 1_000_000,
      readiness: {
        assetsReady: true,
        instantPlaybackReady: playbackReady,
        faststartVerified: faststartVerified,
        processingStatus: "ready"
      }
    },
    presentation: { letterboxGradient: null }
  };
}

function baseCanonical(overrides: Partial<MasterPostV2> = {}): MasterPostV2 {
  const u = "https://cdn.example/startup720_faststart_avc.mp4";
  const asset = videoAsset(true, true);
  const base: MasterPostV2 = {
    id: "p_fixture",
    schema: {
      name: "locava.post",
      version: 2,
      canonicalizedAt: new Date().toISOString(),
      canonicalizedBy: "backend_v2_post_rebuilder",
      sourceShape: "native_posting_v2",
      migrationRunId: null
    },
    lifecycle: {
      status: "active",
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      updatedAt: new Date().toISOString(),
      lastMediaUpdatedAt: null,
      lastUserVisibleAt: null
    },
    author: {
      userId: "u1",
      displayName: "Test",
      handle: "test",
      profilePicUrl: null
    },
    text: {
      title: "Hi",
      caption: "",
      description: "",
      content: "",
      searchableText: "Hi"
    },
    location: {
      coordinates: { lat: 1, lng: 2, geohash: "abc" },
      display: { address: null, name: null, subtitle: null, label: null },
      place: { placeId: null, placeName: null, source: "unknown", precision: "unknown" },
      regions: {
        city: null,
        state: null,
        country: null,
        cityRegionId: null,
        stateRegionId: "sr1",
        countryRegionId: "cr1"
      }
    },
    classification: {
      activities: ["hike"],
      primaryActivity: "hike",
      mediaKind: "video",
      visibility: "public",
      isBoosted: false,
      reel: false,
      settingType: null,
      moderatorTier: null,
      source: "user",
      privacyLabel: null
    },
    media: {
      status: "ready",
      assetsReady: true,
      instantPlaybackReady: true,
      completeness: "complete",
      assetCount: 1,
      rawAssetCount: 1,
      hasMultipleAssets: false,
      primaryAssetId: "va1",
      coverAssetId: "va1",
      assets: [asset],
      presentation: null,
      cover: {
        assetId: "va1",
        type: "video",
        url: u,
        thumbUrl: null,
        posterUrl: null,
        width: null,
        height: null,
        aspectRatio: null,
        gradient: null
      }
    },
    engagement: {
      likeCount: 3,
      commentCount: 1,
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
      likesVersion: 1,
      commentsVersion: 1,
      savesVersion: null,
      showLikes: true,
      showComments: true
    },
    engagementPreview: {
      recentLikers: [],
      recentComments: []
    },
    ranking: { aggregates: { score: 1 }, rollup: null },
    compatibility: {
      photoLink: u,
      displayPhotoLink: u,
      photoLinks2: null,
      photoLinks3: null,
      thumbUrl: "https://cdn.example/thumb.jpg",
      posterUrl: "https://cdn.example/poster.jpg",
      fallbackVideoUrl: "https://cdn.example/orig.mp4",
      mediaType: "video"
    },
    legacy: {
      preserved: true,
      rawFieldNames: ["old"],
      originalMediaFields: {},
      originalEngagementFields: {},
      originalLocationFields: {},
      originalModerationFields: {},
      originalPosterMigration: {}
    },
    audit: {
      canonicalValidationStatus: "valid",
      warnings: [],
      errors: [],
      rebuiltFromRawAt: new Date().toISOString(),
      reversible: true,
      backupDocPath: null
    }
  };
  return { ...base, ...overrides };
}

describe("compactCanonicalPostForLiveWrite", () => {
  it("strips audit/debug/likes from live doc and moves diagnostics; saved shape passes isCompactCanonicalPostV2", () => {
    const canonical = baseCanonical();
    const rawBefore: Record<string, unknown> = {
      ...({
        schema: canonical.schema,
        lifecycle: canonical.lifecycle,
        author: canonical.author
      } as Record<string, unknown>),
      audit: { noise: true },
      normalizationDebug: { merged: [] },
      variantMetadata: { x: 1 },
      playbackLab: {
        lastVerifyResults: [{ ok: true, samples: new Array(500).fill(0) }],
        assets: { a: { lastVerifyResults: [1, 2, 3] } }
      },
      legacy: {
        rawFieldNames: ["a", "b"],
        originalMediaFields: { k: 1 }
      },
      likes: new Array(200).fill(0).map((_, i) => ({ userId: "u" + i })),
      comments: [{ id: "c1" }],
      rankingAggregates: { dup: true },
      rankingRollup: { dup2: true },
      ranking: { aggregates: { score: 1 }, rollup: null },
      userId: "u1",
      thumbUrl: "https://legacy/thumb.jpg"
    };

    const out = compactCanonicalPostForLiveWrite({
      canonical,
      rawBefore,
      postId: "p1"
    });

    expect(out.livePost.audit).toBeUndefined();
    expect(out.livePost.playbackLab).toBeUndefined();
    expect(out.livePost.likes).toBeUndefined();
    expect(out.livePost.legacy).toBeUndefined();
    expect(out.diagnostics.rawPlaybackLab).toBeDefined();
    expect(Array.isArray(out.diagnostics.embeddedLikesSample)).toBe(true);
    expect((out.diagnostics.embeddedLikesSample as unknown[]).length).toBeLessThanOrEqual(5);

    const check = isCompactCanonicalPostV2(out.livePost);
    expect(check.ok).toBe(true);
    expect(check.forbiddenLivePathsPresent.length).toBe(0);
    expect(out.byteEstimateBefore).toBeGreaterThanOrEqual(out.byteEstimateAfter);
  });

  it("already-compact live document is ok and does not need repair", () => {
    const canonical = baseCanonical();
    const rawBefore: Record<string, unknown> = { userId: "u1" };
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore, postId: "p2" });
    const check = isCompactCanonicalPostV2(livePost);
    expect(check.ok).toBe(true);
    expect(check.mediaNeedsRepair).toBe(false);
    expect(check.needsCompaction).toBe(false);
  });

  it("flags mediaNeedsRepair when faststart/instant flags are wrong for startup URL", () => {
    const badAsset = videoAsset(false, false);
    const canonical = baseCanonical({
      media: {
        ...baseCanonical().media,
        assets: [badAsset]
      }
    });
    const { livePost } = compactCanonicalPostForLiveWrite({
      canonical,
      rawBefore: {},
      postId: "p3"
    });
    const check = isCompactCanonicalPostV2(livePost);
    expect(check.mediaNeedsRepair).toBe(true);
    expect(check.ok).toBe(false);
  });

  it("treats compact-shaped video on original mp4 fallback as NOT skip-safe (mediaNeedsRepair)", () => {
    const u = "https://cdn.example/main.mp4";
    const legacyVideo: MasterPostAssetV2 = {
      id: "v_legacy",
      index: 0,
      type: "video",
      source: {
        kind: "media.assets",
        originalAssetId: "v_legacy",
        primarySources: ["media.assets"],
        legacySourcesConsidered: [],
        legacyVariantUrlsMerged: false
      },
      image: null,
      video: {
        originalUrl: u,
        posterUrl: "https://cdn.example/poster.jpg",
        posterHighUrl: null,
        playback: {
          defaultUrl: u,
          primaryUrl: u,
          startupUrl: u,
          highQualityUrl: u,
          upgradeUrl: u,
          hlsUrl: null,
          fallbackUrl: u,
          previewUrl: null
        },
        variants: {},
        durationSec: null,
        hasAudio: null,
        codecs: null,
        technical: { sourceCodec: null, playbackCodec: null, audioCodec: null },
        bitrateKbps: null,
        sizeBytes: null,
        readiness: {
          assetsReady: false,
          instantPlaybackReady: false,
          faststartVerified: false,
          processingStatus: null
        }
      },
      presentation: { letterboxGradient: null, carouselFitWidth: true, resizeMode: "contain" }
    };
    const canonical = baseCanonical({
      media: {
        ...baseCanonical().media,
        assets: [legacyVideo]
      }
    });
    const { livePost } = compactCanonicalPostForLiveWrite({
      canonical,
      rawBefore: {},
      postId: "p_legacy_mp4"
    });
    const check = isCompactCanonicalPostV2(livePost);
    expect(check.compactOk).toBe(true);
    expect(check.mediaNeedsRepair).toBe(true);
    expect(check.videoNeedsFaststart).toBe(true);
    expect(check.canSkipWrite).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.videoIssues.length).toBeGreaterThan(0);
  });

  it("removes embedded likes from live while preserving engagement counts and preview caps", () => {
    const likers = new Array(8).fill(0).map((_, i) => ({
      userId: "u" + i,
      displayName: "N" + i,
      handle: null,
      profilePicUrl: null,
      likedAt: null
    }));
    const comments = new Array(5).fill(0).map((_, i) => ({
      commentId: "c" + i,
      userId: "u1",
      displayName: "A",
      handle: null,
      profilePicUrl: null,
      text: "t",
      createdAt: null,
      replyCount: 0
    }));
    const canonical = baseCanonical({
      engagementPreview: { recentLikers: likers, recentComments: comments as MasterPostV2["engagementPreview"]["recentComments"] }
    });
    const rawBefore: Record<string, unknown> = {
      likes: new Array(50).fill({ userId: "x" })
    };
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore, postId: "p4" });
    expect(livePost.likes).toBeUndefined();
    const ep = livePost.engagementPreview as { recentLikers: unknown[]; recentComments: unknown[] };
    expect(ep.recentLikers.length).toBeLessThanOrEqual(5);
    expect(ep.recentComments.length).toBeLessThanOrEqual(3);
    expect((livePost.engagement as { likeCount: number }).likeCount).toBe(3);
  });

  it("image post has no video faststart requirement and compacts cleanly", () => {
    const imgUrl = "https://cdn.example/img.jpg";
    const imageAsset: MasterPostAssetV2 = {
      id: "ia1",
      index: 0,
      type: "image",
      source: {
        kind: "assets",
        originalAssetId: "ia1",
        primarySources: [],
        legacySourcesConsidered: [],
        legacyVariantUrlsMerged: false
      },
      image: {
        originalUrl: imgUrl,
        displayUrl: imgUrl,
        thumbnailUrl: imgUrl,
        blurhash: null,
        width: 800,
        height: 600,
        aspectRatio: 800 / 600,
        orientation: null
      },
      video: null,
      presentation: { letterboxGradient: null }
    };
    const canonical = baseCanonical({
      classification: {
        ...baseCanonical().classification,
        mediaKind: "image"
      },
      media: {
        ...baseCanonical().media,
        assetCount: 1,
        rawAssetCount: 1,
        primaryAssetId: "ia1",
        coverAssetId: "ia1",
        assets: [imageAsset],
        cover: {
          assetId: "ia1",
          type: "image",
          url: imgUrl,
          thumbUrl: imgUrl,
          posterUrl: null,
          width: 800,
          height: 600,
          aspectRatio: 800 / 600,
          gradient: null
        }
      },
      compatibility: {
        photoLink: imgUrl,
        displayPhotoLink: imgUrl,
        photoLinks2: null,
        photoLinks3: null,
        thumbUrl: imgUrl,
        posterUrl: null,
        fallbackVideoUrl: null,
        mediaType: "image"
      }
    });
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "p5" });
    const check = isCompactCanonicalPostV2(livePost);
    expect(check.compactOk).toBe(true);
    expect(check.mediaNeedsRepair).toBe(false);
    expect(check.videoNeedsFaststart).toBe(false);
    expect(check.canSkipWrite).toBe(true);
    expect(check.ok).toBe(true);
    expect((livePost.compatibility as { posterUrl?: string | null }).posterUrl).toBeUndefined();
    expect((livePost as { thumbUrl?: string }).thumbUrl).toBe(imgUrl);
  });

  it("does not copy raw normalizationDebug onto live document", () => {
    const canonical = baseCanonical();
    const rawBefore: Record<string, unknown> = {
      normalizationDebug: { onlyNulls: null, nested: { a: null } }
    };
    const { livePost, diagnostics } = compactCanonicalPostForLiveWrite({
      canonical,
      rawBefore,
      postId: "p6"
    });
    expect(livePost.normalizationDebug).toBeUndefined();
    expect(diagnostics.rawNormalizationDebug).toBeDefined();
  });

  it("omits ranking on live doc when aggregates and rollup are only nullish", () => {
    const canonical = baseCanonical();
    (canonical as unknown as { ranking: Record<string, unknown> }).ranking = {
      aggregates: { score: null, likes: null },
      rollup: { comments: null }
    };
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "p_rank_null" });
    expect(livePost.ranking).toBeUndefined();
  });

  it("does not include an image field on compact video assets when canonical image is null", () => {
    const canonical = baseCanonical();
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "p_vid_shape" });
    const asset = (livePost.media as { assets: Array<Record<string, unknown>> }).assets[0]!;
    expect(asset.type).toBe("video");
    expect(asset.image).toBeUndefined();
  });
});

describe("evaluatePostRebuildReadiness / video skip gate", () => {
  it("post_71efc895b5108179 shape: compactOk but must run fast-start repair (not canSkipWrite)", () => {
    const doc: Record<string, unknown> = {
      schema: { name: "locava.post", version: 2 },
      lifecycle: {
        status: "active",
        isDeleted: false,
        deletedAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        createdAtMs: 1,
        updatedAt: "2026-05-01T00:00:00.000Z",
        lastMediaUpdatedAt: null,
        lastUserVisibleAt: null
      },
      author: { userId: "u1" },
      text: { title: "t", caption: "", description: "", content: "", searchableText: "t" },
      classification: { mediaKind: "video", activities: [], visibility: "public" },
      engagement: { likeCount: 0, commentCount: 0 },
      engagementPreview: { recentLikers: [], recentComments: [] },
      location: {
        coordinates: { lat: 40, lng: -70, geohash: "abc" },
        display: {},
        place: {},
        regions: { city: null, state: null, country: null }
      },
      media: {
        status: "ready",
        assetsReady: false,
        assetCount: 1,
        assets: [
          {
            id: "video_32394e7316_ffba62da82_0",
            type: "video",
            video: {
              originalUrl: "https://cdn.example/original.mp4",
              playback: {
                defaultUrl: "https://cdn.example/original.mp4",
                primaryUrl: "https://cdn.example/original.mp4",
                startupUrl: "https://cdn.example/original.mp4",
                selectedReason: "fallback_original_or_main"
              },
              variants: {},
              readiness: {
                assetsReady: false,
                instantPlaybackReady: false,
                faststartVerified: false,
                processingStatus: "ready"
              }
            }
          }
        ],
        cover: { url: "https://cdn.example/cover.jpg", thumbUrl: "https://cdn.example/thumb.jpg" }
      },
      compatibility: {
        photoLink: "https://cdn.example/cover.jpg",
        displayPhotoLink: "https://cdn.example/cover.jpg",
        thumbUrl: "https://cdn.example/thumb.jpg",
        mediaType: "video"
      }
    };
    const r = evaluatePostRebuildReadiness(doc);
    expect(r.compactOk).toBe(true);
    expect(r.videoNeedsFaststart).toBe(true);
    expect(r.mediaNeedsRepair).toBe(true);
    expect(r.canSkipWrite).toBe(false);
    expect(r.videoIssueCount).toBe(r.videoIssues.length);
    expect(r.videoIssueCount).toBeGreaterThan(0);
    expect(r.videoIssues[0]?.assetId).toBe("video_32394e7316_ffba62da82_0");
    expect(r.videoIssues[0]?.summary).toMatch(/fast-start ladder still incomplete|fallback_original_or_main/);
  });

  it("legacy top-level assets[] video still surfaces fast-start repair need (no precheck/strict gap)", () => {
    const doc: Record<string, unknown> = {
      id: "legacy_assets_only",
      schema: { name: "locava.post", version: 2 },
      lifecycle: {
        status: "active",
        isDeleted: false,
        deletedAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        createdAtMs: 1,
        updatedAt: "2026-05-01T00:00:00.000Z",
        lastMediaUpdatedAt: null,
        lastUserVisibleAt: null
      },
      author: { userId: "u1" },
      text: { title: "t", caption: "", description: "", content: "", searchableText: "t" },
      classification: { mediaKind: "video", activities: [], visibility: "public" },
      engagement: { likeCount: 0, commentCount: 0 },
      engagementPreview: { recentLikers: [], recentComments: [] },
      location: {
        coordinates: { lat: 40, lng: -70, geohash: "abc" },
        display: {},
        place: {},
        regions: { city: null, state: null, country: null }
      },
      assets: [
        {
          id: "video_legacy_root_0",
          type: "video",
          video: {
            originalUrl: "https://cdn.example/original.mp4",
            playback: {
              defaultUrl: "https://cdn.example/original.mp4",
              primaryUrl: "https://cdn.example/original.mp4",
              startupUrl: "https://cdn.example/original.mp4",
              selectedReason: "fallback_original_or_main"
            },
            variants: {},
            readiness: {
              assetsReady: false,
              instantPlaybackReady: false,
              faststartVerified: false,
              processingStatus: "ready"
            }
          }
        }
      ],
      media: {
        status: "ready",
        assetsReady: false,
        assetCount: 1,
        assets: [],
        cover: { url: "https://cdn.example/cover.jpg", thumbUrl: "https://cdn.example/thumb.jpg" }
      },
      compatibility: {
        photoLink: "https://cdn.example/cover.jpg",
        displayPhotoLink: "https://cdn.example/cover.jpg",
        thumbUrl: "https://cdn.example/thumb.jpg",
        mediaType: "video"
      }
    };
    const r = evaluatePostRebuildReadiness(doc);
    expect(r.compactOk).toBe(true);
    expect(r.mediaNeedsRepair).toBe(true);
    expect(r.videoNeedsFaststart).toBe(true);
    expect(r.canSkipWrite).toBe(false);
    expect(r.videoIssueCount).toBeGreaterThan(0);
  });

  it("fully optimized compact video from builder is canSkipWrite", () => {
    const canonical = baseCanonical();
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "good_vid" });
    const r = evaluatePostRebuildReadiness(livePost as Record<string, unknown>);
    expect(r.compactOk).toBe(true);
    expect(r.videoNeedsFaststart).toBe(false);
    expect(r.canSkipWrite).toBe(true);
  });

  it("mixed post with one unready video is not canSkipWrite", () => {
    const imgUrl = "https://cdn.example/img.jpg";
    const doc: Record<string, unknown> = {
      schema: { name: "locava.post", version: 2 },
      lifecycle: {
        status: "active",
        isDeleted: false,
        deletedAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        createdAtMs: 1,
        updatedAt: "2026-05-01T00:00:00.000Z",
        lastMediaUpdatedAt: null,
        lastUserVisibleAt: null
      },
      author: { userId: "u1" },
      text: { title: "t", caption: "", description: "", content: "", searchableText: "t" },
      classification: { mediaKind: "mixed", activities: [], visibility: "public" },
      engagement: { likeCount: 0, commentCount: 0 },
      engagementPreview: { recentLikers: [], recentComments: [] },
      location: {
        coordinates: { lat: 40, lng: -70, geohash: "abc" },
        display: {},
        place: {},
        regions: { city: null, state: null, country: null }
      },
      media: {
        status: "ready",
        assetsReady: false,
        assetCount: 2,
        assets: [
          {
            id: "i1",
            type: "image",
            image: { displayUrl: imgUrl, originalUrl: imgUrl, thumbnailUrl: imgUrl }
          },
          {
            id: "v1",
            type: "video",
            video: {
              originalUrl: "https://cdn.example/o.mp4",
              playback: {
                defaultUrl: "https://cdn.example/o.mp4",
                primaryUrl: "https://cdn.example/o.mp4",
                startupUrl: "https://cdn.example/o.mp4",
                selectedReason: "fallback_original_or_main"
              },
              variants: {},
              readiness: {
                assetsReady: false,
                instantPlaybackReady: false,
                faststartVerified: false,
                processingStatus: "ready"
              }
            }
          }
        ],
        cover: { url: imgUrl, thumbUrl: imgUrl }
      },
      compatibility: {
        photoLink: imgUrl,
        displayPhotoLink: imgUrl,
        thumbUrl: imgUrl,
        mediaType: "mixed"
      }
    };
    const r = evaluatePostRebuildReadiness(doc);
    expect(r.compactOk).toBe(true);
    expect(r.videoNeedsFaststart).toBe(true);
    expect(r.canSkipWrite).toBe(false);
  });

  it("deleted compact video ignores fast-start gate for canSkipWrite", () => {
    const u = "https://cdn.example/main.mp4";
    const legacyVideo: MasterPostAssetV2 = {
      id: "v_legacy",
      index: 0,
      type: "video",
      source: {
        kind: "media.assets",
        originalAssetId: "v_legacy",
        primarySources: ["media.assets"],
        legacySourcesConsidered: [],
        legacyVariantUrlsMerged: false
      },
      image: null,
      video: {
        originalUrl: u,
        posterUrl: "https://cdn.example/poster.jpg",
        posterHighUrl: null,
        playback: {
          defaultUrl: u,
          primaryUrl: u,
          startupUrl: u,
          highQualityUrl: u,
          upgradeUrl: u,
          hlsUrl: null,
          fallbackUrl: u,
          previewUrl: null
        },
        variants: {},
        durationSec: null,
        hasAudio: null,
        codecs: null,
        technical: { sourceCodec: null, playbackCodec: null, audioCodec: null },
        bitrateKbps: null,
        sizeBytes: null,
        readiness: {
          assetsReady: false,
          instantPlaybackReady: false,
          faststartVerified: false,
          processingStatus: null
        }
      },
      presentation: { letterboxGradient: null, carouselFitWidth: true, resizeMode: "contain" }
    };
    const canonical = baseCanonical({
      lifecycle: {
        ...baseCanonical().lifecycle,
        status: "deleted",
        isDeleted: true,
        deletedAt: "2026-05-02T00:00:00.000Z"
      },
      media: {
        ...baseCanonical().media,
        assets: [legacyVideo]
      }
    });
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "p_del_vid" });
    const r = evaluatePostRebuildReadiness(livePost as Record<string, unknown>);
    expect(r.compactOk).toBe(true);
    expect(r.videoNeedsFaststart).toBe(false);
    expect(r.canSkipWrite).toBe(true);
  });

  it("compact video with external poster is not skip-ready until poster repaired", () => {
    const canonical = baseCanonical();
    canonical.media.cover.url = "https://scontent.cdninstagram.com/x/poster.jpg";
    canonical.media.cover.posterUrl = "https://scontent.cdninstagram.com/x/poster.jpg";
    canonical.media.cover.thumbUrl = "https://scontent.cdninstagram.com/x/poster.jpg";
    canonical.compatibility.photoLink = "https://scontent.cdninstagram.com/x/poster.jpg";
    canonical.compatibility.displayPhotoLink = "https://scontent.cdninstagram.com/x/poster.jpg";
    canonical.compatibility.thumbUrl = "https://scontent.cdninstagram.com/x/poster.jpg";
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "poster_ext_1" });
    const r = evaluatePostRebuildReadiness(livePost as Record<string, unknown>);
    expect(r.compactOk).toBe(true);
    expect(r.posterNeedsRepair).toBe(true);
    expect(r.canSkipWrite).toBe(false);
  });

  it("compact video with durable wasabi poster remains skip-ready", () => {
    const canonical = baseCanonical();
    const durable = "https://s3.wasabisys.com/locava.app/videos-lab/post_x/va1/poster_high.jpg";
    canonical.media.cover.url = durable;
    canonical.media.cover.posterUrl = durable;
    canonical.media.cover.thumbUrl = durable;
    canonical.compatibility.photoLink = durable;
    canonical.compatibility.displayPhotoLink = durable;
    canonical.compatibility.thumbUrl = durable;
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "poster_ok_1" });
    const r = evaluatePostRebuildReadiness(livePost as Record<string, unknown>);
    expect(r.posterNeedsRepair).toBe(false);
    expect(r.canSkipWrite).toBe(true);
  });

  it("analyzeVideoAssetPlaybackReadiness returns actionable summary", () => {
    const issue = analyzeVideoAssetPlaybackReadiness({
      id: "va",
      type: "video",
      video: {
        playback: {
          defaultUrl: "https://x/a.mp4",
          primaryUrl: "https://x/a.mp4",
          startupUrl: "https://x/a.mp4",
          selectedReason: "fallback_original_or_main"
        },
        variants: {},
        readiness: {
          assetsReady: false,
          instantPlaybackReady: false,
          faststartVerified: false
        }
      }
    });
    expect(issue).not.toBeNull();
    expect(issue!.summary).toMatch(/fallback_original_or_main/);
  });
});

describe("isCompactCanonicalPostV2", () => {
  it("rejects documents with forbidden top-level arrays or debug roots", () => {
    const canonical = baseCanonical();
    const { livePost } = compactCanonicalPostForLiveWrite({ canonical, rawBefore: {}, postId: "x" });
    const tainted = { ...livePost, likes: [{ userId: "a" }] };
    const check = isCompactCanonicalPostV2(tainted);
    expect(check.ok).toBe(false);
    expect(check.forbiddenLivePathsPresent.some((p) => p.includes("likes"))).toBe(true);
  });
});
