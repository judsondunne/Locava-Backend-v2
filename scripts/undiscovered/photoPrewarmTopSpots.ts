/**
 * Photo pre-warm — attach validated photos to the top undiscovered spots.
 *
 * Reads production unexploredSpots, ranks by photogenic category + distinctive
 * name, and runs each through the production photo pipeline
 * (searchPlaceWebImagesForUndiscovered), which searches, validates the match,
 * and caches results onto the doc's photoSearch field — the same thing a user
 * tap does, just ahead of time.
 *
 * Budget-aware: stays under the global daily provider budget (default 500) and
 * paces below the per-viewer rate limit by rotating viewer ids.
 *
 * Usage: npx tsx scripts/undiscovered/photoPrewarmTopSpots.ts [maxSpots]
 */
import { loadEnv } from "../../src/config/env.js";
import { getFirestoreSourceClient } from "../../src/repositories/source-of-truth/firestore-client.js";
import { searchPlaceWebImagesForUndiscovered } from "../../src/services/undiscovered/undiscoveredPhotoSearch.service.js";
import { isWebRankableName } from "../../src/lib/undiscovered/spotRanking.js";

const MAX_SPOTS = Number(process.argv[2] ?? 450);
const PACE_MS = 5500;

const CATEGORY_PRIORITY: Array<[RegExp, number]> = [
  [/waterfall|falls|cascade/i, 100],
  [/gorge|canyon|ravine/i, 90],
  [/swim/i, 85],
  [/state park|state forest/i, 80],
  [/summit|peak|viewpoint|overlook|vista|lookout/i, 75],
  [/lake|pond|reservoir/i, 60],
  [/beach/i, 60],
  [/trail/i, 40],
];

function nameScore(name: string, category: string): number {
  let score = 0;
  const hay = `${name} ${category}`;
  for (const [re, pts] of CATEGORY_PRIORITY) {
    if (re.test(hay)) { score = Math.max(score, pts); break; }
  }
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) score += 10;
  if (words.length >= 3) score += 5;
  if (name.includes("=") || /^\d+$/.test(name)) score = -1;
  return score;
}

async function main() {
  const env = loadEnv();
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore not enabled");

  console.log("Loading spot candidates from production…");
  const snap = await db
    .collection("unexploredSpots")
    .select("displayName", "category", "lat", "lng", "location", "photoSearch")
    .limit(6000)
    .get();

  const ranked = snap.docs
    .map((doc) => {
      const d = doc.data() as Record<string, any>;
      return {
        id: doc.id,
        name: String(d.displayName ?? ""),
        category: String(d.category ?? ""),
        lat: Number(d.lat ?? 0),
        lng: Number(d.lng ?? 0),
        town: d.location?.city as string | undefined,
        state: (d.location?.state as string | undefined) ?? "VT",
        hasPhotos: Boolean(d.photoSearch),
        score: nameScore(String(d.displayName ?? ""), String(d.category ?? "")),
      };
    })
    .filter((s) => s.score > 20 && !s.hasPhotos && s.name.length > 5 && isWebRankableName(s.name))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SPOTS);

  console.log(`Pre-warming ${ranked.length} spots (of ${snap.size} scanned)…`);
  let ready = 0, empty = 0, failed = 0;
  for (let i = 0; i < ranked.length; i++) {
    const s = ranked[i]!;
    try {
      const result = await searchPlaceWebImagesForUndiscovered({
        env,
        viewerId: `photo-prewarm-${i % 40}`,
        body: {
          id: s.id,
          collection: "unexploredSpots",
          name: s.name,
          town: s.town,
          state: s.state,
          lat: s.lat,
          long: s.lng,
        },
      });
      if (result.ok) {
        const status = (result.response as { cacheStatus?: string }).cacheStatus ?? "?";
        if (status === "hit" || status === "miss" || status === "refreshed") ready++;
        else empty++;
        if (i % 10 === 0 || String(status) === "ready") {
          console.log(`[${i + 1}/${ranked.length}] ${s.name.slice(0, 34).padEnd(34)} → ${status}`);
        }
      } else {
        failed++;
        console.log(`[${i + 1}/${ranked.length}] ${s.name.slice(0, 34).padEnd(34)} → FAIL ${result.code}`);
        if (result.code === "provider_budget_exceeded") break;
      }
    } catch (error) {
      failed++;
      console.log(`[${i + 1}/${ranked.length}] ${s.name.slice(0, 30)} → ERROR ${error instanceof Error ? error.message.slice(0, 60) : error}`);
    }
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  console.log(`\nDONE — photos ready: ${ready} | no verified match: ${empty} | failed: ${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
