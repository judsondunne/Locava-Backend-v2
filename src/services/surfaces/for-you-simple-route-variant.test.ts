import { describe, expect, it } from "vitest";
import { resolveForYouSimpleFeedRouteVariant } from "./for-you-simple-route-variant.js";

describe("resolveForYouSimpleFeedRouteVariant", () => {
  it("routes plain no-cursor to V5 when env object is empty (same as unset process.env keys)", () => {
    expect(resolveForYouSimpleFeedRouteVariant({ cursor: null, env: {} })).toEqual({ kind: "v5" });
  });

  it("routes plain no-cursor to V5 when ENABLE_FOR_YOU_V5_READY_DECK is true (no home_reel_first)", () => {
    expect(
      resolveForYouSimpleFeedRouteVariant({
        cursor: null,
        env: { ENABLE_FOR_YOU_V5_READY_DECK: "true" },
      })
    ).toEqual({ kind: "v5" });
  });

  it("routes fys:v5 cursor to V5 when enabled", () => {
    expect(
      resolveForYouSimpleFeedRouteVariant({
        cursor: "fys:v5:abc",
        env: { ENABLE_FOR_YOU_V5_READY_DECK: "true" },
      })
    ).toEqual({ kind: "v5" });
  });

  it("routes fys:v3 family to legacy for rollback", () => {
    expect(
      resolveForYouSimpleFeedRouteVariant({
        cursor: "fys:v3:x",
        env: { ENABLE_FOR_YOU_V5_READY_DECK: "true" },
      })
    ).toEqual({ kind: "legacy", reason: "legacy_cursor_fys_v3_family_rollback" });
  });

  it("routes to legacy when V5 disabled", () => {
    expect(
      resolveForYouSimpleFeedRouteVariant({
        cursor: null,
        env: { ENABLE_FOR_YOU_V5_READY_DECK: "false" },
      })
    ).toEqual({ kind: "legacy", reason: "enable_for_you_v5_ready_deck_false" });
  });

  it("routes to legacy when FORCE_FOR_YOU_LEGACY=1", () => {
    expect(
      resolveForYouSimpleFeedRouteVariant({
        cursor: null,
        env: { ENABLE_FOR_YOU_V5_READY_DECK: "true", FORCE_FOR_YOU_LEGACY: "1" },
      })
    ).toEqual({ kind: "legacy", reason: "force_for_you_legacy_env" });
  });
});
