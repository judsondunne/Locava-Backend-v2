import { describe, expect, it } from "vitest";
import {
  isPlaceholderLetterboxGradient,
  selectPublishLetterboxGradients
} from "./select-publish-letterbox-gradients.js";

describe("selectPublishLetterboxGradients", () => {
  it("body real gradient wins over fallback placeholder", () => {
    const r = selectPublishLetterboxGradients({
      assetCount: 1,
      bodyLetterboxGradients: [{ top: "#23569a", bottom: "#5b3320", source: "calculated" }],
      fallbackAllowed: true
    });
    expect(r.usedPlaceholderGradient).toBe(false);
    expect(r.letterboxGradients[0]).toEqual({ top: "#23569a", bottom: "#5b3320" });
    expect(r.selectedSourceBeforeWrite).toBe("body_letterbox_gradients");
  });

  it("staging real gradient wins when body only has placeholder colors", () => {
    const r = selectPublishLetterboxGradients({
      assetCount: 1,
      bodyLetterboxGradients: [{ top: "#1f2937", bottom: "#111827" }],
      stagingLetterboxGradients: [{ top: "#23569a", bottom: "#5b3320" }],
      fallbackAllowed: true
    });
    expect(r.usedPlaceholderGradient).toBe(false);
    expect(r.letterboxGradients[0]?.top).toBe("#23569a");
    expect(r.selectedSourceBeforeWrite.startsWith("staging")).toBe(true);
  });

  it("body placeholder pair is ignored so staging can win", () => {
    expect(isPlaceholderLetterboxGradient({ top: "#1f2937", bottom: "#111827" })).toBe(true);
    const r = selectPublishLetterboxGradients({
      assetCount: 1,
      bodyLetterboxGradients: [{ top: "#1f2937", bottom: "#111827", source: "calculated" }],
      stagingLetterboxGradients: [{ top: "#aaaaaa", bottom: "#bbbbbb" }],
      fallbackAllowed: true
    });
    expect(r.letterboxGradients[0]?.top).toBe("#aaaaaa");
  });

  it("multi-image preserves per-index presentation gradients from body", () => {
    const r = selectPublishLetterboxGradients({
      assetCount: 2,
      bodyAssetPresentations: [
        {
          index: 0,
          presentation: {
            letterboxGradient: { top: "#111111", bottom: "#222222", source: "calculated" },
            carouselFitWidth: true,
            resizeMode: "contain"
          }
        },
        {
          index: 1,
          presentation: {
            letterboxGradient: { top: "#333333", bottom: "#444444", source: "calculated" },
            carouselFitWidth: true,
            resizeMode: "contain"
          }
        }
      ],
      fallbackAllowed: true
    });
    expect(r.perAssetPresentation[0]?.letterboxGradient?.top).toBe("#111111");
    expect(r.perAssetPresentation[1]?.letterboxGradient?.bottom).toBe("#444444");
    expect(r.usedPlaceholderGradient).toBe(false);
  });

  it("when no real gradient exists and fallback allowed, uses placeholder bucket", () => {
    const r = selectPublishLetterboxGradients({
      assetCount: 1,
      bodyLetterboxGradients: [],
      fallbackAllowed: true
    });
    expect(r.usedPlaceholderGradient).toBe(true);
    expect(r.letterboxGradients[0]).toEqual({ top: "#1f2937", bottom: "#111827" });
  });

  it("respects body carouselFitWidth false over default", () => {
    const r = selectPublishLetterboxGradients({
      assetCount: 1,
      bodyLetterboxGradients: [{ top: "#23569a", bottom: "#5b3320" }],
      bodyCarouselFitWidth: false,
      fallbackAllowed: true
    });
    expect(r.carouselFitWidth).toBe(false);
  });
});

describe("finalize gradient integration (pending image)", () => {
  it("keeps real gradients on assembled photo assets with imageVariantsPending", async () => {
    const { assemblePostAssetsFromStagedItems } = await import("./assemblePostAssets.js");
    const { buildNativePostDocument } = await import("./buildPostDocument.js");
    const { Timestamp } = await import("firebase-admin/firestore");
    const assembled = assemblePostAssetsFromStagedItems("post_pending_grad", [
      {
        index: 0,
        assetType: "photo",
        assetId: "img_0",
        originalUrl: "https://cdn.example.com/promoted.jpg"
      }
    ]);
    const { applyPublishPresentationToAssembledAssets, selectPublishLetterboxGradients } = await import(
      "./select-publish-letterbox-gradients.js"
    );
    const pick = selectPublishLetterboxGradients({
      assetCount: assembled.assets.length,
      bodyLetterboxGradients: [{ top: "#23569a", bottom: "#5b3320", source: "calculated" }],
      bodyCarouselFitWidth: true,
      fallbackAllowed: true
    });
    applyPublishPresentationToAssembledAssets(assembled.assets, pick.perAssetPresentation);
    const nowTs = Timestamp.fromMillis(1_777_333_000_000);
    const doc = buildNativePostDocument({
      postId: "post_pending_grad",
      effectiveUserId: "user_1",
      viewerId: "user_1",
      sessionId: "ups_1",
      stagedSessionId: "ps_1",
      idempotencyKey: "idem",
      nowMs: 1_777_333_000_000,
      nowTs,
      user: { handle: "h", name: "N", profilePic: "https://cdn.example.com/p.jpg" },
      title: "T",
      content: "C",
      activities: ["hike"],
      lat: 40.7,
      lng: -75.2,
      address: "Easton, Pennsylvania",
      privacy: "Public Spot",
      tags: [],
      texts: [],
      recordings: [],
      assembled,
      geo: {
        cityRegionId: "US-Pennsylvania-Easton",
        stateRegionId: "US-Pennsylvania",
        countryRegionId: "US",
        geohash: "dr4e3x",
        geoData: { country: "United States", state: "Pennsylvania", city: "Easton" },
        addressDisplayName: "Easton, Pennsylvania",
        locationDisplayName: "Easton, Pennsylvania",
        fallbackPrecision: "address",
        reverseGeocodeStatus: "resolved",
        source: "manual"
      },
      carouselFitWidth: pick.carouselFitWidth,
      letterboxGradients: pick.letterboxGradients
    });
    const asset0 = (doc.assets as Record<string, unknown>[])[0];
    expect(asset0?.imageVariantsPending).toBe(true);
    const pres = asset0?.presentation as { letterboxGradient?: { top: string } } | undefined;
    expect(pres?.letterboxGradient?.top).toBe("#23569a");
    expect(doc.letterboxGradients).toEqual([{ top: "#23569a", bottom: "#5b3320" }]);
  });
});
