import type { Firestore } from "firebase-admin/firestore";
import { AIDEN_BROSS_DEFAULT_REPAIR_QUEUE, postIdFromVideosLabPosterUrl } from "./aidenBrossWorkbench.constants.js";

export { postIdFromVideosLabPosterUrl };
import {
  buildReelsSummaryFromInstagramCreatorProfile,
  isInstagramOrMetaCdnUrl,
  pickCopyLinkFromReelRow,
  pickPlaybackUrlFromReelRow,
  type InstagramReelSummaryRow
} from "./instagramCreatorProfileReels.js";

/**
 * Firestore path (same as the web Instagram connection page loads via API):
 *   `instagramCreatorProfiles/{handle}` → document `aiden.bross`
 * @see `instagramConnection.controller#getCreatorProfile` in Locava Backend (merge `ingest.wasabiByShortcode` into each reel).
 */
const AIDEN_IG_USERNAME = "aiden.bross";

export type ResolveAdminVideoUploadResult =
  | { ok: true; url: string; kind: "complete" | "resolved" }
  | { ok: false; reason: string };

/**
 * `newOriginalUrl` may be a full `https://…admin-video-uploads/….mp4` or a truncated prefix ending in `…` / `...`.
 * When truncated, find the longest matching Wasabi URL on the creator reel rows (same pool as the right sidebar).
 */
export function resolveTruncatedAdminVideoUploadAgainstReels(input: {
  postId: string;
  newOriginalUrl: string;
  reelsSummary: InstagramReelSummaryRow[];
}): ResolveAdminVideoUploadResult {
  const raw = String(input.newOriginalUrl ?? "").trim();
  if (!raw) return { ok: false, reason: "empty_url" };

  const hasEllipsis = raw.includes("...") || raw.includes("\u2026");
  const looksComplete = /^https:\/\/.+\.mp4$/i.test(raw) && !hasEllipsis;
  if (looksComplete) return { ok: true, url: raw, kind: "complete" };

  const prefix = raw
    .replace(/\.{3,}$/g, "")
    .replace(/\u2026+$/g, "")
    .trim();
  if (!/^https:\/\//i.test(prefix)) {
    return { ok: false, reason: "not_https_prefix" };
  }

  const candidates: string[] = [];
  for (const r of input.reelsSummary) {
    const w = pickPlaybackUrlFromReelRow(r);
    if (w) candidates.push(w);
    const w2 = typeof r.wasabiUrl === "string" ? r.wasabiUrl.trim() : "";
    if (w2 && w2 !== w) candidates.push(w2);
  }
  const uniq = [...new Set(candidates)].filter(Boolean);

  const postTag = String(input.postId ?? "").trim();
  const prefer = uniq.filter(
    (u) =>
      (postTag && u.includes(postTag)) ||
      (postTag && u.includes(`post_${postTag}`)) ||
      (postTag && u.includes(`post_${postTag}/`))
  );
  const pool = prefer.length ? prefer : uniq;

  let hits = pool.filter((u) => u.startsWith(prefix));
  if (!hits.length) hits = uniq.filter((u) => u.startsWith(prefix));
  if (!hits.length) {
    return { ok: false, reason: "no_wasabi_url_starts_with_prefix" };
  }
  hits.sort((a, b) => b.length - a.length);
  const best = hits[0]!;
  if (!/\.mp4$/i.test(best)) {
    return { ok: false, reason: "matched_url_not_mp4" };
  }
  return { ok: true, url: best, kind: "resolved" };
}

const LOCAVA_WEB_ORIGIN = "https://locava.app";

/**
 * Same rules as `CreatorInstagramConnectionWorkspace.proxiedMediaUrl` (Next app):
 * Wasabi and already-proxied URLs pass through; long / CDN IG URLs go through `/api/instagram-reel/file`.
 */
export function proxiedReelPosterLikeWebApp(posterUrl: string | null | undefined): string | null {
  const p = typeof posterUrl === "string" ? posterUrl.trim() : "";
  if (!p.startsWith("http")) return null;
  if (/^https:\/\/s3\.wasabisys\.com\//i.test(p)) return p;
  if (p.startsWith("/api/instagram-reel/file") || p.includes("/api/instagram-reel/file?")) return p;
  if (p.length >= 1800 || isInstagramOrMetaCdnUrl(p)) {
    return `${LOCAVA_WEB_ORIGIN}/api/instagram-reel/file?download=0&url=${encodeURIComponent(p)}`;
  }
  return p;
}

/** Scan a post document for Instagram reel/post shortcodes (links in text, assets, nested JSON). */
export function extractInstagramShortcodesFromPostDoc(raw: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const re = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/gi;
  let blob: string;
  try {
    blob = JSON.stringify(raw);
  } catch {
    return [];
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    const sc = m[1]?.trim();
    if (sc && /^[A-Za-z0-9_-]+$/.test(sc)) found.add(sc);
  }
  return [...found];
}

/** One row per `reels[]` entry on `instagramCreatorProfiles/aiden.bross` (document order). */
export type AidenCreatorReelPreview = {
  index: number;
  shortcode: string | null;
  title: string | null;
  /** Merged Wasabi only — same as `pickPlaybackUrlFromReelRow` (never Instagram `videoUrl`). */
  wasabiPlaybackUrl: string | null;
  videoPosterUrl: string | null;
  copyLinkUrl: string | null;
  hasWasabi: boolean;
};

export function buildCreatorReelPreviewsFromReelsSummary(
  reelsSummary: InstagramReelSummaryRow[]
): AidenCreatorReelPreview[] {
  return reelsSummary.map((reel, index) => {
    const wasabiPlaybackUrl = pickPlaybackUrlFromReelRow(reel);
    return {
      index,
      shortcode: reel.shortcode,
      title: reel.title,
      wasabiPlaybackUrl,
      videoPosterUrl: proxiedReelPosterLikeWebApp(reel.posterUrl),
      copyLinkUrl: pickCopyLinkFromReelRow(reel),
      hasWasabi: Boolean(wasabiPlaybackUrl)
    };
  });
}

/**
 * One Firestore read (`instagramCreatorProfiles/aiden.bross`): merge hard-coded 13 repair rows
 * (bare `postId` + truncated `admin-video-uploads/…` prefix) to full Wasabi URLs from Aiden’s reels.
 */
export async function buildAidenBrossRepairQueueFromConnection(input: {
  db: Firestore;
}): Promise<{
  instagramProfileUsername: string;
  instagramProfileExists: boolean;
  instagramReelCount: number;
  items: Array<{ postId: string; newOriginalUrl: string }>;
  errors: Array<{ postId: string; reason: string }>;
}> {
  const profileSnap = await input.db.collection("instagramCreatorProfiles").doc(AIDEN_IG_USERNAME).get();
  const reelsSummary: InstagramReelSummaryRow[] = profileSnap.exists
    ? buildReelsSummaryFromInstagramCreatorProfile((profileSnap.data() ?? {}) as Record<string, unknown>)
    : [];

  const items: Array<{ postId: string; newOriginalUrl: string }> = [];
  const errors: Array<{ postId: string; reason: string }> = [];

  for (const item of AIDEN_BROSS_DEFAULT_REPAIR_QUEUE) {
    const res = resolveTruncatedAdminVideoUploadAgainstReels({
      postId: item.postId,
      newOriginalUrl: item.newOriginalUrl,
      reelsSummary
    });
    if (!res.ok) errors.push({ postId: item.postId, reason: res.reason });
    else items.push({ postId: item.postId, newOriginalUrl: res.url });
  }

  return {
    instagramProfileUsername: AIDEN_IG_USERNAME,
    instagramProfileExists: profileSnap.exists,
    instagramReelCount: reelsSummary.length,
    items,
    errors
  };
}
