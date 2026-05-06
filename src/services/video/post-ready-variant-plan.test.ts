import { describe, expect, it } from "vitest";
import {
  buildNativeFastPathEncodeOnly,
  DEFAULT_NATIVE_POST_READY_VARIANT_PLAN,
  getRequiredVariantsForPostReady,
  hasConfidentPosterUrl
} from "./post-ready-variant-plan.js";

describe("getRequiredVariantsForPostReady", () => {
  it("defaults to startup540+720 required and defers only upgrade1080FaststartAvc", () => {
    const p = getRequiredVariantsForPostReady();
    expect(p.requiredForReady).toEqual(["startup540FaststartAvc", "startup720FaststartAvc"]);
    expect(p.deferred1080UpgradeOnly).toBe("upgrade1080FaststartAvc");
    expect(p.forbiddenSeparate1080Encodes).toContain("startup1080FaststartAvc");
    expect(p.forbiddenSeparate1080Encodes).toContain("main1080");
    expect(p).toEqual(DEFAULT_NATIVE_POST_READY_VARIANT_PLAN);
  });
});

describe("buildNativeFastPathEncodeOnly", () => {
  it("does not request 1080 ladder variants", () => {
    const sel = buildNativeFastPathEncodeOnly({
      plan: getRequiredVariantsForPostReady(),
      needsPosterHigh: false,
      includePreview360Avc: false,
      includeMain720Avc: false,
      existingEncodedKeys: new Set()
    });
    expect(sel.startup1080FaststartAvc).toBeUndefined();
    expect(sel.upgrade1080FaststartAvc).toBeUndefined();
    expect(sel.startup540FaststartAvc).toBe(true);
    expect(sel.startup720FaststartAvc).toBe(true);
  });

  it("skips encodes already present on the asset", () => {
    const existing = new Set(["startup540FaststartAvc", "startup720FaststartAvc"]);
    const sel = buildNativeFastPathEncodeOnly({
      plan: getRequiredVariantsForPostReady(),
      needsPosterHigh: false,
      includePreview360Avc: false,
      includeMain720Avc: false,
      existingEncodedKeys: existing
    });
    expect(Object.keys(sel).length).toBe(0);
  });
});

describe("hasConfidentPosterUrl", () => {
  it("accepts https poster jpg", () => {
    expect(hasConfidentPosterUrl({ poster: "https://cdn.example.com/p.jpg" })).toBe(true);
  });

  it("rejects empty poster", () => {
    expect(hasConfidentPosterUrl({ poster: "" })).toBe(false);
  });
});
