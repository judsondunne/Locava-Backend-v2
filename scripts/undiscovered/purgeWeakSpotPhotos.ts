/**
 * Purge weak spot photos.
 *
 * The first photo backfill ran before the confidence floor existed, so many
 * `photoSearch` caches hold low-confidence or wrong images (job pages, news
 * thumbnails). This re-applies the floor to what's already stored: it keeps only
 * accepted results at or above the threshold; if none survive, the doc's
 * photoSearch is set to "empty" (searched, no good photo) so it renders nothing
 * and the backfill won't re-search it (no wasted credits).
 *
 * Idempotent — re-running only touches caches still holding weak results.
 *
 * Usage:
 *   npx tsx scripts/undiscovered/purgeWeakSpotPhotos.ts --dry-run        # count what would be purged
 *   npx tsx scripts/undiscovered/purgeWeakSpotPhotos.ts                  # purge at threshold 60
 *   npx tsx scripts/undiscovered/purgeWeakSpotPhotos.ts --threshold 45   # custom threshold
 */
import "dotenv/config";
import { getFirestoreSourceClient } from "../../src/repositories/source-of-truth/firestore-client.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const thIdx = args.indexOf("--threshold");
const THRESHOLD = thIdx >= 0 && args[thIdx + 1] ? Number(args[thIdx + 1]) : 60;

type PhotoResult = { confidence?: number; validationStatus?: string };

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore not enabled");

  console.log(`Scanning ready photos (threshold ${THRESHOLD})…`);
  let scanned = 0, keptWhole = 0, trimmed = 0, emptied = 0, lastId: string | null = null;
  for (;;) {
    let q = db.collection("unexploredSpots").where("photoSearch.status", "==", "ready").orderBy("__name__").limit(400);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      const ps = (doc.data() as { photoSearch?: { results?: PhotoResult[] } }).photoSearch;
      const results = Array.isArray(ps?.results) ? ps!.results : [];
      const strong = results.filter((r) => r.validationStatus === "accepted" && Number(r.confidence ?? 0) >= THRESHOLD);
      if (strong.length === results.length) { keptWhole++; continue; } // already clean
      if (DRY_RUN) { strong.length > 0 ? trimmed++ : emptied++; continue; }
      if (strong.length > 0) {
        await doc.ref.update({ "photoSearch.results": strong, "photoSearch.resultCount": strong.length });
        trimmed++;
      } else {
        await doc.ref.update({ "photoSearch.results": [], "photoSearch.resultCount": 0, "photoSearch.status": "empty" });
        emptied++;
      }
    }
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.size < 400) break;
    process.stdout.write(`\r  scanned ${scanned} — already-clean ${keptWhole}, trimmed ${trimmed}, emptied ${emptied}`);
  }
  process.stdout.write("\n");
  console.log(`${DRY_RUN ? "DRY RUN — " : ""}Done. Scanned ${scanned} ready spots.`);
  console.log(`  already clean (all ≥${THRESHOLD}): ${keptWhole}`);
  console.log(`  trimmed (dropped weak, kept strong): ${trimmed}`);
  console.log(`  emptied (no strong photo): ${emptied}`);
  if (DRY_RUN) console.log("Re-run without --dry-run to apply.");
}

main().catch((err) => { console.error(err); process.exit(1); });
