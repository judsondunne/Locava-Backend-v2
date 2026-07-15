import type { ReelCreator } from "../../../contracts/surfaces/undiscovered-reels.contract.js";

/**
 * Extract the authoritative creator from an Instagram media/owner object.
 *
 * IG's GraphQL response carries `owner.username`, `owner.full_name`, and
 * `owner.profile_pic_url` as one coherent set — pulling all three from the same
 * object guarantees the handle and the display name belong to the same person
 * (the previous pipeline mixed handle from one source with name from another).
 */
export function extractInstagramOwner(media: unknown): Partial<ReelCreator> | null {
  const owner = pickOwner(media);
  if (!owner) return null;
  const username = str(owner.username);
  const fullName = str(owner.full_name) ?? str(owner.fullName);
  const profilePicUrl = str(owner.profile_pic_url) ?? str(owner.profilePicUrl);
  if (!username && !fullName && !profilePicUrl) return null;
  return {
    username,
    fullName,
    profilePicUrl,
    profileUrl: username ? `https://www.instagram.com/${username.replace(/^@/, "")}/` : null,
  };
}

function pickOwner(media: unknown): Record<string, unknown> | null {
  if (!media || typeof media !== "object") return null;
  const m = media as Record<string, unknown>;
  // Accept either a media node (…media.owner) or an owner object directly.
  const candidate =
    (m.owner as Record<string, unknown> | undefined) ??
    ((m.data as Record<string, unknown> | undefined)?.xdt_shortcode_media as Record<string, unknown> | undefined)?.owner ??
    (m.username || m.full_name || m.profile_pic_url ? m : undefined);
  return candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
