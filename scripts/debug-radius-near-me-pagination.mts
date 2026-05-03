#!/usr/bin/env tsx

/**
 * Manual verifier for radius near-me pagination continuity.
 * Usage:
 *   BACKEND_URL=http://localhost:8080 \
 *   LAT=40.68843 LNG=-75.22073 RADIUS_MILES=25 LIMIT=5 MAX_PAGES=10 \
 *   npm run -s tsx scripts/debug-radius-near-me-pagination.mts
 */

const baseUrl = (process.env.BACKEND_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const lat = Number(process.env.LAT ?? "40.68843");
const lng = Number(process.env.LNG ?? "-75.22073");
const radiusMiles = Number(process.env.RADIUS_MILES ?? "25");
const limit = Math.max(1, Math.min(10, Number(process.env.LIMIT ?? "5")));
const maxPages = Math.max(1, Number(process.env.MAX_PAGES ?? "10"));

type NearMeResponse = {
  feedId?: string;
  items?: Array<{ postId?: string; geo?: { lat?: number; long?: number } }>;
  nextCursor?: string | null;
  hasMore?: boolean;
  debug?: Record<string, unknown>;
};

function toDistanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  const km = 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return km / 1.60934;
}

async function main(): Promise<void> {
  const seen = new Set<string>();
  let cursor: string | null = null;
  let page = 0;
  let total = 0;

  while (page < maxPages) {
    const qs = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radiusMiles: String(radiusMiles),
      limit: String(limit)
    });
    if (cursor) qs.set("cursor", cursor);
    const url = `${baseUrl}/api/v1/product/reels/near-me?${qs.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} @ page ${page + 1}`);
    }
    const payload = (await res.json()) as NearMeResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const ids = items
      .map((row) => String(row.postId ?? "").trim())
      .filter(Boolean);
    const duplicates = ids.filter((id) => seen.has(id));
    ids.forEach((id) => seen.add(id));
    total += ids.length;

    const distances = items
      .map((row) => {
        const pLat = Number(row.geo?.lat);
        const pLng = Number(row.geo?.long);
        if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
        return toDistanceMiles(lat, lng, pLat, pLng);
      })
      .filter((d): d is number => d != null);

    page += 1;
    console.log("[RADIUS_FEED_PAGE]", {
      page,
      returned: ids.length,
      duplicateCount: duplicates.length,
      nextCursor: payload.nextCursor ?? null,
      hasMore: payload.hasMore ?? null,
      distanceMinMiles: distances.length ? Math.min(...distances).toFixed(2) : null,
      distanceMaxMiles: distances.length ? Math.max(...distances).toFixed(2) : null,
      debug: payload.debug ?? null
    });

    if (duplicates.length > 0) {
      throw new Error(`Duplicate IDs detected on page ${page}: ${duplicates.slice(0, 5).join(", ")}`);
    }
    if (!payload.nextCursor || payload.hasMore === false) break;
    cursor = payload.nextCursor;
  }

  console.log("[RADIUS_FEED_PAGE]", {
    status: "done",
    pagesFetched: page,
    totalReturned: total,
    uniqueReturned: seen.size
  });
}

main().catch((error) => {
  console.error("[RADIUS_FEED_PAGE]", {
    status: "failed",
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});

