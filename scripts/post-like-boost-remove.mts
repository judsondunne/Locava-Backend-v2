import "dotenv/config";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { readPostLikeBoostTracking, removePostLikeBoost } from "../src/admin/postLikeBoost/postLikeBoost.service.js";
import { POST_LIKE_BOOST_POST_ID } from "../src/admin/postLikeBoost/postLikeBoost.constants.js";

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error(JSON.stringify({ ok: false, error: "firestore_unavailable" }));
    process.exitCode = 1;
    return;
  }

  const before = await readPostLikeBoostTracking(db);
  const result = await removePostLikeBoost(db);

  console.log(
    JSON.stringify(
      {
        ok: true,
        postId: POST_LIKE_BOOST_POST_ID,
        removed: result.removed,
        beforeTrackingStatus: before?.status ?? null,
        tracking: result.tracking
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
