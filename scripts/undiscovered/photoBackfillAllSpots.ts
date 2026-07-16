/**
 * Photo backfill across ALL undiscovered spots.
 *
 * Runs every spot through the production photo pipeline
 * (searchPlaceWebImagesForUndiscovered) — the same search + match-verification +
 * cache a user tap triggers, just ahead of time — so photos are present the
 * moment the map opens. Each spot costs ~1 Serper credit; results (including
 * "no verified match") are cached on the doc's `photoSearch` field.
 *
 * Resumable: spots that already have a `photoSearch` cache are skipped, so
 * re-running continues where it left off and never re-spends credits. Safe to
 * Ctrl-C and restart, or run in chunks with --max.
 *
 * Budget: raises the in-process daily provider cap (default 500 is a dev guard)
 * and the per-viewer rate limit, then rotates viewer ids so a bulk run doesn't
 * trip the per-viewer throttle. Stops cleanly if the Serper budget is exhausted.
 *
 * Usage:
 *   npx tsx scripts/undiscovered/photoBackfillAllSpots.ts --dry-run          # count spots still missing photos
 *   npx tsx scripts/undiscovered/photoBackfillAllSpots.ts                    # backfill all, default concurrency
 *   npx tsx scripts/undiscovered/photoBackfillAllSpots.ts --max 2000         # cap this run
 *   npx tsx scripts/undiscovered/photoBackfillAllSpots.ts --budget 50000     # max Serper credits to spend
 *   npx tsx scripts/undiscovered/photoBackfillAllSpots.ts --concurrency 8    # parallel searches (default 6)
 */
import "dotenv/config";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const flagVal = (name: string, def: number): number => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const MAX_SPOTS = flagVal("--max", Infinity);
const CONCURRENCY = Math.max(1, Math.min(12, flagVal("--concurrency", 6)));
const BUDGET = flagVal("--budget", 45000);
// Only keep photos whose match confidence clears this floor — weak matches
// (e.g. a spot pulling a job-listing or news thumbnail) are downgraded to empty
// so the map never shows a wrong image.
const MIN_CONFIDENCE = flagVal("--min-confidence", 45);
// Re-search docs whose cache is "empty" (e.g. after a purge or a stricter-floor
// run). Ready docs are always skipped.
const INCLUDE_EMPTY = args.includes("--include-empty");
// Also backfill unexploredRoutes (named trails match well on hiking sites).
const INCLUDE_ROUTES = args.includes("--routes");
// Restrict to outdoor, reel/photo-worthy categories by default; --all-categories
// to search everything (restaurants, shops, etc. — usually low value).
const ALL_CATEGORIES = args.includes("--all-categories");
const OUTDOOR_CATEGORIES = new Set([
  "waterfall", "water", "wateraccess", "beach", "view", "hiking", "nature",
  "conservation", "park", "quarries", "historical",
]);

// Lift the in-process guards BEFORE the budget module first reads them (it reads
// process.env live on each call). Rotating viewers keeps us under the per-viewer
// window; the global cap is what actually bounds spend.
process.env.UNDISCOVERED_PHOTO_SEARCH_MAX_PROVIDER_CALLS_PER_DAY = String(BUDGET);
process.env.UNDISCOVERED_PHOTO_SEARCH_MAX_PER_MINUTE_PER_VIEWER =
  process.env.UNDISCOVERED_PHOTO_SEARCH_MAX_PER_MINUTE_PER_VIEWER || "60";

const { loadEnv } = await import("../../src/config/env.js");
const { getFirestoreSourceClient } = await import("../../src/repositories/source-of-truth/firestore-client.js");
const { searchPlaceWebImagesForUndiscovered } = await import("../../src/services/undiscovered/undiscoveredPhotoSearch.service.js");

type PendingSpot = { collection: "unexploredSpots" | "unexploredRoutes"; id: string; name: string; town?: string; state: string; lat: number; lng: number };

async function loadDocsMissingPhotos(db: FirebaseFirestore.Firestore): Promise<{ pending: PendingSpot[]; scanned: number; alreadyDone: number }> {
  const pending: PendingSpot[] = [];
  let scanned = 0, alreadyDone = 0;
  const collections: Array<"unexploredSpots" | "unexploredRoutes"> = INCLUDE_ROUTES
    ? ["unexploredSpots", "unexploredRoutes"]
    : ["unexploredSpots"];
  for (const collection of collections) {
    let lastId: string | null = null;
    for (;;) {
      let q = db.collection(collection)
        .select("displayName", "category", "lat", "lng", "long", "location", "displayCenter", "centroid", "routeAnchor", "photoSearch")
        .orderBy("__name__").limit(1000);
      if (lastId) q = q.startAfter(lastId);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        scanned++;
        const d = doc.data() as Record<string, any>;
        const status = d.photoSearch?.status as string | undefined;
        // resume: skip searched docs — unless it's an "empty" cache and
        // --include-empty asked us to give those another shot.
        if (d.photoSearch && !(INCLUDE_EMPTY && status === "empty")) { alreadyDone++; continue; }
        if (collection === "unexploredSpots" && !ALL_CATEGORIES && !OUTDOOR_CATEGORIES.has(String(d.category ?? ""))) continue;
        const lat = Number(d.lat ?? d.location?.lat ?? d.displayCenter?.lat ?? d.centroid?.lat ?? d.routeAnchor?.latitude);
        const lng = Number(d.lng ?? d.long ?? d.location?.lng ?? d.location?.long ?? d.displayCenter?.lng ?? d.centroid?.lng ?? d.routeAnchor?.longitude);
        const name = String(d.displayName ?? "");
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || name.length < 2) continue;
        pending.push({ collection, id: doc.id, name, town: d.location?.city, state: d.location?.state ?? "VT", lat, lng });
      }
      lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
      if (snap.size < 1000) break;
      process.stdout.write(`\r  scanning ${collection}… ${scanned} scanned, ${pending.length} need photos`);
    }
    process.stdout.write("\n");
  }
  return { pending, scanned, alreadyDone };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore not enabled");
  if (!process.env.SERPER_API_KEY?.trim() && !DRY_RUN) throw new Error("SERPER_API_KEY not set in .env");

  console.log(`Scanning unexploredSpots for missing photos${ALL_CATEGORIES ? " (all categories)" : " (outdoor categories only)"}…`);
  const { pending, scanned, alreadyDone } = await loadDocsMissingPhotos(db);
  console.log(`Scanned ${scanned} spots — ${alreadyDone} already have photos, ${pending.length} eligible need backfill (min confidence ${MIN_CONFIDENCE}).`);

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would spend up to ${Math.min(pending.length, BUDGET)} Serper credits (budget ${BUDGET}). Re-run without --dry-run.`);
    return;
  }

  const queue = pending.slice(0, MAX_SPOTS === Infinity ? undefined : MAX_SPOTS);
  console.log(`\nBackfilling ${queue.length} spots — concurrency ${CONCURRENCY}, budget ${BUDGET} credits.\n`);

  let ready = 0, empty = 0, failed = 0, done = 0, budgetHit = false;
  let cursor = 0;
  async function worker(workerId: number): Promise<void> {
    while (cursor < queue.length && !budgetHit) {
      const idx = cursor++;
      const s = queue[idx]!;
      try {
        const result = await searchPlaceWebImagesForUndiscovered({
          env,
          viewerId: `photo-backfill-${workerId}-${idx % 50}`,
          body: { id: s.id, collection: s.collection, name: s.name, town: s.town, state: s.state, lat: s.lat, long: s.lng },
        });
        if (result.ok) {
          const status = (result.response as { cacheStatus?: string }).cacheStatus ?? "?";
          if (status === "hit" || status === "miss" || status === "refreshed") {
            // Enforce the confidence floor: drop weak results; if none survive,
            // mark the doc empty so a wrong image never renders.
            const items = ((result.response as { items?: Array<{ confidence?: number | null }> }).items ?? []);
            const strong = items.filter((it) => (it.confidence ?? 0) >= MIN_CONFIDENCE);
            if (strong.length === items.length) {
              ready++;
            } else if (strong.length > 0) {
              await db.collection(s.collection).doc(s.id).update({
                "photoSearch.results": strong, "photoSearch.resultCount": strong.length,
              });
              ready++;
            } else {
              await db.collection(s.collection).doc(s.id).update({
                "photoSearch.results": [], "photoSearch.resultCount": 0, "photoSearch.status": "empty",
              });
              empty++;
            }
          } else {
            empty++;
          }
        } else {
          failed++;
          if (result.code === "budget_exceeded" || result.code === "provider_budget_exceeded") { budgetHit = true; }
        }
      } catch {
        failed++;
      }
      done++;
      if (done % 25 === 0) console.log(`  [${done}/${queue.length}] ready:${ready} empty:${empty} failed:${failed}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  console.log(`\n${budgetHit ? "⚠️  Serper budget exhausted — " : ""}DONE this run.`);
  console.log(`Processed ${done} — photos ready: ${ready} | no verified match: ${empty} | failed: ${failed}.`);
  console.log(budgetHit
    ? "Raise --budget or wait for the daily window, then re-run to continue (already-done spots are skipped)."
    : "Re-run anytime to pick up spots added later; finished spots are skipped automatically.");
}

main().catch((err) => { console.error(err); process.exit(1); });
