import { FieldValue } from "firebase-admin/firestore";
import { OLD_WEB_SEED_LIKER_IDS } from "../src/admin/seedLikes/oldWebSeedLikers.constants.ts";
import { hydrateSeedLikerProfiles } from "../src/admin/seedLikes/loadSeedLikers.ts";
import { planSeedLikesForPost, writeSeedPostPlan } from "../src/admin/seedLikes/seedLikes.service.ts";
import { defaultSeedLikesConfig } from "../src/admin/seedLikes/seedLikesConfig.ts";
import { getEmulatorDb } from "../test/firestore/common.mts";

const config = {
  ...defaultSeedLikesConfig(),
  allowWrites: true,
  batchSize: 50,
  runIdPrefix: "seed-likes-harness"
};

async function main(): Promise<void> {
  const db = getEmulatorDb();
  const postId = "seed_likes_harness_post";
  const authorId = "seed_likes_harness_author";
  const seedLikerIds = [...OLD_WEB_SEED_LIKER_IDS];

  await db.collection("likeBoosterSetting").doc("global").set({
    likers: seedLikerIds,
    engaged: true
  });

  await db.collection("users").doc(authorId).set({ handle: "harness_author", name: "Harness Author" }, { merge: true });
  await db.collection("posts").doc(postId).set(
    {
      userId: authorId,
      title: "Seed likes harness post",
      likesCount: 3,
      likeCount: 3
    },
    { merge: true }
  );

  for (const userId of seedLikerIds.slice(0, 3)) {
    await db.collection("posts").doc(postId).collection("likes").doc(userId).set({
      userId,
      userName: userId,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  const profileMap = await hydrateSeedLikerProfiles(db, seedLikerIds);
  const runId = `${config.runIdPrefix}-${Date.now()}`;
  const dryPlan = await planSeedLikesForPost({
    db,
    postId,
    postData: (await db.collection("posts").doc(postId).get()).data() as Record<string, unknown>,
    config,
    seedLikerIds,
    profileMap,
    runId,
    rng: () => 0
  });

  const firstWrite = dryPlan ? await writeSeedPostPlan(db, dryPlan, runId) : 0;
  const postAfterFirst = await db.collection("posts").doc(postId).get();
  const likesAfterFirst = await db.collection("posts").doc(postId).collection("likes").get();

  const secondPlan = await planSeedLikesForPost({
    db,
    postId,
    postData: (postAfterFirst.data() ?? {}) as Record<string, unknown>,
    config,
    seedLikerIds,
    profileMap,
    runId: `${runId}-2`,
    rng: () => 0
  });
  const secondWrite = secondPlan ? await writeSeedPostPlan(db, secondPlan, `${runId}-2`) : 0;

  console.log(
    JSON.stringify(
      {
        postId,
        dryRunPlannedLikes: dryPlan?.likeDocs.length ?? 0,
        dryRunFirstLikePath: dryPlan?.likeDocs[0]?.path ?? null,
        firstWriteAdded: firstWrite,
        likesAfterFirst: likesAfterFirst.size,
        postLikeCountAfterFirst: postAfterFirst.data()?.likesCount ?? null,
        secondWriteAdded: secondWrite,
        secondPlanLikes: secondPlan?.likeDocs.length ?? 0
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
