import { isForYouV5ReadyDeckEnabled } from "./for-you-v5-flags.js";

export type ForYouSimpleRouteVariantDecision =
  | { kind: "v5" }
  | { kind: "legacy"; reason: string };

/**
 * Central gate: when to serve For You V5 vs legacy `feed-for-you-simple.service` runtime.
 *
 * Native sends plain `GET /v2/feed/for-you/simple?limit=5`. Do not require `home_reel_first` here.
 * Requiring `home_reel_first` caused native first paint to stay on the legacy `cold_refill` path
 * with huge reads and repeated posts.
 */
export function resolveForYouSimpleFeedRouteVariant(input: {
  cursor: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): ForYouSimpleRouteVariantDecision {
  const env = input.env ?? process.env;
  if (String(env.FORCE_FOR_YOU_LEGACY ?? "").trim() === "1") {
    return { kind: "legacy", reason: "force_for_you_legacy_env" };
  }
  if (!isForYouV5ReadyDeckEnabled(env)) {
    return { kind: "legacy", reason: "enable_for_you_v5_ready_deck_false" };
  }
  const c = (input.cursor ?? "").trim();
  if (c.startsWith("fys:v3:") || c.startsWith("fys:v2:") || c.startsWith("fys:v1:")) {
    return { kind: "legacy", reason: "legacy_cursor_fys_v3_family_rollback" };
  }
  return { kind: "v5" };
}
