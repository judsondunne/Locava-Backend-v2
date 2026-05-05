import type { LegendPostCreatedInput } from "./legends.types.js";

const PUBLIC_PRIVACY = new Set(["public spot", "public"]);

export function isEligiblePostForLegends(post: LegendPostCreatedInput): { eligible: boolean; reason: string | null } {
  const finalized = post.finalized !== false;
  if (!finalized) return { eligible: false, reason: "not_finalized" };
  if (post.isDeleted === true) return { eligible: false, reason: "deleted" };
  if (post.isHidden === true) return { eligible: false, reason: "hidden" };
  const privacy = String(post.privacy ?? "").trim().toLowerCase();
  if (!PUBLIC_PRIVACY.has(privacy)) return { eligible: false, reason: "not_public" };
  return { eligible: true, reason: null };
}

