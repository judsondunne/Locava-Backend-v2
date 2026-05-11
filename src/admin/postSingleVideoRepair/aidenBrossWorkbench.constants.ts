/**
 * Reference `poster_high` URLs (videos-lab) for matching repaired originals to live posts.
 * Post id is parsed from each URL path segment after `videos-lab/`.
 */

/**
 * Canonical Firestore `posts/{id}` id (no `post_` prefix).
 * Videos-lab paths use folders named `post_<id>`; normalize to bare `<id>` for reads/writes.
 */
export function normalizeFirestorePostDocId(input: string): string {
  return String(input ?? "")
    .trim()
    .replace(/^post_/i, "");
}

const FIRESTORE_POST_DOC_ID_RE = /^[A-Za-z0-9_]{8,64}$/;

export function isValidFirestorePostDocId(input: string): boolean {
  return FIRESTORE_POST_DOC_ID_RE.test(normalizeFirestorePostDocId(input));
}

/** Parse bare post doc id from a videos-lab poster URL (`…/videos-lab/post_<id>/…` → `<id>`). */
export function postIdFromVideosLabPosterUrl(url: string): string | null {
  const t = String(url ?? "").trim();
  const m = t.match(/\/videos-lab\/(post_[^/]+)\//);
  const seg = m?.[1] ?? null;
  if (!seg) return null;
  const bare = normalizeFirestorePostDocId(seg);
  return bare || null;
}

export const AIDEN_BROSS_REFERENCE_POSTER_URLS: readonly string[] = [
  "https://s3.wasabisys.com/locava.app/videos-lab/post_QFawZvNe38NmKBLOe2NL/video_1776624194939_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_AajwanxeRCzOxDdXCqBr/video_1776624249727_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_cl2Gbfhn0a4zUk4kIr1N/video_1776624250237_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_qY3flYkbDahZyePukChz/video_1776624241545_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_upvbH5k9Fc873o1qGhdd/video_1776624240633_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_WWuNjb4D7XsNZCNbZTFC/video_1776624239045_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_YrwN9E9wraC3jJiHpw7y/video_1776624238179_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_Z9O4wnUCggRLU3akbCnq/video_1776624234993_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_vrAXE6gwHAChKrOKUY0C/video_1776624232251_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_3Uazo0ZDP0syql7nBVVC/video_1776624232300_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_6UYeDibiGSjtPCpuyaBf/video_1776624229994_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_kswo38M6KT7q731mrlvW/video_1776624223330_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_XD7UC7GqrWlYIwlMto61/video_1776624220611_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_Qozx1Akzkhubb4f45L9Q/video_1776624219816_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_wpo06cvFCq02qcDRPU5u/video_1776624217650_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_rVtGPdev2VBQSgTFbIaH/video_1776624207831_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_OAA0ueLGCyAeW7Se7hxC/video_1776624204636_0/poster_high.jpg",
  "https://s3.wasabisys.com/locava.app/videos-lab/post_fXX7H6V2kk23Zl2dysNK/video_1776624201810_0/poster_high.jpg"
] as const;

const LAB = AIDEN_BROSS_REFERENCE_POSTER_URLS;

/**
 * Default batch: each row ties a videos-lab reference poster (source of truth for `postId`)
 * to the Wasabi admin upload used as `newOriginalUrl` for regenerate.
 */
export type AidenBrossDefaultRepairQueueRow = {
  readonly referencePosterUrl: string;
  readonly newOriginalUrl: string;
};

/** Truncated admin-upload prefixes (UI / chat ellipsis). Resolved against reel Wasabi URLs in workbench. */
export const AIDEN_BROSS_DEFAULT_REPAIR_QUEUE_ROWS: readonly AidenBrossDefaultRepairQueueRow[] = [
  { referencePosterUrl: LAB[0]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635702048_8b..." },
  { referencePosterUrl: LAB[6]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776636022435_ub..." },
  { referencePosterUrl: LAB[9]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635882181_8b..." },
  { referencePosterUrl: LAB[10]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635873688_la..." },
  { referencePosterUrl: LAB[1]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776636031038_6l..." },
  { referencePosterUrl: LAB[16]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635977489_71..." },
  { referencePosterUrl: LAB[13]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635822456_4f..." },
  { referencePosterUrl: LAB[15]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635755928_bd..." },
  { referencePosterUrl: LAB[12]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635994345_91..." },
  { referencePosterUrl: LAB[7]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776636014359_vx..." },
  { referencePosterUrl: LAB[5]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635921237_sj..." },
  { referencePosterUrl: LAB[4]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776636026623_jr..." },
  { referencePosterUrl: LAB[3]!, newOriginalUrl: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776635935077_tc..." }
] as const;

export type AidenBrossDefaultRepairQueueItem = { readonly postId: string; readonly newOriginalUrl: string };

export const AIDEN_BROSS_DEFAULT_REPAIR_QUEUE: readonly AidenBrossDefaultRepairQueueItem[] =
  AIDEN_BROSS_DEFAULT_REPAIR_QUEUE_ROWS.map((row) => {
    const postId = postIdFromVideosLabPosterUrl(row.referencePosterUrl);
    if (!postId) {
      throw new Error(`aiden_default_repair_queue:bad_reference_poster_url:${row.referencePosterUrl}`);
    }
    return { postId, newOriginalUrl: row.newOriginalUrl };
  });
