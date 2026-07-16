import { describe, expect, it } from "vitest";
import { buildNativePostDocument, type BuildNativePostDocumentInput } from "../../services/posting/buildPostDocument.js";
import { isEligibleReelTemplateSource } from "./reel-templates.eligibility.js";

function makeComposedReelInput(
  overrides: Partial<BuildNativePostDocumentInput> = {}
): BuildNativePostDocumentInput {
  const editProject = {
    version: 1,
    targetFormat: { width: 720, height: 1280, fps: 30 },
    tracks: [
      {
        id: "track-media-1",
        type: "media",
        clips: [
          {
            clipId: "c1",
            type: "video",
            uri: "file://composed-source.mp4",
            startMs: 0,
            durationMs: 8000
          }
        ]
      }
    ]
  };
  return {
    postId: "post_reel_template_1",
    effectiveUserId: "user-1",
    viewerId: "user-1",
    sessionId: "session-1",
    stagedSessionId: "staged-1",
    idempotencyKey: "idem-1",
    nowMs: 1_746_662_400_000,
    nowTs: { toMillis: () => 1_746_662_400_000 } as BuildNativePostDocumentInput["nowTs"],
    user: { handle: "hiker", name: "Hiker", profilePic: "https://cdn.example.com/u.jpg" },
    title: "Trail reel",
    content: "Morning hike",
    activities: ["hiking"],
    lat: 43.7,
    lng: -72.3,
    address: "Hartland, VT",
    privacy: "Public Spot",
    tags: [],
    texts: [],
    recordings: [],
    editProject,
    assembled: {
      mediaType: "video",
      primaryDisplayUrl: "https://cdn.example.com/composed-poster.jpg",
      assets: [
        {
          id: "composed-asset-0",
          type: "video",
          original: "https://cdn.example.com/composed-reel.mp4",
          poster: "https://cdn.example.com/composed-poster.jpg"
        }
      ],
      hasVideo: true,
      imageCoverReady: true,
      imageVariantsPending: false,
      videoCount: 1,
      imageCount: 0,
      variantUrlCount: 0
    } as BuildNativePostDocumentInput["assembled"],
    geo: {
      cityRegionId: "US-VT-Hartland",
      stateRegionId: "US-VT",
      countryRegionId: "US",
      geohash: "drsj",
      geoData: { country: "US", state: "VT", city: "Hartland" },
      addressDisplayName: "Hartland, VT",
      locationDisplayName: "Hartland, VT",
      fallbackPrecision: "address",
      reverseGeocodeStatus: "resolved",
      source: "manual"
    },
    ...overrides
  };
}

function isPublicReelPrivacy(privacy: unknown): boolean {
  const normalized = String(privacy ?? "public").toLowerCase().trim();
  return (
    normalized === "public" ||
    normalized === "everyone" ||
    normalized === "" ||
    normalized === "public spot"
  );
}

describe("publish → reel-templates list eligibility", () => {
  it("freshly finalized composed reel is not yet template-eligible (async processing)", () => {
    const post = buildNativePostDocument(makeComposedReelInput());
    expect(post.reel).toBe(true);
    expect(post.editProject).toBeTruthy();
    expect(isPublicReelPrivacy(post.privacy)).toBe(true);
    expect(isEligibleReelTemplateSource(post as Record<string, unknown>)).toBe(false);
  });

  it("composed reel becomes template-eligible after video processing + poster gates pass", () => {
    const post = buildNativePostDocument(makeComposedReelInput());
    const ready = {
      ...post,
      mediaStatus: "ready",
      assetsReady: true,
      posterReady: true,
      posterPresent: true,
      posterUrl: "https://cdn.example.com/composed-poster.jpg",
      videoProcessingStatus: "completed",
      lifecycle: { status: "active" }
    };
    expect(isEligibleReelTemplateSource(ready as Record<string, unknown>)).toBe(true);
  });

  it("friends/secret privacy excludes reel from the public template library", () => {
    const post = buildNativePostDocument(
      makeComposedReelInput({
        privacy: "Friends Spot"
      })
    );
    expect(isPublicReelPrivacy(post.privacy)).toBe(false);
  });
});
