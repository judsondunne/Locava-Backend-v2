import type {
  CollectedReelInput,
  ReelCreator,
} from "../../../contracts/surfaces/undiscovered-reels.contract.js";

/**
 * Build creator attribution from a collected reel. Profile URL is derived from
 * the username so it's always present when we know who posted it — that link +
 * name + avatar are what let Aaron credit the creator in-app.
 *
 * When an `authoritative` owner is supplied (extracted from Instagram's own
 * owner object), it wins field-by-field over the pasted input — the input's
 * username and name can come from different, misaligned sources, so IG's
 * single owner object is the source of truth for who actually posted the reel.
 */
export function buildReelAttribution(
  reel: CollectedReelInput,
  authoritative?: Partial<ReelCreator> | null,
): ReelCreator {
  const username = normalize(authoritative?.username) ?? normalize(reel.ownerUsername);
  const fullName = normalize(authoritative?.fullName) ?? normalize(reel.ownerFullName);
  const profilePicUrl = normalize(authoritative?.profilePicUrl) ?? normalize(reel.ownerProfilePicUrl);
  return {
    username,
    fullName,
    profilePicUrl,
    profileUrl: username ? `https://www.instagram.com/${username.replace(/^@/, "")}/` : null,
  };
}

function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}
