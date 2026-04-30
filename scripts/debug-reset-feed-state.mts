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
  if (!viewerId) {
    throw new Error("missing_viewer_id:pass --viewerId=<viewerId>");
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }

  const feedStateRef = db.collection("users").doc(viewerId).collection("feedState").doc("home_for_you");
  await feedStateRef.delete().catch(() => undefined);

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
      deletedFeedState: true,
      servedDeleted
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
