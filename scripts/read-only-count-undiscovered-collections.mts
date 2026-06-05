#!/usr/bin/env npx tsx
/** READ-ONLY — top-level doc counts for undiscovered map collections. */
import "dotenv/config";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

async function countCollection(name: string): Promise<number> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const snap = await db.collection(name).count().get();
  return Number(snap.data().count ?? 0);
}

async function sampleTileItemCount(maxTiles: number): Promise<{ tileDocs: number; itemCount: number }> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const snap = await db.collection("unexploredTiles").limit(maxTiles).get();
  let itemCount = 0;
  for (const doc of snap.docs) {
    const items = (doc.data() as { items?: unknown[] }).items;
    if (Array.isArray(items)) itemCount += items.length;
  }
  return { tileDocs: snap.size, itemCount };
}

async function main(): Promise<void> {
  const [unexploredSpots, unexploredRoutes, unexploredTiles] = await Promise.all([
    countCollection("unexploredSpots"),
    countCollection("unexploredRoutes"),
    countCollection("unexploredTiles"),
  ]);
  const tileSample = unexploredTiles > 0 ? await sampleTileItemCount(5) : { tileDocs: 0, itemCount: 0 };

  console.log(
    JSON.stringify(
      {
        unexploredSpots,
        unexploredRoutes,
        unexploredTiles,
        tileSampleFirst5Docs: tileSample,
        note:
          "Map loads unexploredTiles FIRST, then falls back to spots/routes. Purge of spots+routes alone leaves tile cache visible on map.",
        postsNotCounted: true,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
