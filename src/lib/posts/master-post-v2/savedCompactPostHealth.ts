/**
 * Post-write checks on a Firestore-shaped post document (compact live).
 * Used by Post Rebuilder after re-read — not a substitute for isCompactCanonicalPostV2.
 */

type UnknownRecord = Record<string, unknown>;

function getNestedRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

/** Every video has https primaryUrl; every image has some https URL; visual kinds have a cover-like URL. */
export function mediaUrlSanityCheckOnSavedCompactPost(saved: UnknownRecord): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const media = getNestedRecord(saved.media);
  const classification = getNestedRecord(saved.classification);
  const mediaKind = String(classification?.mediaKind ?? saved.mediaType ?? "")
    .trim()
    .toLowerCase();
  const assets = Array.isArray(media?.assets) ? (media.assets as UnknownRecord[]) : [];
  for (const ar of assets) {
    const row = getNestedRecord(ar);
    if (!row) continue;
    if (row.type === "video") {
      const pb = getNestedRecord(getNestedRecord(row.video)?.playback);
      const primary = typeof pb?.primaryUrl === "string" ? pb.primaryUrl.trim() : "";
      if (!/^https?:\/\//i.test(primary)) issues.push(`${String(row.id ?? "?")}:video_missing_primaryUrl`);
    } else if (row.type === "image") {
      const im = getNestedRecord(row.image);
      const okUrl = [im?.displayUrl, im?.originalUrl, im?.thumbnailUrl].some(
        (u) => typeof u === "string" && /^https?:\/\//i.test(String(u).trim())
      );
      if (!okUrl) issues.push(`${String(row.id ?? "?")}:image_missing_urls`);
    }
  }
  if (mediaKind === "image" || mediaKind === "video" || mediaKind === "mixed") {
    const cover = getNestedRecord(media?.cover as unknown);
    const compat = getNestedRecord(saved.compatibility as unknown);
    const topPhoto = typeof saved.photoLink === "string" ? saved.photoLink : "";
    const topDisp = typeof saved.displayPhotoLink === "string" ? saved.displayPhotoLink : "";
    const topThumb = typeof saved.thumbUrl === "string" ? saved.thumbUrl : "";
    const coverOk = [
      cover?.url,
      cover?.thumbUrl,
      cover?.posterUrl,
      compat?.photoLink,
      compat?.displayPhotoLink,
      compat?.thumbUrl,
      topPhoto,
      topDisp,
      topThumb
    ].some((u) => typeof u === "string" && /^https?:\/\//i.test(String(u).trim()));
    if (!coverOk) issues.push("cover_missing_all_urls");
  }
  return { ok: issues.length === 0, issues };
}
