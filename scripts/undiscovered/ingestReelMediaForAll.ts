/**
 * Reel media ingest runner — make link-only reels playable.
 *
 * For each undiscoveredReels doc missing a hosted videoUrl: resolve IG's CDN
 * media, re-host on Wasabi, and write videoUrl + thumbnailUrl back onto the doc
 * (enrich in place — creator/location/shortcode are untouched). Idempotent
 * (skips reels already hosted) and paced (IG resolution is cookie-gated and
 * rate-limited).
 *
 * ⚠️ Re-hosting creators' videos is a product/IP decision. Confirm sign-off
 * before running this at scale. Attribution is preserved on every doc.
 *
 * Usage:
 *   npx tsx scripts/undiscovered/ingestReelMediaForAll.ts --dry-run   # count reels needing media
 *   npx tsx scripts/undiscovered/ingestReelMediaForAll.ts --max 20    # ingest a small batch
 *   npx tsx scripts/undiscovered/ingestReelMediaForAll.ts             # all, paced
 */
import "dotenv/config";
import { getFirestoreSourceClient } from "../../src/repositories/source-of-truth/firestore-client.js";
import { ingestReelMedia, createDefaultReelMediaDeps } from "../../src/lib/undiscovered/reels/ingestReelMedia.js";
import type { UndiscoveredReel } from "../../src/contracts/surfaces/undiscovered-reels.contract.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const flagVal = (name: string, def: number): number => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const MAX = flagVal("--max", Infinity);
const PACE_MS = flagVal("--pace", 4000);

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore not enabled");

  const snap = await db.collection("undiscoveredReels").get();
  const pending = snap.docs
    .map((d) => d.data() as UndiscoveredReel)
    .filter((r) => !r.videoUrl); // resume: already-hosted reels are skipped
  console.log(`${snap.size} reels total — ${pending.length} still need hosted media.`);

  if (DRY_RUN) {
    console.log("DRY RUN — no resolution, no upload. Re-run without --dry-run to ingest.");
    return;
  }

  const cookie = process.env.INSTAGRAM_COOKIE_HEADER?.trim();
  const deps = createDefaultReelMediaDeps({ cookieHeader: cookie });
  if (!deps) throw new Error("Wasabi not configured — set WASABI_ACCESS_KEY_ID / WASABI_SECRET_ACCESS_KEY in .env");

  const queue = pending.slice(0, MAX === Infinity ? undefined : MAX);
  let hosted = 0, unresolved = 0, failed = 0;
  for (let i = 0; i < queue.length; i++) {
    const reel = queue[i]!;
    try {
      const media = await ingestReelMedia(reel.shortcode, deps);
      if (!media) {
        unresolved++;
      } else {
        await db.collection("undiscoveredReels").doc(reel.id).update({
          videoUrl: media.videoUrl,
          thumbnailUrl: media.thumbnailUrl,
          updatedAt: new Date().toISOString(),
        });
        hosted++;
      }
    } catch (e) {
      failed++;
      console.log(`  [${i + 1}] ${reel.shortcode} → ERROR ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    if ((i + 1) % 10 === 0) console.log(`  [${i + 1}/${queue.length}] hosted:${hosted} unresolved:${unresolved} failed:${failed}`);
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  console.log(`\nDONE — hosted ${hosted}, unresolved ${unresolved}, failed ${failed}. Re-run to resume (hosted reels are skipped).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
