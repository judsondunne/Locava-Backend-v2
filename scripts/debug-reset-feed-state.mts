import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

function readArg(name: string): string | null {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3).trim() || null;
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

async function main(): Promise<void> {
  const viewerId = readArg("viewerId");
  const deleteServed = readArg("deleteServed");
  const resetAll = readArg("resetAll");
  const resetReels = readArg("resetReels");
  const resetRegular = readArg("resetRegular");
  if (!viewerId) {
    throw new Error("missing_viewer_id:pass --viewerId=<viewerId>");
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }

  const feedStateRef = db.collection("users").doc(viewerId).collection("feedState").doc("home_for_you");
  const shouldResetAll =
    !resetReels &&
    !resetRegular &&
    (resetAll == null || resetAll === "1" || resetAll === "true" || resetAll === "yes");
  const shouldResetReels = resetReels === "1" || resetReels === "true" || resetReels === "yes";
  const shouldResetRegular = resetRegular === "1" || resetRegular === "true" || resetRegular === "yes";

  let deletedFeedState = false;
  let reelQueueIndexReset = false;
  let regularQueueIndexReset = false;

  if (shouldResetAll) {
    await feedStateRef.delete().catch(() => undefined);
    deletedFeedState = true;
  } else if (shouldResetReels || shouldResetRegular) {
    const patch: Record<string, unknown> = {};
    if (shouldResetReels) {
      patch.reelQueueIndex = 0;
      reelQueueIndexReset = true;
    }
    if (shouldResetRegular) {
      patch.regularQueueIndex = 0;
      regularQueueIndexReset = true;
    }
    if (Object.keys(patch).length > 0) {
      await feedStateRef.set(patch, { merge: true });
    }
  }

  let servedDeleted = 0;
  if (deleteServed === "1" || deleteServed === "true" || deleteServed === "yes") {
    const servedSnap = await db.collection("users").doc(viewerId).collection("feedServed").get();
    const batch = db.batch();
    for (const doc of servedSnap.docs) {
      if (String(doc.get("feedSurface") ?? "") !== "home_for_you") continue;
      batch.delete(doc.ref);
      servedDeleted += 1;
    }
    if (servedDeleted > 0) await batch.commit();
  }

  console.log(
    JSON.stringify({
      viewerId,
      deletedFeedState,
      reelQueueIndexReset,
      regularQueueIndexReset,
      servedDeleted
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
