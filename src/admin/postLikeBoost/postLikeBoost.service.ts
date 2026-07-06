import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  POST_LIKE_BOOST_LIKE_COUNT,
  POST_LIKE_BOOST_POST_ID,
  POST_LIKE_BOOST_SOURCE,
  POST_LIKE_BOOST_TRACKING_COLLECTION,
  POST_LIKE_BOOST_TRACKING_DOC_ID
} from "./postLikeBoost.constants.js";
import { hydrateSeedLikerProfiles, resolveSeedLikerPool, type SeedLikerProfile } from "../seedLikes/loadSeedLikers.js";
import { countPostLikesSubcollection } from "../../repositories/surfaces/post-likes-subcollection-count.js";
import { readPostLikeCountFromFirestoreData } from "../../orchestration/mutations/post-document-like-count.js";

const BATCH_WRITE_CHUNK = 80;

export type PostLikeBoostTracking = {
  postId: string;
  runId: string;
  seedSource: string;
  status: "active" | "rolled_back";
  targetAdded: number;
  addedUserIds: string[];
  syntheticUserIds: string[];
  beforeSubcollectionCount: number;
  beforePostLikeCount: number;
  afterSubcollectionCount: number | null;
  afterPostLikeCount: number | null;
  createdAt: string;
  rolledBackAt: string | null;
};

type PlannedLike = {
  userId: string;
  profile: SeedLikerProfile;
  synthetic: boolean;
};

function trackingRef(db: Firestore) {
  return db.collection(POST_LIKE_BOOST_TRACKING_COLLECTION).doc(POST_LIKE_BOOST_TRACKING_DOC_ID);
}

function makeRunId(): string {
  return `post-like-boost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readPostAuthorId(data: Record<string, unknown>): string | null {
  const raw = data.userId ?? data.authorId ?? data.ownerId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function readExistingLikerIds(db: Firestore, postId: string): Promise<Set<string>> {
  const snap = await db.collection("posts").doc(postId).collection("likes").select().get();
  return new Set(snap.docs.map((doc) => doc.id));
}

function planLikes(input: {
  poolProfiles: SeedLikerProfile[];
  existingLikerIds: Set<string>;
  authorId: string | null;
  count: number;
  runId: string;
}): PlannedLike[] {
  const planned: PlannedLike[] = [];
  const used = new Set<string>(input.existingLikerIds);

  for (const profile of input.poolProfiles) {
    if (planned.length >= input.count) break;
    if (!profile.userId || used.has(profile.userId)) continue;
    if (input.authorId && profile.userId === input.authorId) continue;
    used.add(profile.userId);
    planned.push({ userId: profile.userId, profile, synthetic: false });
  }

  const templates =
    input.poolProfiles.length > 0
      ? input.poolProfiles
      : [
          {
            userId: "template",
            userHandle: "locava_user",
            userName: "Locava User",
            userPic: "https://via.placeholder.com/150"
          }
        ];

  let syntheticIndex = 0;
  while (planned.length < input.count) {
    const template = templates[syntheticIndex % templates.length]!;
    const userId = `plb_${input.runId.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}_${String(syntheticIndex).padStart(3, "0")}`;
    if (used.has(userId)) {
      syntheticIndex += 1;
      continue;
    }
    used.add(userId);
    planned.push({
      userId,
      profile: {
        userId,
        userHandle: template.userHandle,
        userName: template.userName,
        userPic: template.userPic
      },
      synthetic: true
    });
    syntheticIndex += 1;
  }

  return planned;
}

function buildLikePayload(input: { profile: SeedLikerProfile; runId: string }): Record<string, unknown> {
  return {
    userId: input.profile.userId,
    userHandle: input.profile.userHandle,
    userName: input.profile.userName,
    userPic: input.profile.userPic,
    seeded: true,
    seedSource: POST_LIKE_BOOST_SOURCE,
    seedRunId: input.runId,
    suppressNotification: true,
    suppressAnalytics: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function writePlannedLikes(db: Firestore, postId: string, planned: PlannedLike[], runId: string): Promise<number> {
  if (planned.length === 0) return 0;

  const postRef = db.collection("posts").doc(postId);
  let written = 0;

  for (let offset = 0; offset < planned.length; offset += BATCH_WRITE_CHUNK) {
    const chunk = planned.slice(offset, offset + BATCH_WRITE_CHUNK);
    const batch = db.batch();
    const now = new Date();

    for (const like of chunk) {
      const likeRef = postRef.collection("likes").doc(like.userId);
      batch.set(likeRef, buildLikePayload({ profile: like.profile, runId }), { merge: false });

      if (!like.synthetic) {
        const userRef = db.collection("users").doc(like.userId);
        batch.set(
          userRef,
          {
            likedPosts: FieldValue.arrayUnion(postId),
            updatedAt: now
          },
          { merge: true }
        );
        batch.set(
          userRef.collection("likedPostsMeta").doc(postId),
          {
            postId,
            userId: like.userId,
            likedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            seeded: true,
            seedSource: POST_LIKE_BOOST_SOURCE,
            seedRunId: runId,
            suppressNotification: true,
            suppressAnalytics: true
          },
          { merge: true }
        );
      }
    }

    batch.set(
      postRef,
      {
        likeCount: FieldValue.increment(chunk.length),
        likesCount: FieldValue.increment(chunk.length),
        updatedAt: now,
        lastUpdated: now
      },
      { merge: true }
    );

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

export async function readPostLikeBoostTracking(db: Firestore): Promise<PostLikeBoostTracking | null> {
  const snap = await trackingRef(db).get();
  if (!snap.exists) return null;
  return snap.data() as PostLikeBoostTracking;
}

export async function addPostLikeBoost(db: Firestore): Promise<{
  tracking: PostLikeBoostTracking;
  written: number;
  skippedBecauseActive: boolean;
}> {
  const postId = POST_LIKE_BOOST_POST_ID;
  const existingTracking = await readPostLikeBoostTracking(db);
  if (existingTracking?.status === "active") {
    return { tracking: existingTracking, written: 0, skippedBecauseActive: true };
  }

  const postRef = db.collection("posts").doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new Error(`post_not_found:${postId}`);
  }

  const postData = (postSnap.data() ?? {}) as Record<string, unknown>;
  const authorId = readPostAuthorId(postData);
  const beforeSubcollectionCount = await countPostLikesSubcollection(db, postId);
  const beforePostLikeCount = readPostLikeCountFromFirestoreData(postData);

  const pool = await resolveSeedLikerPool(db, true);
  const profileMap = await hydrateSeedLikerProfiles(db, pool.ids);
  const poolProfiles = pool.ids.map((userId) => profileMap.get(userId) ?? { userId, userHandle: null, userName: "Locava User", userPic: null });
  const existingLikerIds = await readExistingLikerIds(db, postId);
  const runId = makeRunId();
  const planned = planLikes({
    poolProfiles,
    existingLikerIds,
    authorId,
    count: POST_LIKE_BOOST_LIKE_COUNT,
    runId
  });

  const toWrite: PlannedLike[] = [];
  for (const like of planned) {
    if (existingLikerIds.has(like.userId)) continue;
    toWrite.push(like);
  }

  const written = await writePlannedLikes(db, postId, toWrite, runId);
  const afterSubcollectionCount = await countPostLikesSubcollection(db, postId);
  const afterPostSnap = await postRef.get();
  const afterPostLikeCount = readPostLikeCountFromFirestoreData((afterPostSnap.data() ?? {}) as Record<string, unknown>);

  const tracking: PostLikeBoostTracking = {
    postId,
    runId,
    seedSource: POST_LIKE_BOOST_SOURCE,
    status: "active",
    targetAdded: POST_LIKE_BOOST_LIKE_COUNT,
    addedUserIds: toWrite.map((like) => like.userId),
    syntheticUserIds: toWrite.filter((like) => like.synthetic).map((like) => like.userId),
    beforeSubcollectionCount,
    beforePostLikeCount,
    afterSubcollectionCount,
    afterPostLikeCount,
    createdAt: new Date().toISOString(),
    rolledBackAt: null
  };

  await trackingRef(db).set(tracking);
  return { tracking, written, skippedBecauseActive: false };
}

export async function removePostLikeBoost(db: Firestore): Promise<{
  tracking: PostLikeBoostTracking | null;
  removed: number;
}> {
  const tracking = await readPostLikeBoostTracking(db);
  if (!tracking || tracking.status !== "active") {
    return { tracking, removed: 0 };
  }

  const postId = tracking.postId;
  const postRef = db.collection("posts").doc(postId);
  let removed = 0;

  for (let offset = 0; offset < tracking.addedUserIds.length; offset += BATCH_WRITE_CHUNK) {
    const chunk = tracking.addedUserIds.slice(offset, offset + BATCH_WRITE_CHUNK);
    const likeRefs = chunk.map((userId) => postRef.collection("likes").doc(userId));
    const likeSnaps = await db.getAll(...likeRefs);
    const batch = db.batch();
    const now = new Date();
    let chunkRemoved = 0;

    for (let i = 0; i < chunk.length; i += 1) {
      const userId = chunk[i]!;
      const likeSnap = likeSnaps[i];
      if (!likeSnap?.exists) continue;
      const data = (likeSnap.data() ?? {}) as Record<string, unknown>;
      if (data.seedSource !== POST_LIKE_BOOST_SOURCE || data.seedRunId !== tracking.runId) continue;

      batch.delete(likeSnap.ref);
      chunkRemoved += 1;

      if (!tracking.syntheticUserIds.includes(userId)) {
        const userRef = db.collection("users").doc(userId);
        batch.set(
          userRef,
          {
            likedPosts: FieldValue.arrayRemove(postId),
            updatedAt: now
          },
          { merge: true }
        );
        batch.delete(userRef.collection("likedPostsMeta").doc(postId));
      }
    }

    if (chunkRemoved > 0) {
      batch.set(
        postRef,
        {
          likeCount: FieldValue.increment(-chunkRemoved),
          likesCount: FieldValue.increment(-chunkRemoved),
          updatedAt: now,
          lastUpdated: now
        },
        { merge: true }
      );
      await batch.commit();
      removed += chunkRemoved;
    }
  }

  const rolledBack: PostLikeBoostTracking = {
    ...tracking,
    status: "rolled_back",
    rolledBackAt: new Date().toISOString()
  };
  await trackingRef(db).set(rolledBack);

  return { tracking: rolledBack, removed };
}
