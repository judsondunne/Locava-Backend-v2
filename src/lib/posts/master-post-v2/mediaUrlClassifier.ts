export type MediaUrlKind = "video" | "image" | "unknown";

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".m3u8"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".avif"];

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().split("?")[0]!.split("#")[0]!;
}

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = normalizeUrl(url);
  return VIDEO_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

export function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = normalizeUrl(url);
  if (isVideoUrl(normalized)) return false;
  return IMAGE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

export function classifyMediaUrl(url: string | null | undefined): MediaUrlKind {
  if (!url) return "unknown";
  if (isVideoUrl(url)) return "video";
  if (isImageUrl(url)) return "image";
  return "unknown";
}
