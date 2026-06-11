type BucketState = {
  count: number;
  windowStartedAt: number;
};

const viewerBuckets = new Map<string, BucketState>();
let globalDailyCount = 0;
let globalDailyWindowStartedAt = Date.now();

const VIEWER_WINDOW_MS = 60_000;
const DAILY_WINDOW_MS = 86_400_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function isUndiscoveredPhotoSearchEnabled(): boolean {
  const raw = process.env.UNDISCOVERED_PHOTO_SEARCH_ENABLED;
  if (raw == null || raw === "") return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export function getUndiscoveredPhotoSearchCacheTtlDays(): number {
  return Math.max(1, envInt("UNDISCOVERED_PHOTO_SEARCH_CACHE_TTL_DAYS", 30));
}

export function getUndiscoveredPhotoSearchMaxPerMinutePerViewer(): number {
  return Math.max(1, envInt("UNDISCOVERED_PHOTO_SEARCH_MAX_PER_MINUTE_PER_VIEWER", 10));
}

export function getUndiscoveredPhotoSearchMaxProviderCallsPerDay(): number {
  return Math.max(1, envInt("UNDISCOVERED_PHOTO_SEARCH_MAX_PROVIDER_CALLS_PER_DAY", 500));
}

export function getUndiscoveredPhotoSearchEmptyCacheTtlMinutes(): number {
  return Math.max(5, envInt("UNDISCOVERED_PHOTO_SEARCH_EMPTY_CACHE_TTL_MINUTES", 15));
}

export function resetUndiscoveredPhotoSearchBudgetForTests(): void {
  viewerBuckets.clear();
  globalDailyCount = 0;
  globalDailyWindowStartedAt = Date.now();
}

export function checkUndiscoveredPhotoSearchViewerBudget(viewerId: string): boolean {
  const now = Date.now();
  const key = viewerId.trim() || "anonymous";
  const maxPerMinute = getUndiscoveredPhotoSearchMaxPerMinutePerViewer();
  const existing = viewerBuckets.get(key);
  if (!existing || now - existing.windowStartedAt >= VIEWER_WINDOW_MS) {
    viewerBuckets.set(key, { count: 1, windowStartedAt: now });
    return true;
  }
  if (existing.count >= maxPerMinute) return false;
  existing.count += 1;
  return true;
}

export function checkUndiscoveredPhotoSearchGlobalProviderBudget(): boolean {
  const now = Date.now();
  if (now - globalDailyWindowStartedAt >= DAILY_WINDOW_MS) {
    globalDailyWindowStartedAt = now;
    globalDailyCount = 0;
  }
  const maxDaily = getUndiscoveredPhotoSearchMaxProviderCallsPerDay();
  if (globalDailyCount >= maxDaily) return false;
  globalDailyCount += 1;
  return true;
}
