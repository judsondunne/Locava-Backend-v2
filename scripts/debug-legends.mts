import { getFirestoreSourceClient, primeFirestoreMutationChannel, primeFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { legendService } from "../src/domains/legends/legend.service.js";

const viewerId = process.env.LEGENDS_VIEWER_ID?.trim() || process.argv[2]?.trim() || "kZMGt2jvc2YRTvUhwUy0eJ3XOe93";
const otherUserId = process.env.LEGENDS_OTHER_VIEWER_ID?.trim() || process.argv[3]?.trim() || "leg_debug_other_user";

async function main(): Promise<void> {
  console.info("[debug:legends] viewer", { viewerId });
  await primeFirestoreSourceClient();
  await primeFirestoreMutationChannel();
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }

  // Stage preview (viewer becomes leader)
  const stage = await legendService.stagePost({
    userId: viewerId,
    geohash: "drt2yz",
    activityIds: ["waterfall", "hiking"],
    state: "VT"
  });
  console.info("[debug:legends] stage", {
    stageId: stage.stageId,
    scopes: stage.derivedScopes,
    previewCards: stage.previewCards.map((c) => c.type)
  });

  // Commit (simulate post finalize)
  const postId = `leg_debug_${Date.now()}`;
  const commit = await legendService.commitStagedPostLegend({
    stageId: stage.stageId,
    post: { postId, userId: viewerId }
  });
  console.info("[debug:legends] commit", commit);

  // Overtake: other user posts enough to pass viewer in the first scope.
  const firstScopeId = stage.derivedScopes[0] ?? null;
  if (firstScopeId) {
    console.info("[debug:legends] overtake", { scopeId: firstScopeId, otherUserId });
    const overtakeStage = await legendService.stagePost({
      userId: otherUserId,
      geohash: "drt2yz",
      activityIds: ["waterfall"],
      state: "VT"
    });
    // Post multiple times to ensure pass (bounded loop).
    const scopeRef = db.collection("legendScopes").doc(firstScopeId);
    const otherStatRef = db.collection("legendUserStats").doc(`${firstScopeId}_${otherUserId}`);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [scopeSnap, statSnap] = await db.getAll(scopeRef, otherStatRef);
      const leaderUserId = String(scopeSnap.get("leaderUserId") ?? "");
      const leaderCount = Number(scopeSnap.get("leaderCount") ?? 0) || 0;
      const otherCount = statSnap.exists ? (Number(statSnap.get("count") ?? 0) || 0) : 0;
      console.info("[debug:legends] overtake check", { leaderUserId, leaderCount, otherCount, attempt });
      if (leaderUserId === otherUserId) break;
      if (otherCount > leaderCount) break;
      const overtakePostId = `leg_overtake_${Date.now()}_${attempt}`;
      await legendService.processPostCreated({
        postId: overtakePostId,
        userId: otherUserId,
        geohash: "drt2yz",
        activities: ["waterfall"],
        state: "VT"
      } as any);
    }

    // Verify old leader has unseen overtake events.
    const eventsSnap = await db
      .collection("users")
      .doc(viewerId)
      .collection("legendEvents")
      .where("seen", "==", false)
      .limit(10)
      .get();
    console.info("[debug:legends] viewer unseen events", {
      count: eventsSnap.size,
      types: eventsSnap.docs.map((d) => String(d.get("eventType") ?? "")),
    });
  }

  // Read back awards (source-of-truth)
  const awardsSnap = await db
    .collection("users")
    .doc(viewerId)
    .collection("legendAwards")
    .where("postId", "==", postId)
    .get();
  console.info("[debug:legends] awards", {
    count: awardsSnap.size,
    awardTypes: awardsSnap.docs.map((d) => String(d.get("awardType") ?? ""))
  });

  // Print a couple of scopes for sanity
  const scopeIds = stage.derivedScopes.slice(0, 3);
  if (scopeIds.length > 0) {
    const scopeSnaps = await db.getAll(...scopeIds.map((id) => db.collection("legendScopes").doc(id)));
    for (let i = 0; i < scopeIds.length; i += 1) {
      const snap = scopeSnaps[i]!;
      console.info("[debug:legends] scope", {
        scopeId: scopeIds[i],
        exists: snap.exists,
        leaderUserId: snap.get("leaderUserId") ?? null,
        leaderCount: snap.get("leaderCount") ?? null,
        totalPosts: snap.get("totalPosts") ?? null
      });
    }
  }
}

main().catch((error) => {
  console.error("[debug:legends] failed", error);
  process.exitCode = 1;
});

