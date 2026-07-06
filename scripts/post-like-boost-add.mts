import "dotenv/config";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { addPostLikeBoost, readPostLikeBoostTracking } from "../src/admin/postLikeBoost/postLikeBoost.service.js";
import { POST_LIKE_BOOST_POST_ID } from "../src/admin/postLikeBoost/postLikeBoost.constants.js";

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error(JSON.stringify({ ok: false, error: "firestore_unavailable" }));
    process.exitCode = 1;
    return;
  }

  const before = await readPostLikeBoostTracking(db);
  const result = await addPostLikeBoost(db);

  console.log(
    JSON.stringify(
      {
        ok: true,
        postId: POST_LIKE_BOOST_POST_ID,
        skippedBecauseActive: result.skippedBecauseActive,
        written: result.written,
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
