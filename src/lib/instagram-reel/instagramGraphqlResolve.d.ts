export type InstagramMediaOwner = {
  username: string | null;
  full_name: string | null;
  profile_pic_url: string | null;
};

export function shortcodeToMediaPk(shortcode: string): string | null;

export function resolveInstagramPublicGraphql(
  shortcode: string,
  log: unknown[],
  opts?: { extraCookieHeader?: string | null; ownerOnly?: boolean },
): Promise<{ videoUrl?: string; thumbnailUrl?: string | null; owner?: InstagramMediaOwner | null; method: string } | null>;

export function resolveInstagramEmbedScrape(
  shortcode: string,
  log: unknown[],
): Promise<{ videoUrl: string; thumbnailUrl?: string | null; method: string } | null>;

/** Fetch the authoritative Instagram owner for a reel by shortcode. Best-effort; never throws. */
export function fetchInstagramMediaOwner(
  shortcode: string,
  opts?: { extraCookieHeader?: string | null },
): Promise<InstagramMediaOwner | null>;
