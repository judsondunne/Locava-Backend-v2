import type { CollectedReelInput } from "../../../contracts/surfaces/undiscovered-reels.contract.js";

/**
 * Automatic reel acquisition by hashtag.
 *
 * Instagram has no public post-search API, so "mass-fetch reels mentioning a
 * spot" means scraping IG's internal hashtag endpoint (`tags/web_info`), which
 * returns recent + top media (shortcode, caption, poster) for a tag. Requires a
 * session cookie and is rate-limited by IG. The HTTP call is injectable so the
 * parsing/derivation logic is fully unit-testable offline.
 */

const IG_APP_ID = "936619743392459";

export type HashtagFetchDeps = {
  cookieHeader?: string;
  httpGetJson?: (url: string, headers: Record<string, string>) => Promise<unknown>;
};

/** Derive candidate hashtags from a spot name. e.g. "Warren Falls" → warrenfalls, warrenfallsvt. */
export function spotNameToHashtags(name: string): string[] {
  const base = name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, "")
    .trim();
  if (base.length < 3) return [];
  const tags = new Set<string>([base, `${base}vt`, `${base}vermont`]);
  return [...tags];
}

/** Parse IG's tags/web_info payload into collected reels (shortcode + caption + owner). */
export function parseHashtagWebInfo(payload: unknown): CollectedReelInput[] {
  const data = (payload as { data?: Record<string, unknown> })?.data;
  if (!data) return [];
  const out: CollectedReelInput[] = [];
  const seen = new Set<string>();
  for (const bucket of ["top", "recent"] as const) {
    const sections = (data[bucket] as { sections?: unknown[] })?.sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections) {
      const medias = (section as { layout_content?: { medias?: unknown[] } })?.layout_content?.medias;
      if (!Array.isArray(medias)) continue;
      for (const entry of medias) {
        const media = (entry as { media?: Record<string, unknown> })?.media;
        if (!media) continue;
        const code = typeof media.code === "string" ? media.code : "";
        // Reels/clips only (product_type: "clips") — skip photos.
        const isClip = media.product_type === "clips" || media.media_type === 2;
        if (!code || !isClip || seen.has(code)) continue;
        seen.add(code);
        const caption = ((media.caption as { text?: string })?.text ?? "").toString();
        const user = (media.user as Record<string, unknown>) ?? {};
        out.push({
          shortcode: code,
          caption,
          reelUrl: `https://www.instagram.com/reel/${code}/`,
          ownerUsername: (user.username as string) ?? null,
          ownerFullName: (user.full_name as string) ?? null,
          ownerProfilePicUrl: (user.profile_pic_url as string) ?? null,
          ownerRaw: { owner: user },
        });
      }
    }
  }
  return out;
}

/** Keep only reels whose caption actually mentions the spot (the plan's requirement). */
export function filterReelsByCaption(reels: CollectedReelInput[], spotName: string): CollectedReelInput[] {
  const needle = spotName.toLowerCase().replace(/['’.]/g, "").trim();
  if (!needle) return [];
  return reels.filter((r) => (r.caption ?? "").toLowerCase().replace(/['’.]/g, "").includes(needle));
}

async function defaultHttpGetJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`ig_hashtag_${res.status}`);
  return res.json();
}

/**
 * Fetch reels for a single spot: try its candidate hashtags, collect reels,
 * dedupe, and keep only those whose caption mentions the spot name.
 */
export async function fetchReelsForSpot(
  spotName: string,
  deps: HashtagFetchDeps = {},
): Promise<CollectedReelInput[]> {
  const httpGetJson = deps.httpGetJson ?? defaultHttpGetJson;
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "X-IG-App-ID": IG_APP_ID,
    Accept: "*/*",
    ...(deps.cookieHeader ? { Cookie: deps.cookieHeader } : {}),
  };
  const collected: CollectedReelInput[] = [];
  const seen = new Set<string>();
  for (const tag of spotNameToHashtags(spotName)) {
    try {
      const payload = await httpGetJson(
        `https://www.instagram.com/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`,
        headers,
      );
      for (const reel of parseHashtagWebInfo(payload)) {
        if (seen.has(reel.shortcode)) continue;
        seen.add(reel.shortcode);
        collected.push(reel);
      }
    } catch {
      // one failing tag doesn't sink the spot — others may still return
    }
  }
  return filterReelsByCaption(collected, spotName);
}
