/**
 * Same Firestore document the Instagram connection page uses:
 *   `instagramCreatorProfiles/{username}`  (e.g. `aiden.bross`)
 * Fields: `reels[]`, `ingest.wasabiByShortcode` (map of shortcode → `{ url, ... }`),
 * optional `creatorConnectionDraftsByShortcode`.
 *
 * Mirrors `instagramConnection.controller#getCreatorProfile` merge
 * (`ingest.wasabiByShortcode` → each reel’s `wasabiUrl`).
 */

export type InstagramReelSummaryRow = {
  shortcode: string | null;
  instagramUrl: string | null;
  title: string | null;
  caption: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  wasabiUrl: string | null;
  method: string | null;
  connectionDraft: unknown;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function lookupWasabiRow(wasabiRaw: Record<string, unknown>, shortcode: string | null): Record<string, unknown> {
  if (!shortcode) return {};
  const k = String(shortcode).trim();
  const direct = wasabiRaw[k];
  if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  const lower = k.toLowerCase();
  for (const [key, val] of Object.entries(wasabiRaw)) {
    if (String(key).trim().toLowerCase() === lower && val && typeof val === "object") {
      return val as Record<string, unknown>;
    }
  }
  return {};
}

export function buildReelsSummaryFromInstagramCreatorProfile(
  data: Record<string, unknown>
): InstagramReelSummaryRow[] {
  const ingest = asRecord(data.ingest) ?? {};
  const wasabiRaw =
    ingest.wasabiByShortcode && typeof ingest.wasabiByShortcode === "object"
      ? (ingest.wasabiByShortcode as Record<string, unknown>)
      : {};
  const connectionDraftsRaw =
    data.creatorConnectionDraftsByShortcode &&
    typeof data.creatorConnectionDraftsByShortcode === "object"
      ? (data.creatorConnectionDraftsByShortcode as Record<string, unknown>)
      : {};

  const reels = Array.isArray(data.reels) ? data.reels : [];
  return reels.map((reelRaw) => {
    const reel = (reelRaw && typeof reelRaw === "object" ? reelRaw : {}) as Record<string, unknown>;
    const shortcode = reel.shortcode != null ? String(reel.shortcode) : null;
    const wasabiRow = lookupWasabiRow(wasabiRaw, shortcode);
    const mergedWasabi =
      typeof wasabiRow.url === "string" && wasabiRow.url.trim()
        ? wasabiRow.url.trim()
        : typeof reel.wasabiUrl === "string"
          ? reel.wasabiUrl.trim()
          : null;
    const connectionDraft =
      shortcode && connectionDraftsRaw[shortcode]
        ? connectionDraftsRaw[shortcode]
        : shortcode
          ? Object.entries(connectionDraftsRaw).find(
              ([key]) => String(key).trim().toLowerCase() === String(shortcode).trim().toLowerCase()
            )?.[1]
          : null;
    return {
      shortcode,
      instagramUrl:
        typeof reel.instagramUrl === "string"
          ? reel.instagramUrl
          : typeof reel.url === "string"
            ? reel.url
            : null,
      title: typeof reel.title === "string" ? reel.title : null,
      caption: typeof reel.caption === "string" ? reel.caption : null,
      posterUrl: typeof reel.posterUrl === "string" ? reel.posterUrl : null,
      videoUrl: typeof reel.videoUrl === "string" ? reel.videoUrl : null,
      wasabiUrl: mergedWasabi,
      method: typeof reel.method === "string" ? reel.method : null,
      connectionDraft
    };
  });
}

function trimHttp(s: string | null | undefined): string {
  const t = typeof s === "string" ? s.trim() : "";
  return /^https?:\/\//i.test(t) ? t : "";
}

/** Instagram / Meta CDNs — not “downloaded Wasabi” playback for the repair workbench. */
export function isInstagramOrMetaCdnUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h === "instagram.com" || h.endsWith(".instagram.com")) return true;
    if (h.includes("cdninstagram")) return true;
    if (h.endsWith(".fbcdn.net") || h.includes("fbcdn.net")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Video `<src>` parity with creators Instagram connection preview: **only** merged Firestore `wasabiUrl`
 * (from `ingest.wasabiByShortcode` + reel). Never `videoUrl` — that is Instagram CDN for this product surface.
 */
export function pickPlaybackUrlFromReelRow(r: InstagramReelSummaryRow | null | undefined): string | null {
  if (!r) return null;
  const w = trimHttp(r.wasabiUrl);
  if (w && !isInstagramOrMetaCdnUrl(w)) return w;
  return null;
}

/** URL for "Copy link" — Instagram permalink when we have it, else playback. */
export function pickCopyLinkFromReelRow(r: InstagramReelSummaryRow | null | undefined): string | null {
  if (!r) return null;
  const ig = r.instagramUrl && String(r.instagramUrl).trim().startsWith("http") ? String(r.instagramUrl).trim() : "";
  if (ig) return ig;
  const sc = r.shortcode && String(r.shortcode).trim();
  if (sc) return `https://www.instagram.com/p/${sc}/`;
  return pickPlaybackUrlFromReelRow(r);
}

function haystackForPostMatch(r: InstagramReelSummaryRow, postId: string): string {
  return [r.wasabiUrl, r.videoUrl, r.posterUrl, r.instagramUrl].map((x) => String(x ?? "")).join(" ");
}

/**
 * Find a reel row whose media URLs mention this Locava post (Firestore doc id, bare or as `post_<id>` in URLs).
 */
export function findReelRowForLocavaPostId(
  reels: InstagramReelSummaryRow[],
  postId: string
): InstagramReelSummaryRow | null {
  const pid = String(postId ?? "").trim();
  if (!pid) return null;
  for (const r of reels) {
    if (haystackForPostMatch(r, pid).includes(pid)) return r;
  }
  return null;
}

/** Match `instagram.com/reel/SHORT` or `/p/SHORT` (case-sensitive shortcode as stored on reels). */
export function findReelRowForInstagramShortcode(
  reels: InstagramReelSummaryRow[],
  shortcode: string | null | undefined
): InstagramReelSummaryRow | null {
  const sc = String(shortcode ?? "").trim();
  if (!sc) return null;
  const lower = sc.toLowerCase();
  for (const r of reels) {
    const rs = r.shortcode != null ? String(r.shortcode).trim() : "";
    if (rs && rs.toLowerCase() === lower) return r;
  }
  return null;
}
