import process from "node:process";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { achievementCelebrationsService } from "../src/services/surfaces/achievement-celebrations.service.js";

function readArg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

async function main() {
  const userId = readArg("userId");
  const postId = readArg("postId");
  if (!userId || !postId) {
    throw new Error("Usage: npm run debug:post-xp-celebration -- --userId=<uid> --postId=<postId>");
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore source unavailable");

  const postSnap = await db.collection("posts").doc(postId).get();
  const awardSnap = await db.collection("users").doc(userId).collection("achievements_awards").doc(postId).get();
  const stateSnap = await db.collection("users").doc(userId).collection("achievements").doc("state").get();
  const celebrationsSnap = await db
    .collection("users")
    .doc(userId)
    .collection("achievementCelebrations")
    .where("sourcePostId", "==", postId)
    .limit(10)
    .get();
  const pending = await achievementCelebrationsService.getPendingCelebrations(userId);

  const award = (awardSnap.data() ?? {}) as Record<string, unknown>;
  const delta = (award.delta ?? {}) as Record<string, unknown>;
  const xpState = (((stateSnap.data() ?? {}) as Record<string, unknown>).xp ?? {}) as Record<string, unknown>;

  console.log("[debug:post-xp-celebration] post_exists", postSnap.exists);
  console.log("[debug:post-xp-celebration] xp_awarded_for_post", awardSnap.exists, {
    xpDelta: delta.xpGained ?? award.xp ?? null,
    newTotalXP: delta.newTotalXP ?? null,
    leaguePassCelebration: delta.leaguePassCelebration ?? null,
  });
  console.log("[debug:post-xp-celebration] current_user_xp", {
    current: xpState.current ?? null,
    level: xpState.level ?? null,
    tier: xpState.tier ?? null,
  });
  console.log(
    "[debug:post-xp-celebration] celebration_docs_for_post",
    celebrationsSnap.docs.map((doc) => ({
      path: doc.ref.path,
      ...doc.data(),
    })),
  );
  console.log("[debug:post-xp-celebration] pending_celebrations_view", pending);
  if (celebrationsSnap.empty) {
    console.log("[debug:post-xp-celebration] why_not_returned", "No celebration doc exists for sourcePostId");
  } else if (pending.length === 0) {
    console.log("[debug:post-xp-celebration] why_not_returned", "Docs exist but all filtered (consumed or shouldShow=false or peoplePassed<=0)");
  } else {
    console.log("[debug:post-xp-celebration] pending_route_would_return", true);
  }
}

main().catch((error) => {
  console.error("[debug:post-xp-celebration] failed", error);
  process.exit(1);
});
