import type {
  CollectedReelInput,
  ReelCreator,
} from "../../../contracts/surfaces/undiscovered-reels.contract.js";

/**
 * Build creator attribution from a collected reel. Profile URL is derived from
 * the username so it's always present when we know who posted it — that link +
 * name + avatar are what let Aaron credit the creator in-app.
 */
export function buildReelAttribution(reel: CollectedReelInput): ReelCreator {
  const username = normalize(reel.ownerUsername);
  return {
    username,
    fullName: normalize(reel.ownerFullName),
    profilePicUrl: normalize(reel.ownerProfilePicUrl),
    profileUrl: username ? `https://www.instagram.com/${username.replace(/^@/, "")}/` : null,
  };
}

function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}
