export function isPendingPlaceholderUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  return normalized.includes("_pending.jpg");
}

export function isStagingObjectKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return key.trim().includes("postSessionStaging/");
}

export function isStagingMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.trim().includes("postSessionStaging/");
}

export function isLikelyPublicFinalImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const value = url.trim();
  if (!/^https?:\/\//i.test(value)) return false;
  if (isPendingPlaceholderUrl(value)) return false;
  if (isStagingMediaUrl(value)) return false;
  return true;
}
