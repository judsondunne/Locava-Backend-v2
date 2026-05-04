import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { assemblePostAssetsFromStagedItems } from "../../../services/posting/assemblePostAssets.js";
import { buildNativePostDocument, validateNativePostDocumentForWrite } from "../../../services/posting/buildPostDocument.js";
import { mergeMasterPostV2IntoNativeFinalizeDocument } from "./mergeMasterPostV2IntoNativeFinalizeDocument.js";
import { validateMasterPostV2 } from "./validateMasterPostV2.js";
import { toAppPostV2FromAny, toMasterPostV2FromAnyWithProvenance } from "../app-post-v2/toAppPostV2.js";

const geo = {
  cityRegionId: "US-PA-Easton",
  stateRegionId: "US-PA",
  countryRegionId: "US",
  geohash: "dr4e3x",
  geoData: { country: "United States", state: "Pennsylvania", city: "Easton" },
  addressDisplayName: "Easton, Pennsylvania",
  locationDisplayName: "Easton, Pennsylvania",
  fallbackPrecision: "address" as const,
  reverseGeocodeStatus: "resolved" as const,
  source: "manual" as const
};

describe("mergeMasterPostV2IntoNativeFinalizeDocument", () => {
  const nowTs = Timestamp.fromMillis(1_777_333_000_000);
  const nowMs = 1_777_333_000_000;

  it("writes Master Post V2 schema + canonical media for a two-image native doc while preserving legacy top-level assets", () => {
    const postId = "post_merge_img2";
    const assembled = assemblePostAssetsFromStagedItems(postId, [
      { index: 0, assetType: "photo", assetId: "a0", originalUrl: "https://cdn.example.com/pending0.jpg" },
      { index: 1, assetType: "photo", assetId: "a1", originalUrl: "https://cdn.example.com/pending1.jpg" }
    ]);
    const g0 = { top: "#d5e9ec", bottom: "#003100", source: "body_letterbox_gradients" };
    const g1 = { top: "#c3dae8", bottom: "#004000", source: "body_letterbox_gradients" };
    const assets = assembled.assets.map((row, i) => ({
      ...row,
      presentation: {
        letterboxGradient: i === 0 ? g0 : g1,
        carouselFitWidth: true,
        resizeMode: "contain" as const
      }
    }));
    const assembledWithPres = { ...assembled, assets };

    const postDoc = buildNativePostDocument({
      postId,
      effectiveUserId: "user_1",
      viewerId: "user_1",
      sessionId: "ups_1",
      stagedSessionId: "ps_1",
      idempotencyKey: "idem",
      nowMs,
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
      assembled: assembledWithPres,
      geo,
      carouselFitWidth: true,
      letterboxGradients: [g0, g1]
    });
    validateNativePostDocumentForWrite(postDoc);

    const { firestoreWrite, canonical } = mergeMasterPostV2IntoNativeFinalizeDocument(postDoc, {
      now: new Date(nowMs)
    });

    expect(firestoreWrite.schema).toEqual(canonical.schema);
    expect((firestoreWrite.schema as { name: string }).name).toBe("locava.post");
    expect((firestoreWrite.schema as { version: number }).version).toBe(2);
    expect((firestoreWrite.schema as { canonicalizedBy: string }).canonicalizedBy).toBe("posting_finalize_v2");
    expect((firestoreWrite.schema as { sourceShape: string }).sourceShape).toBe("native_posting_v2");

    expect(Array.isArray(firestoreWrite.assets)).toBe(true);
    expect((firestoreWrite.assets as unknown[]).length).toBe(2);
    expect(typeof firestoreWrite.photoLink === "string" && String(firestoreWrite.photoLink).startsWith("http")).toBe(true);

    const media = firestoreWrite.media as Record<string, unknown>;
    expect(media.assetCount).toBe(2);
    const mAssets = media.assets as Array<{ presentation?: { letterboxGradient?: typeof g0 } }>;
    expect(mAssets.length).toBe(2);
    expect(mAssets[0]?.presentation?.letterboxGradient?.top).toBe(g0.top);
    expect(mAssets[0]?.presentation?.letterboxGradient?.bottom).toBe(g0.bottom);
    expect(mAssets[1]?.presentation?.letterboxGradient?.top).toBe(g1.top);
    expect(mAssets[1]?.presentation?.letterboxGradient?.bottom).toBe(g1.bottom);

    const coverGrad = (media.cover as { gradient?: typeof g0 }).gradient;
    expect(coverGrad?.top).toBe(g0.top);
    expect(coverGrad?.bottom).toBe(g0.bottom);

    expect((media.presentation as { carouselFitWidth: boolean }).carouselFitWidth).toBe(true);
    expect((media.presentation as { resizeMode: string }).resizeMode).toBe("contain");

    const compat = firestoreWrite.compatibility as Record<string, unknown>;
    expect(typeof compat.photoLink === "string" && String(compat.photoLink).length > 0).toBe(true);

    const v = validateMasterPostV2(canonical);
    expect(v.blockingErrors.length).toBe(0);

    const app = toAppPostV2FromAny(firestoreWrite as never, { postId });
    expect(app.schema.sourcePostSchemaVersion).toBe(2);
    expect(app.media.assets.length).toBe(2);
    const prov = toMasterPostV2FromAnyWithProvenance(firestoreWrite as never, { postId });
    expect(prov.normalizedFromLegacy).toBe(false);
  });

  it("accepts pending image URLs and keeps gradients + imageVariantsPending semantics untouched on legacy assets", () => {
    const postId = "post_merge_pending";
    const assembled = assemblePostAssetsFromStagedItems(postId, [
      { index: 0, assetType: "photo", assetId: "a0", originalUrl: "https://cdn.example.com/pending.jpg" }
    ]);
    const row0 = { ...assembled.assets[0], imageVariantsPending: true };
    const assembledPending = { ...assembled, assets: [row0] };
    const g = { top: "#aaaaaa", bottom: "#bbbbbb" };
    const postDoc = buildNativePostDocument({
      postId,
      effectiveUserId: "user_1",
      viewerId: "user_1",
      sessionId: "ups_1",
      stagedSessionId: "ps_1",
      idempotencyKey: "idem2",
      nowMs,
      nowTs,
      user: { handle: "h", name: "N", profilePic: "https://cdn.example.com/p.jpg" },
      title: "",
      content: "cap",
      activities: ["misc"],
      lat: 1,
      lng: 2,
      address: "Somewhere",
      privacy: "Public Spot",
      tags: [],
      texts: [],
      recordings: [],
      assembled: assembledPending,
      geo,
      carouselFitWidth: true,
      letterboxGradients: [g]
    });
    validateNativePostDocumentForWrite(postDoc);
    const { firestoreWrite } = mergeMasterPostV2IntoNativeFinalizeDocument(postDoc, { now: new Date(nowMs) });
    const legacy0 = (firestoreWrite.assets as Record<string, unknown>[])[0]!;
    expect(legacy0.imageVariantsPending).toBe(true);
    const m0 = ((firestoreWrite.media as { assets: Record<string, unknown>[] }).assets[0] ?? {}) as Record<string, unknown>;
    const pres = m0.presentation as { letterboxGradient?: { top: string } };
    expect(pres.letterboxGradient?.top).toBe("#aaaaaa");
  });

  it("adds audit warning when finalize used placeholder gradients", () => {
    const postId = "post_merge_ph";
    const assembled = assemblePostAssetsFromStagedItems(postId, [
      { index: 0, assetType: "photo", assetId: "a0", originalUrl: "https://cdn.example.com/a.jpg" }
    ]);
    const postDoc = buildNativePostDocument({
      postId,
      effectiveUserId: "user_1",
      viewerId: "user_1",
      sessionId: "ups_1",
      stagedSessionId: "ps_1",
      idempotencyKey: "idem3",
      nowMs,
      nowTs,
      user: { handle: "h", name: "N", profilePic: "https://cdn.example.com/p.jpg" },
      title: "x",
      content: "y",
      activities: ["misc"],
      lat: 1,
      lng: 2,
      address: "Somewhere",
      privacy: "Public Spot",
      tags: [],
      texts: [],
      recordings: [],
      assembled,
      geo,
      carouselFitWidth: true,
      letterboxGradients: [{ top: "#1f2937", bottom: "#111827" }]
    });
    validateNativePostDocumentForWrite(postDoc);
    const { canonical } = mergeMasterPostV2IntoNativeFinalizeDocument(postDoc, {
      now: new Date(nowMs),
      finalizeMeta: { usedPlaceholderGradient: true, placeholderReason: "unit_test" }
    });
    expect(canonical.audit.warnings.some((w) => w.code === "placeholder_letterbox_gradient_used")).toBe(true);
  });

  it("writes canonical fields for a single-video native doc", () => {
    const postId = "post_merge_vid";
    const assembled = assemblePostAssetsFromStagedItems(postId, [
      {
        index: 0,
        assetType: "video",
        assetId: "v0",
        originalUrl: "https://cdn.example.com/raw.mp4",
        posterUrl: "https://cdn.example.com/poster.jpg"
      }
    ]);
    const postDoc = buildNativePostDocument({
      postId,
      effectiveUserId: "user_1",
      viewerId: "user_1",
      sessionId: "ups_1",
      stagedSessionId: "ps_1",
      idempotencyKey: "idem4",
      nowMs,
      nowTs,
      user: { handle: "h", name: "N", profilePic: "https://cdn.example.com/p.jpg" },
      title: "v",
      content: "c",
      activities: ["misc"],
      lat: 1,
      lng: 2,
      address: "Somewhere",
      privacy: "Public Spot",
      tags: [],
      texts: [],
      recordings: [],
      assembled,
      geo,
      carouselFitWidth: false,
      letterboxGradients: []
    });
    validateNativePostDocumentForWrite(postDoc);
    const { firestoreWrite, canonical } = mergeMasterPostV2IntoNativeFinalizeDocument(postDoc, { now: new Date(nowMs) });
    expect(canonical.classification.mediaKind).toBe("video");
    expect(canonical.media.assets[0]!.type).toBe("video");
    expect(canonical.media.instantPlaybackReady).toBe(false);
    const compat = firestoreWrite.compatibility as Record<string, unknown>;
    expect(String(compat.fallbackVideoUrl ?? "").length > 0).toBe(true);
    const v = validateMasterPostV2(canonical);
    expect(v.blockingErrors.length).toBe(0);
  });
});
