/**
 * READ-ONLY diagnostic: scans recent `posts` (time desc) in memory — no writes, no deletes.
 *
 * Usage (from Locava Backendv2):
 *   npx tsx scripts/debug-radius-near-me-readonly-harness.mts
 *
 * Env:
 *   HARNESS_CENTER_LAT (default 40.69842189738677)
 *   HARNESS_CENTER_LNG (default -75.21062607164923)
 *   HARNESS_MAX_DOCS (default 220)
 */
import "dotenv/config";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { getPostCoordinates } from "../src/lib/posts/postFieldSelectors.js";

const DEFAULT_LAT = 40.69842189738677;
const DEFAULT_LNG = -75.21062607164923;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isDocVisible(data: Record<string, unknown>): boolean {
  if (data.deleted === true || data.isDeleted === true || data.archived === true || data.hidden === true) return false;
  const privacy = String(data.privacy ?? data.visibility ?? "public").toLowerCase();
  if (privacy === "private" || privacy === "followers") return false;
  const status = String(data.status ?? "active").toLowerCase();
  return status !== "deleted" && status !== "archived";
}

function hasPlayableMedia(data: Record<string, unknown>): boolean {
  const thumb =
    typeof data.displayPhotoLink === "string" && data.displayPhotoLink.trim()
      ? data.displayPhotoLink
      : typeof data.thumbUrl === "string" && data.thumbUrl.trim()
        ? data.thumbUrl
        : null;
  const hasAssets = Array.isArray(data.assets) && data.assets.length > 0;
  return Boolean(thumb || hasAssets);
}

function coordSource(data: Record<string, unknown>): "top_level" | "nested_location" | "none" {
  const hasTop =
    (typeof data.lat === "number" || typeof data.latitude === "number") &&
    (typeof data.lng === "number" || typeof data.long === "number" || typeof data.longitude === "number");
  const loc = data.location as Record<string, unknown> | undefined;
  const coords = loc && typeof loc === "object" ? (loc.coordinates as Record<string, unknown> | undefined) : undefined;
  const hasNested =
    coords &&
    (typeof coords.lat === "number" || typeof coords.latitude === "number") &&
    (typeof coords.lng === "number" || typeof coords.long === "number" || typeof coords.longitude === "number");
  if (hasNested) return "nested_location";
  if (hasTop) return "top_level";
  return "none";
}

async function runRadius(radiusMiles: number, centerLat: number, centerLng: number, maxDocs: number): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error(JSON.stringify({ event: "RADIUS_HARNESS_ERROR", reason: "firestore_unavailable" }));
    process.exit(1);
  }
  const limitKm = radiusMiles * 1.609344;
  const snap = await db.collection("posts").orderBy("time", "desc").limit(maxDocs).get();
  let total = 0;
  let topLevel = 0;
  let nested = 0;
  let invalidCoords = 0;
  let outsideRadius = 0;
  let rejectedStatusPrivacy = 0;
  let rejectedMissingMedia = 0;
  let reelMediaRejected = 0;
  const eligible: Array<{ postId: string; distanceMiles: number; source: string }> = [];

  for (const doc of snap.docs) {
    total += 1;
    const data = doc.data() as Record<string, unknown>;
    const src = coordSource(data);
    if (src === "top_level") topLevel += 1;
    if (src === "nested_location") nested += 1;
    const c = getPostCoordinates(data);
    if (c.lat == null || c.lng == null) {
      invalidCoords += 1;
      continue;
    }
    const km = haversineKm(centerLat, centerLng, c.lat, c.lng);
    if (km > limitKm) {
      outsideRadius += 1;
      continue;
    }
    if (!isDocVisible(data)) {
      rejectedStatusPrivacy += 1;
      continue;
    }
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const first = assets[0] as Record<string, unknown> | undefined;
    const firstType = String(first?.type ?? "").toLowerCase();
    if (firstType === "video" && data.videoProcessingStatus != null && data.videoProcessingStatus !== "completed") {
      reelMediaRejected += 1;
      continue;
    }
    if (!hasPlayableMedia(data)) {
      rejectedMissingMedia += 1;
      continue;
    }
    eligible.push({
      postId: doc.id,
      distanceMiles: km / 1.609344,
      source: src === "nested_location" ? "location.coordinates" : src === "top_level" ? "post.lat/long" : "selector"
    });
  }

  console.log(
    JSON.stringify(
      {
        event: "RADIUS_NEAR_ME_READONLY_HARNESS",
        radiusMiles,
        centerLat,
        centerLng,
        docsRead: snap.docs.length,
        totalCandidateDocsRead: total,
        candidatesTopLevelLatLong: topLevel,
        candidatesNestedLocationCoordinates: nested,
        candidatesRejectedInvalidCoords: invalidCoords,
        candidatesRejectedDistance: outsideRadius,
        candidatesRejectedStatusPrivacyDeleted: rejectedStatusPrivacy,
        candidatesRejectedMissingMedia: rejectedMissingMedia,
        candidatesRejectedVideoProcessing: reelMediaRejected,
        finalEligibleCount: eligible.length,
        firstTenEligible: eligible.slice(0, 10)
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  const lat = Number(process.env.HARNESS_CENTER_LAT ?? DEFAULT_LAT);
  const lng = Number(process.env.HARNESS_CENTER_LNG ?? DEFAULT_LNG);
  const maxDocs = Math.max(50, Math.min(500, Number(process.env.HARNESS_MAX_DOCS ?? 220)));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error("Invalid HARNESS_CENTER_LAT / HARNESS_CENTER_LNG");
    process.exit(1);
  }
  await runRadius(10, lat, lng, maxDocs);
  await runRadius(50, lat, lng, maxDocs);
}

void main();
