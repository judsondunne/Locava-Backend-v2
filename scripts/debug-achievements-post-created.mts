import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { postingAchievementsService } from "../src/services/mutations/posting-achievements.service.js";

function readFlag(name: string): string | null {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    const next = process.argv[index + 1];
    if (next && !next.startsWith("--")) return next.trim();
  }
  return null;
}

const viewerId =
  readFlag("--viewerId") ||
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const explicitPostId = readFlag("--postId");
const allowProductionMutation = process.argv.includes("--allow-production-mutation");
const dryRun = process.argv.includes("--dry-run") || !allowProductionMutation;

const db = getFirestoreSourceClient();
if (!db) {
  throw new Error("debug_achievements_post_created_requires_firestore");
}

let postsSnap;
if (explicitPostId) {
  postsSnap = await db.collection("posts").where("postId", "==", explicitPostId).limit(1).get();
} else {
  try {
    postsSnap = await db.collection("posts").where("userId", "==", viewerId).orderBy("createdAt", "desc").limit(1).get();
  } catch {
    postsSnap = await db.collection("posts").where("userId", "==", viewerId).limit(1).get();
  }
}
if (postsSnap.empty) {
  console.log(`viewer id: ${viewerId}`);
  console.log(`mode: ${dryRun ? "dry-run" : "mutation"}`);
  console.log("warning: no matching post found");
  process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
}

const postDoc = postsSnap.docs[0]!;
const post = { id: postDoc.id, ...(postDoc.data() as Record<string, unknown>) };
const canonicalPostId = String(post.postId ?? post.id);
const awardSnap = await db.collection("users").doc(viewerId).collection("achievements_awards").doc(canonicalPostId).get();
const stateSnap = await db.collection("users").doc(viewerId).collection("achievements").doc("state").get();
const state = (stateSnap.data() as Record<string, unknown> | undefined) ?? {};

console.log(`viewer id: ${viewerId}`);
console.log(`mode: ${dryRun ? "dry-run" : "mutation"}`);
console.log(`post id: ${canonicalPostId}`);
console.log(`post doc id: ${postDoc.id}`);
console.log(`activities: ${Array.isArray(post.activities) ? post.activities.join(", ") || "none" : "none"}`);
console.log(`post lat/long: ${String(post.lat ?? "n/a")}, ${String(post.long ?? post.lng ?? "n/a")}`);
console.log(`award exists: ${awardSnap.exists ? "yes" : "no"}`);
console.log(`current xp: ${((state.xp as Record<string, unknown> | undefined)?.current as number | undefined) ?? "n/a"}`);
console.log(`current visible streak source: ${JSON.stringify((state.weeklyExploration as Record<string, unknown> | undefined) ?? {})}`);
console.log(
  `pending leaderboard events: ${Array.isArray(state.pendingLeaderboardPassedEvents) ? state.pendingLeaderboardPassedEvents.length : 0}`
);

if (dryRun) {
  console.log("dry-run summary:");
  console.log(`  would invoke postingAchievementsService.processPostCreated for post ${canonicalPostId}`);
  console.log(`  expected base xp award: 50`);
  console.log(`  idempotent replay expected: ${awardSnap.exists ? "yes" : "no"}`);
  process.exit(process.exitCode ?? 0);
}

const delta = await postingAchievementsService.processPostCreated({
  viewerId,
  userId: viewerId,
  postId: canonicalPostId,
  activities: Array.isArray(post.activities) ? post.activities.map((value) => String(value ?? "")) : [],
  lat: post.lat as number | string | undefined,
  long: (post.long ?? post.lng) as number | string | undefined,
  address: typeof post.address === "string" ? post.address : undefined,
  requestAward: true
});

console.log("mutation delta:");
console.log(JSON.stringify(delta, null, 2));
