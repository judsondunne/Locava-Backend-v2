import type { StateContentPreviewSummary } from "./types.js";

export type MediaUrlValidationRow = {
  postId: string;
  index: number;
  thumbnailUrl?: string;
  fullImageUrl?: string;
  imageUrlOk: boolean;
  contentType?: string;
  failedUrl?: string;
  reason?: string;
};

function stripTrackingQuery(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("wikimedia.org")) {
      u.search = "";
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return url;
}

async function probeImageUrl(url: string, signal: AbortSignal): Promise<{ ok: boolean; contentType?: string; reason?: string }> {
  const cleanUrl = stripTrackingQuery(url);
  try {
    const res = await fetch(cleanUrl, {
      method: "GET",
      redirect: "follow",
      signal,
      headers: {
        "user-agent": "LocavaStateContentFactory/1.0",
        Range: "bytes=0-4095",
      },
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok && res.status !== 206) {
      return { ok: false, reason: `http_${res.status}`, contentType: ct || undefined };
    }
    if (!ct.toLowerCase().startsWith("image/")) {
      return { ok: false, reason: "not_image_content_type", contentType: ct };
    }
    if (url.includes("commons.wikimedia.org/wiki/")) {
      return { ok: false, reason: "commons_wiki_html_not_direct_image", contentType: ct };
    }
    return { ok: true, contentType: ct };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

/**
 * Validates the first N direct image URLs per preview (thumbnail/full only — not Commons file pages).
 */
export async function validatePreviewMediaUrls(
  previews: StateContentPreviewSummary[],
  options?: { maxUrlsPerPreview?: number; timeoutMs?: number },
): Promise<MediaUrlValidationRow[]> {
  const maxPer = options?.maxUrlsPerPreview ?? 3;
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const out: MediaUrlValidationRow[] = [];

  for (const preview of previews) {
    const media = preview.media ?? [];
    for (let i = 0; i < Math.min(media.length, maxPer); i += 1) {
      const m = media[i]!;
      const thumb = m.thumbnailUrl ?? m.thumbUrl;
      const full = m.fullImageUrl ?? m.imageUrl;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);

      let imageUrlOk = false;
      let contentType: string | undefined;
      let failedUrl: string | undefined;
      let reason: string | undefined;

      try {
        if (thumb) {
          const r = await probeImageUrl(thumb, controller.signal);
          if (r.ok) {
            imageUrlOk = true;
            contentType = r.contentType;
          } else if (full && full !== thumb) {
            const r2 = await probeImageUrl(full, controller.signal);
            imageUrlOk = r2.ok;
            contentType = r2.contentType;
            if (!r2.ok) {
              failedUrl = full;
              reason = r2.reason;
            }
          } else {
            failedUrl = thumb;
            reason = r.reason;
          }
        } else if (full) {
          const r = await probeImageUrl(full, controller.signal);
          imageUrlOk = r.ok;
          contentType = r.contentType;
          if (!r.ok) {
            failedUrl = full;
            reason = r.reason;
          }
        } else {
          imageUrlOk = false;
          reason = "no_thumbnail_or_full_url";
        }
      } finally {
        clearTimeout(t);
      }

      out.push({
        postId: preview.postId,
        index: i,
        thumbnailUrl: thumb,
        fullImageUrl: full,
        imageUrlOk,
        contentType,
        failedUrl,
        reason,
      });
    }
  }
  return out;
}
