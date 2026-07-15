function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** First eligible image URL for undiscovered map layer point features. */
export function resolveUndiscoveredLayerThumbnailUrl(
  data: Record<string, unknown>,
): string | undefined {
  const photoSearch = data.photoSearch as
    | { results?: Array<{ thumbnailUrl?: unknown }> }
    | undefined;
  const fromPhotoSearch = photoSearch?.results?.[0]?.thumbnailUrl;
  if (typeof fromPhotoSearch === "string" && isHttpUrl(fromPhotoSearch)) {
    return fromPhotoSearch.trim();
  }

  for (const key of ["displayPhotoLink", "thumbUrl", "thumbnailUrl"] as const) {
    const raw = data[key];
    if (typeof raw === "string" && isHttpUrl(raw)) return raw.trim();
  }

  const media = data.media;
  if (Array.isArray(media)) {
    for (const entry of media) {
      if (!entry || typeof entry !== "object") continue;
      const poster = (entry as { posterUrl?: unknown }).posterUrl;
      if (typeof poster === "string" && isHttpUrl(poster)) return poster.trim();
    }
  }

  return undefined;
}
