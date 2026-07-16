/**
 * Batch reel acquisition across all reel-worthy undiscovered spots.
 *
 * "All possible spots" in practice = the named, photogenic outdoor spots that
 * plausibly have Instagram reels (waterfalls, gorges, swimming holes, summits,
 * state parks, notable lakes/beaches). Generic OSM points (numbered culverts,
 * pond dams) have no IG presence, so searching them only burns rate-limit budget.
 *
 * The runner is:
 *  - Ranked: processes highest-signal spots first.
 *  - Paced: a delay between spots to stay under Instagram's rate limits.
 *  - Resumable: progress is checkpointed, so re-running continues where it left
 *    off (safe to Ctrl-C and restart, or run in nightly chunks).
 *  - Self-throttling: backs off, then aborts, when Instagram starts blocking —
 *    so it degrades gracefully instead of getting the session flagged.
 *
 * Writes are idempotent (doc id = reel_<shortcode>, merge), so overlaps between
 * spots and re-runs never duplicate.
 *
 * Usage:
 *   npx tsx scripts/undiscovered/fetchReelsForAllSpots.ts --dry-run     # rank + count, no IG calls, no writes
 *   npx tsx scripts/undiscovered/fetchReelsForAllSpots.ts               # live: process all eligible, paced
 *   npx tsx scripts/undiscovered/fetchReelsForAllSpots.ts --max 300     # cap this run to 300 spots
 *   npx tsx scripts/undiscovered/fetchReelsForAllSpots.ts --pace 4000   # ms between spots (default 3000)
 *
 * Requires INSTAGRAM_COOKIE_HEADER in .env. USE A BURNER ACCOUNT — bulk hashtag
 * scraping is exactly what gets a personal account rate-limited or banned.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getFirestoreSourceClient } from "../../src/repositories/source-of-truth/firestore-client.js";
import { fetchReelsForSpot } from "../../src/lib/undiscovered/reels/fetchReelsByHashtag.js";
import { runReelGeolocation } from "../../src/lib/undiscovered/reels/runReelGeolocation.js";
import { extractInstagramOwner } from "../../src/lib/undiscovered/reels/extractInstagramOwner.js";
import { UndiscoveredReelSchema } from "../../src/contracts/surfaces/undiscovered-reels.contract.js";
import { isWebRankableName } from "../../src/lib/undiscovered/spotRanking.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const flagVal = (name: string, def: number): number => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const MAX_SPOTS = flagVal("--max", Infinity);
const PACE_MS = flagVal("--pace", 3000);
const MIN_SCORE = flagVal("--min-score", 30);
const PROGRESS_FILE = "data/undiscovered-reels-runs/progress.json";

// Outdoor categories worth searching, with a priority weight. Everything not
// listed (restaurants, shopping, playgrounds, museums…) is skipped entirely.
const CATEGORY_WEIGHT: Record<string, number> = {
  waterfall: 100, water: 70, wateraccess: 65, beach: 60, view: 60,
  hiking: 55, nature: 55, conservation: 50, park: 50, quarries: 45, historical: 25,
};
const NAME_PRIORITY: Array<[RegExp, number]> = [
  [/waterfall|falls|cascade/i, 100],
  [/gorge|canyon|ravine|notch/i, 90],
  [/swim|swimming hole/i, 85],
  [/state park|state forest/i, 80],
  [/summit|peak|viewpoint|overlook|vista|lookout|cliff/i, 75],
  [/lake|pond|reservoir|brook|river/i, 55],
  [/beach/i, 60],
  [/trail|hike/i, 40],
];

function spotScore(name: string, category: string): number {
  let score = CATEGORY_WEIGHT[category] ?? 0;
  const hay = `${name} ${category}`;
  for (const [re, pts] of NAME_PRIORITY) {
    if (re.test(hay)) { score = Math.max(score, pts); break; }
  }
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) score += 10;
  if (words.length >= 3) score += 5;
  if (name.includes("=") || /^\d+$/.test(name)) score = -1;
  return score;
}

type RankedSpot = { id: string; name: string; category: string; lat: number; lng: number; score: number };

function loadProgress(): { processedSpotIds: string[]; writtenTotal: number } {
  if (existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(readFileSync(PROGRESS_FILE, "utf8")); } catch { /* corrupt — start fresh */ }
  }
  return { processedSpotIds: [], writtenTotal: 0 };
}
function saveProgress(p: { processedSpotIds: string[]; writtenTotal: number }): void {
  mkdirSync(dirname(PROGRESS_FILE), { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 0));
}

async function loadRankedSpots(db: FirebaseFirestore.Firestore): Promise<RankedSpot[]> {
  const out: RankedSpot[] = [];
  let lastId: string | null = null;
  for (;;) {
    let q = db.collection("unexploredSpots").select("displayName", "category", "lat", "lng", "location")
      .orderBy("__name__").limit(1000);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, any>;
      const name = String(d.displayName ?? "");
      const category = String(d.category ?? "");
      const lat = Number(d.lat ?? d.location?.lat);
      const lng = Number(d.lng ?? d.location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const score = spotScore(name, category);
      if (score >= MIN_SCORE && name.length > 5 && isWebRankableName(name)) {
        out.push({ id: doc.id, name, category, lat, lng, score });
      }
    }
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.size < 1000) break;
    process.stdout.write(`\r  scanning… ${out.length} eligible so far`);
  }
  process.stdout.write("\n");
  return out.sort((a, b) => b.score - a.score);
}

async function main(): Promise<void> {
  const cookie = process.env.INSTAGRAM_COOKIE_HEADER?.trim();
  if (!cookie && !DRY_RUN) throw new Error("INSTAGRAM_COOKIE_HEADER not set in .env");
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore not enabled");

  console.log("Ranking reel-worthy spots (this reads all of unexploredSpots)…");
  const ranked = await loadRankedSpots(db);
  console.log(`Eligible spots: ${ranked.length} (min score ${MIN_SCORE}).`);
  console.log("Top 15:", ranked.slice(0, 15).map((s) => `${s.name} [${s.score}]`).join(", "));

  if (DRY_RUN) {
    console.log("\nDRY RUN — no Instagram calls, no writes. Re-run without --dry-run to process.");
    return;
  }

  const progress = loadProgress();
  const done = new Set(progress.processedSpotIds);
  const queue = ranked.filter((s) => !done.has(s.id)).slice(0, MAX_SPOTS === Infinity ? undefined : MAX_SPOTS);
  console.log(`\nAlready processed: ${done.size}. This run will process: ${queue.length}. Pace: ${PACE_MS}ms.\n`);

  const seenShortcodes = new Set<string>();
  const stats = { ok: 0, nonOk: 0, rateLimited: 0 };
  const httpGetJson = async (url: string, headers: Record<string, string>): Promise<unknown> => {
    const res = await fetch(url, { headers });
    if (res.status === 200) { stats.ok++; return res.json(); }
    stats.nonOk++;
    if (res.status === 429) stats.rateLimited++;
    throw new Error(`ig_${res.status}`);
  };

  let processed = 0, writtenThisRun = 0, consecutiveTrouble = 0;
  for (const spot of queue) {
    const before = { ok: stats.ok, nonOk: stats.nonOk, rl: stats.rateLimited };
    const reels = (await fetchReelsForSpot(spot.name, { cookieHeader: cookie, httpGetJson }))
      .filter((r) => !seenShortcodes.has(r.shortcode))
      .map((r) => { seenShortcodes.add(r.shortcode); return { ...r, knownPlaceName: spot.name }; });

    let wrote = 0;
    if (reels.length > 0) {
      const summary = await runReelGeolocation(reels, "VT", {
        apiKey: "unused-known-place",
        loadSpotCandidates: async () => [{ id: spot.id, collection: "unexploredSpots", displayName: spot.name, lat: spot.lat, lng: spot.lng }],
        fetchCreator: async (reel) => (reel.ownerRaw ? extractInstagramOwner(reel.ownerRaw) : null),
      });
      for (const rec of summary.records) {
        try { UndiscoveredReelSchema.parse(rec); await db.collection("undiscoveredReels").doc(rec.id).set(rec, { merge: true }); wrote++; }
        catch { /* skip malformed */ }
      }
    }
    writtenThisRun += wrote;
    processed++;
    progress.processedSpotIds.push(spot.id);
    progress.writtenTotal += wrote;
    if (processed % 5 === 0) saveProgress(progress);
    console.log(`[${processed}/${queue.length}] ${spot.name.slice(0, 32).padEnd(32)} → ${reels.length} reels, ${wrote} written (total ${progress.writtenTotal})`);

    // Throttle detection: if every request for this spot failed, Instagram is
    // likely blocking. Back off; abort after repeated trouble so we don't dig in.
    const delta = { ok: stats.ok - before.ok, nonOk: stats.nonOk - before.nonOk, rl: stats.rateLimited - before.rl };
    if (delta.rl > 0 || (delta.ok === 0 && delta.nonOk > 0)) {
      consecutiveTrouble++;
      if (consecutiveTrouble >= 4) {
        saveProgress(progress);
        console.log(`\n⚠️  Instagram is blocking requests (${stats.rateLimited} rate-limited). Stopping cleanly — progress saved. Wait a while (or swap the session cookie) and re-run to resume.`);
        break;
      }
      const backoff = 60_000 * consecutiveTrouble;
      console.log(`  …throttle signal, backing off ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
    } else {
      consecutiveTrouble = 0;
    }
    await new Promise((r) => setTimeout(r, PACE_MS));
  }

  saveProgress(progress);
  console.log(`\nDONE this run — processed ${processed} spots, wrote ${writtenThisRun} reels. Grand total written across runs: ${progress.writtenTotal}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
