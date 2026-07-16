/**
 * Commons photo backfill — location-verified photos for spots AND routes.
 *
 * For every outdoor spot/route, queries Wikimedia Commons for photos geotagged
 * within 400m and merges them into the doc's photoSearch cache (Commons results
 * first — they're location-verified and score 55–75 by distance — existing
 * strong results kept, deduped by URL). Free (no API key), so it covers docs
 * that already searched empty too: Commons may have what name-search missed.
 *
 * Resumable: docs whose cache already holds Commons results are skipped.
 *
 * Usage:
 *   npx tsx scripts/undiscovered/photoBackfillCommons.ts --dry-run
 *   npx tsx scripts/undiscovered/photoBackfillCommons.ts                 # spots + routes
 *   npx tsx scripts/undiscovered/photoBackfillCommons.ts --max 500
 */
import "dotenv/config";
import { getFirestoreSourceClient } from "../../src/repositories/source-of-truth/firestore-client.js";
import { fetchCommonsPhotosNear, commonsPhotosToCacheResults } from "../../src/lib/undiscovered/commonsGeoPhotos.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const flagVal = (name: string, def: number): number => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const MAX = flagVal("--max", Infinity);
// Wikimedia etiquette: serialized requests with real pacing — concurrency >1
// gets the whole run 429'd (observed live).
const CONCURRENCY = Math.max(1, Math.min(2, flagVal("--concurrency", 1)));
const RADIUS = flagVal("--radius", 400);
const PACE_MS = flagVal("--pace", 700);

const OUTDOOR_CATEGORIES = new Set([
  "waterfall", "water", "wateraccess", "beach", "view", "hiking", "nature",
  "conservation", "park", "quarries", "historical",
]);

type Target = { collection: "unexploredSpots" | "unexploredRoutes"; id: string; name: string; lat: number; lng: number };

function readCoords(d: Record<string, any>): { lat: number; lng: number } | null {
  const lat = Number(d.lat ?? d.location?.lat ?? d.displayCenter?.lat ?? d.centroid?.lat ?? d.routeAnchor?.latitude);
  const lng = Number(d.lng ?? d.long ?? d.location?.lng ?? d.location?.long ?? d.displayCenter?.lng ?? d.centroid?.lng ?? d.routeAnchor?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function hasCommonsResults(d: Record<string, any>): boolean {
  const results = d.photoSearch?.results;
  return Array.isArray(results) && results.some((r: any) => r?.provider === "wikimedia");
}

async function loadTargets(db: FirebaseFirestore.Firestore): Promise<Target[]> {
  const out: Target[] = [];
  for (const collection of ["unexploredSpots", "unexploredRoutes"] as const) {
    let lastId: string | null = null;
    for (;;) {
      let q = db.collection(collection)
        .select("displayName", "category", "lat", "lng", "long", "location", "displayCenter", "centroid", "routeAnchor", "photoSearch")
        .orderBy("__name__").limit(1000);
      if (lastId) q = q.startAfter(lastId);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, any>;
        if (collection === "unexploredSpots" && !OUTDOOR_CATEGORIES.has(String(d.category ?? ""))) continue;
        if (hasCommonsResults(d)) continue; // resume
        const coords = readCoords(d);
        if (!coords) continue;
        out.push({ collection, id: doc.id, name: String(d.displayName ?? ""), ...coords });
      }
      lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
      if (snap.size < 1000) break;
      process.stdout.write(`\r  scanning ${collection}… ${out.length} targets`);
    }
    process.stdout.write("\n");
  }
  return out;
}

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore not enabled");

  console.log("Scanning spots + routes for Commons backfill…");
  const targets = await loadTargets(db);
  console.log(`Targets: ${targets.length} (outdoor spots + all routes, without Commons results yet).`);
  if (DRY_RUN) { console.log("DRY RUN — no Commons calls, no writes."); return; }

  const queue = targets.slice(0, MAX === Infinity ? undefined : MAX);
  console.log(`Processing ${queue.length} at concurrency ${CONCURRENCY}, radius ${RADIUS}m.\n`);

  let done = 0, withPhotos = 0, photosAdded = 0, failed = 0, cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const t = queue[cursor++]!;
      try {
        const photos = await fetchCommonsPhotosNear(t.lat, t.lng, { radiusMeters: RADIUS, limit: 8 });
        if (photos.length > 0) {
          const nowIso = new Date().toISOString();
          const commonsResults = commonsPhotosToCacheResults(photos, nowIso);
          const ref = db.collection(t.collection).doc(t.id);
          const snap = await ref.get();
          const existing = (snap.data() as Record<string, any>)?.photoSearch;
          const existingResults: Array<Record<string, unknown>> = Array.isArray(existing?.results) ? existing.results : [];
          const seen = new Set(commonsResults.map((r) => r.imageUrl));
          const merged = [...commonsResults, ...existingResults.filter((r) => !seen.has(r.imageUrl as string))].slice(0, 8)
            .map((r, i) => ({ ...r, rank: i + 1 }));
          const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
          await ref.set({
            photoSearch: {
              schema: "locava.undiscoveredPhotoSearch",
              version: 1,
              status: "ready",
              query: existing?.query ?? t.name,
              provider: "wikimedia",
              validator: existing?.validator ?? "none",
              fetchedAt: nowIso,
              expiresAt,
              resultCount: merged.length,
              results: merged,
              error: null,
            },
          }, { merge: true });
          withPhotos++;
          photosAdded += commonsResults.length;
        }
      } catch {
        failed++;
      }
      done++;
      if (done % 100 === 0) console.log(`  [${done}/${queue.length}] docs-with-photos:${withPhotos} photos-added:${photosAdded} failed:${failed}`);
      await new Promise((r) => setTimeout(r, PACE_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nDONE — ${done} processed, ${withPhotos} docs gained photos, ${photosAdded} photos added, ${failed} failed.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
