import { getFirestoreSourceClient, primeFirestoreMutationChannel, primeFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { legendService } from "../src/domains/legends/legend.service.js";
import { encodeGeohash } from "../src/lib/latlng-geohash.js";

const userId = process.env.LEGENDS_ACCEPT_USER_ID?.trim() || "OQnqN10jqZbZWNcmNHYQc8ORBDz2";
const lat = Number(process.env.LEGENDS_ACCEPT_LAT ?? "43.44441");
const lng = Number(process.env.LEGENDS_ACCEPT_LNG ?? "-72.44994");
const activities = (process.env.LEGENDS_ACCEPT_ACTIVITIES ?? "hiking,diving")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const city = process.env.LEGENDS_ACCEPT_CITY?.trim() || "Town of Windsor";
const state = process.env.LEGENDS_ACCEPT_STATE?.trim() || "Vermont";
const country = process.env.LEGENDS_ACCEPT_COUNTRY?.trim() || "US";

async function main(): Promise<void> {
  console.info("[debug:legends:acceptance] start", {
    userId,
    lat,
    lng,
    activities,
    city,
    state,
    country
  });

  await primeFirestoreSourceClient();
  await primeFirestoreMutationChannel();
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }

  const geohash = encodeGeohash(lat, lng, 9);
  const stage = await legendService.stagePost({
    userId,
    lat,
    lng,
    geohash,
    activityIds: activities,
    city,
    state,
    country,
    region: city
  });

  console.info("[debug:legends:acceptance] stage_post_done", {
    stageId: stage.stageId,
    stageDocPath: `legendPostStages/${stage.stageId}`,
    derivedScopeCount: stage.derivedScopes.length,
    derivedScopes: stage.derivedScopes
  });

  if (stage.derivedScopes.length < 8) {
    throw new Error(`expected_stage_scope_count_gte_8 got=${stage.derivedScopes.length}`);
  }

  const stageSnap = await db.collection("legendPostStages").doc(stage.stageId).get();
  const persistedScopes = Array.isArray(stageSnap.get("derivedScopes"))
    ? (stageSnap.get("derivedScopes") as unknown[]).map((value) => String(value ?? "")).filter(Boolean)
    : [];
  console.info("[debug:legends:acceptance] stage_doc_readback", {
    stageDocPath: stageSnap.ref.path,
    persistedScopeCount: persistedScopes.length,
    persistedScopes
  });

  const postId = `leg_accept_${Date.now()}`;
  await db.collection("posts").doc(postId).set({
    postId,
    userId,
    ownerId: userId,
    activities,
    lat,
    lng,
    long: lng,
    geohash,
    privacy: "Public Spot",
    geoData: { city, state, country },
    stateRegionId: state,
    countryRegionId: country,
    finalized: true,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  console.info("[debug:legends:acceptance] commit_staged_start", {
    stageId: stage.stageId,
    postId,
    userId
  });

  const commit = await legendService.commitStagedPostLegend({
    stageId: stage.stageId,
    post: {
      postId,
      userId,
      activities,
      city,
      state,
      country,
      geohash,
      privacy: "Public Spot",
      finalized: true
    }
  });

  console.info("[debug:legends:acceptance] commit_staged_done", {
    stageId: stage.stageId,
    postId,
    committed: commit.committed,
    alreadyProcessed: commit.alreadyProcessed,
    awardsCreated: commit.awardsCreated,
    derivedScopeCount: commit.derivedScopes.length,
    derivedScopes: commit.derivedScopes,
    ineligibleReason: (commit as { ineligibleReason?: string | null }).ineligibleReason ?? null
  });

  if (commit.derivedScopes.length < 8) {
    throw new Error(`expected_commit_scope_count_gte_8 got=${commit.derivedScopes.length}`);
  }

  const awardsSnap = await db
    .collection("users")
    .doc(userId)
    .collection("legendAwards")
    .where("postId", "==", postId)
    .get();
  console.info("[debug:legends:acceptance] awards", {
    count: awardsSnap.size,
    awardTypes: awardsSnap.docs.map((doc) => String(doc.get("awardType") ?? ""))
  });

  const postResultSnap = await db.collection("legendPostResults").doc(postId).get();
  console.info("[debug:legends:acceptance] post_result", {
    exists: postResultSnap.exists,
    status: postResultSnap.get("status") ?? null,
    awardCount: Array.isArray(postResultSnap.get("awards")) ? (postResultSnap.get("awards") as unknown[]).length : 0,
    reasonIfEmpty: postResultSnap.get("reasonIfEmpty") ?? null
  });

  const legendsStateSnap = await db.collection("users").doc(userId).collection("legends").doc("state").get();
  console.info("[debug:legends:acceptance] legends_state", {
    exists: legendsStateSnap.exists,
    activeScopeCount: Array.isArray(legendsStateSnap.get("activeScopeIds"))
      ? (legendsStateSnap.get("activeScopeIds") as unknown[]).length
      : 0,
    recentAwardCount: Array.isArray(legendsStateSnap.get("recentAwardIds"))
      ? (legendsStateSnap.get("recentAwardIds") as unknown[]).length
      : 0
  });

  if (commit.awardsCreated <= 0 && awardsSnap.size <= 0) {
    console.warn("[debug:legends:acceptance] no_awards_created", {
      note: "May be expected when scopes already have leaders; inspect post_result.reasonIfEmpty and award eligibility logs."
    });
  }
}

main().catch((error) => {
  console.error("[debug:legends:acceptance] failed", error);
  process.exitCode = 1;
});
