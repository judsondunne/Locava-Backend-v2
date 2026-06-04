import type { LegendPostCreatedInput } from "./legends.types.js";

const PUBLIC_PRIVACY = new Set(["public spot", "public", "public route"]);

export function isEligiblePostForLegends(post: LegendPostCreatedInput): { eligible: boolean; reason: string | null } {
  const finalized = post.finalized !== false;
  if (!finalized) return { eligible: false, reason: "not_finalized" };
  if (post.isDeleted === true) return { eligible: false, reason: "deleted" };
  if (post.isHidden === true) return { eligible: false, reason: "hidden" };
  const privacy = String(post.privacy ?? "").trim().toLowerCase();
  if (!privacy) return { eligible: false, reason: "not_public" };
  if (!PUBLIC_PRIVACY.has(privacy)) return { eligible: false, reason: "not_public" };
  return { eligible: true, reason: null };
}

/** Retry commit when post hydration is incomplete instead of permanently marking processed. */
export function isRecoverableLegendEligibilityFailure(
  post: LegendPostCreatedInput,
  reason: string | null
): boolean {
  if (reason === "not_finalized" && post.finalized == null) return true;
  if (reason === "not_public" && !String(post.privacy ?? "").trim()) return true;
  return false;
}

