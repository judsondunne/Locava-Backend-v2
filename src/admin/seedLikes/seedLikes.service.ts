import { FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";
import type { SeedLikesConfig } from "./seedLikesConfig.js";
import {
  hydrateSeedLikerProfiles,
  resolveSeedLikerPool,
  type SeedLikerPoolResolution,
  type SeedLikerProfile
} from "./loadSeedLikers.js";
import { selectSeedLikersForPost, type SeedLikerTargetSelection } from "./seedLikerSelection.js";
import {
  beginSeedLikesRun,
  finishSeedLikesRun,
  getSeedLikesRunStatus,
  incrementSeedLikesCounters,
  pushSeedLikesEvent,
  requestSeedLikesStop,
  setSeedLikesCurrentPost,
  setSeedLikesDryRunPreview,
  shouldStopSeedLikesRun
} from "./seedLikesStatus.js";
import { readPostLikeCountFromFirestoreData } from "../../orchestration/mutations/post-document-like-count.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

export const SEED_LIKES_SOURCE = "backendv2_seed_likes_backfill";
const PROGRESS_LOG_INTERVAL = 25;

export type SeedLikeDocPlan = {
  path: string;
  payload: Record<string, unknown>;
};

export type SeedPostPlanOutcome =
  | "ready"
  | "skipped_below_target_min"
  | "skipped_no_available"
  | "skipped_no_likes_needed";

export type SeedPostPlan = {
  postId: string;
  title: string | null;
  authorId: string | null;
  currentLikeCount: number;
  targetLikeCount: number;
  outcome: SeedPostPlanOutcome;
  warning: string | null;
  seedLikerPool: Pick<SeedLikerPoolResolution, "source" | "firestoreCount" | "snapshotCount"> & {
    loadedSeedLikerCount: number;
  };
  targetSelection: SeedLikerTargetSelection;
  selectedSeedLikers: Array<SeedLikerProfile & { path: string }>;
  likeDocs: SeedLikeDocPlan[];
  postCounterUpdate: {
    path: string;
    likeCountIncrement: number;
    likesCountIncrement: number;
  };
};

export class SeedLikesWriteDisabledError extends Error {
  constructor() {
    super("seed_likes_writes_disabled");
    this.name = "SeedLikesWriteDisabledError";
  }
}

export class SeedLikesAlreadyRunningError extends Error {
  constructor() {
    super("seed_likes_already_running");
    this.name = "SeedLikesAlreadyRunningError";
  }
}

function readPostTitle(data: Record<string, unknown>): string | null {
  const title = data.title ?? data.postTitle ?? data.caption;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function readPostAuthorId(data: Record<string, unknown>): string | null {
  const raw = data.userId ?? data.authorId ?? data.ownerId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function buildLikeDocPath(postId: string, userId: string): string {
  return `posts/${postId}/likes/${userId}`;
}

async function readExistingSeedLikerIds(
  db: Firestore,
  postId: string,
  seedLikerIds: readonly string[]
): Promise<Set<string>> {
  const postRef = db.collection("posts").doc(postId);
  const existing = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < seedLikerIds.length; i += 10) {
    chunks.push(seedLikerIds.slice(i, i + 10));
  }
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    const refs = chunk.map((userId) => postRef.collection("likes").doc(userId));
    const snaps = await db.getAll(...refs);
    for (let i = 0; i < chunk.length; i += 1) {
      if (snaps[i]?.exists) {
        existing.add(chunk[i]!);
      }
    }
  }
  return existing;
}

function buildLikePayload(input: {
  profile: SeedLikerProfile;
  runId: string;
}): Record<string, unknown> {
  return {
    userId: input.profile.userId,
    userHandle: input.profile.userHandle,
    userName: input.profile.userName,
    userPic: input.profile.userPic,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    seeded: true,
    seedSource: SEED_LIKES_SOURCE,
    seedRunId: input.runId,
    suppressNotification: true,
    suppressAnalytics: true
  };
}

function buildSeedPostPlan(input: {
  postId: string;
  postData: Record<string, unknown>;
  seedLikerPool: SeedLikerPoolResolution;
  selection: SeedLikerTargetSelection;
  profileMap: Map<string, SeedLikerProfile>;
  runId: string;
}): SeedPostPlan {
  const authorId = readPostAuthorId(input.postData);
  const currentLikeCount = readPostLikeCountFromFirestoreData(input.postData);
  const likeDocs: SeedLikeDocPlan[] = [];
  const selectedSeedLikers: Array<SeedLikerProfile & { path: string }> = [];

  let outcome: SeedPostPlanOutcome = "ready";
  let warning: string | null = null;

  if (input.selection.blockedBelowTargetMin) {
    outcome = "skipped_below_target_min";
    warning = input.selection.clampReason;
  } else if (input.selection.skippedNoAvailable) {
    outcome = "skipped_no_available";
    warning = input.selection.clampReason;
  } else if (input.selection.selectedUserIds.length === 0) {
    outcome = "skipped_no_likes_needed";
  } else {
    for (const userId of input.selection.selectedUserIds) {
      const profile = input.profileMap.get(userId) ?? {
        userId,
        userHandle: null,
        userName: "Unknown User",
        userPic: "https://via.placeholder.com/150"
      };
      const path = buildLikeDocPath(input.postId, userId);
      likeDocs.push({
        path,
        payload: buildLikePayload({ profile, runId: input.runId })
      });
      selectedSeedLikers.push({ ...profile, path });
    }
    if (input.selection.clampedBelowTargetMin) {
      warning = input.selection.clampReason;
    }
  }

  return {
    postId: input.postId,
    title: readPostTitle(input.postData),
    authorId,
    currentLikeCount,
    targetLikeCount: input.selection.targetLikeCount,
    outcome,
    warning,
    seedLikerPool: {
      source: input.seedLikerPool.source,
      firestoreCount: input.seedLikerPool.firestoreCount,
      snapshotCount: input.seedLikerPool.snapshotCount,
      loadedSeedLikerCount: input.seedLikerPool.ids.length
    },
    targetSelection: input.selection,
    selectedSeedLikers,
    likeDocs,
    postCounterUpdate: {
      path: `posts/${input.postId}`,
      likeCountIncrement: likeDocs.length,
      likesCountIncrement: likeDocs.length
    }
  };
}

export async function planSeedLikesForPost(input: {
  db: Firestore;
  postId: string;
  postData: Record<string, unknown>;
  config: SeedLikesConfig;
  seedLikerPool: SeedLikerPoolResolution;
  profileMap: Map<string, SeedLikerProfile>;
  runId: string;
  rng?: () => number;
}): Promise<SeedPostPlan | null> {
  const currentLikeCount = readPostLikeCountFromFirestoreData(input.postData);
  if (currentLikeCount >= input.config.minExistingLikes) {
    return null;
  }

  const authorId = readPostAuthorId(input.postData);
  const existingLikerIds = await readExistingSeedLikerIds(input.db, input.postId, input.seedLikerPool.ids);
  const selection = selectSeedLikersForPost({
    seedLikerIds: input.seedLikerPool.ids,
    existingLikerIds,
    authorUserId: authorId,
    currentLikeCount,
    targetMin: input.config.targetMin,
    targetMax: input.config.targetMax,
    allowTargetBelowMin: input.config.allowTargetBelowMin,
    rng: input.rng
  });

  return buildSeedPostPlan({
    postId: input.postId,
    postData: input.postData,
    seedLikerPool: input.seedLikerPool,
    selection,
    profileMap: input.profileMap,
    runId: input.runId
  });
}

export async function writeSeedPostPlan(db: Firestore, plan: SeedPostPlan, runId: string): Promise<number> {
  if (plan.likeDocs.length === 0) {
    return 0;
  }

  const postRef = db.collection("posts").doc(plan.postId);
  const result = { written: 0 };

  await db.runTransaction(async (tx) => {
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists) {
      throw new Error(`post_not_found:${plan.postId}`);
    }

    const toCreate: SeedLikeDocPlan[] = [];
    for (const likeDoc of plan.likeDocs) {
      const userId = String(likeDoc.payload.userId ?? "");
      const likeRef = postRef.collection("likes").doc(userId);
      const likeSnap = await tx.get(likeRef);
      if (!likeSnap.exists) {
        toCreate.push(likeDoc);
      }
    }

    if (toCreate.length === 0) {
      return;
    }

    const now = new Date();
    for (const likeDoc of toCreate) {
      const userId = String(likeDoc.payload.userId ?? "");
      const likeRef = postRef.collection("likes").doc(userId);
      tx.set(likeRef, {
        ...likeDoc.payload,
        seedRunId: runId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });

      const userRef = db.collection("users").doc(userId);
      tx.set(
        userRef,
        {
          likedPosts: FieldValue.arrayUnion(plan.postId),
          updatedAt: now
        },
        { merge: true }
      );
      tx.set(
        userRef.collection("likedPostsMeta").doc(plan.postId),
        {
          postId: plan.postId,
          userId,
          likedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          seeded: true,
          seedSource: SEED_LIKES_SOURCE,
          seedRunId: runId,
          suppressNotification: true,
          suppressAnalytics: true
        },
        { merge: true }
      );
    }

    tx.set(
      postRef,
      {
        likeCount: FieldValue.increment(toCreate.length),
        likesCount: FieldValue.increment(toCreate.length),
        updatedAt: now,
        lastUpdated: now
      },
      { merge: true }
    );
    result.written = toCreate.length;
  });

  return result.written;
}

function makeRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logProgress(): void {
  const s = getSeedLikesRunStatus();
  console.log(
    `SEED_LIKES_PROGRESS scanned=${s.scannedPosts} eligible=${s.eligiblePosts} planned=${s.plannedLikes} written=${s.writtenLikes} currentPostId=${s.currentPostId ?? ""}`
  );
}

async function runSeedLikesJob(input: {
  config: SeedLikesConfig;
  mode: "dryRun" | "write";
  scope: "first" | "all";
  runId: string;
}): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    pushSeedLikesEvent("error", "Firestore source client unavailable");
    finishSeedLikesRun();
    return;
  }

  const runId = input.runId;
  beginSeedLikesRun({ runId, mode: input.mode, scope: input.scope, config: input.config });
  pushSeedLikesEvent("info", `Run started (${input.mode}/${input.scope})`);

  try {
    const seedLikerPool = await resolveSeedLikerPool(db, input.config.useOldWebLikers);
    if (seedLikerPool.ids.length === 0) {
      pushSeedLikesEvent("error", "No seed likers available");
      return;
    }
    const profileMap = await hydrateSeedLikerProfiles(db, seedLikerPool.ids);

    let lastDocId: string | null = null;
    let processedEligible = 0;
    let scannedSinceLog = 0;

    while (!shouldStopSeedLikesRun()) {
      let query = db.collection("posts").orderBy(FieldPath.documentId()).limit(input.config.batchSize);
      if (lastDocId) {
        query = query.startAfter(lastDocId);
      }
      const snap = await query.get();
      if (snap.empty) {
        break;
      }

      for (const doc of snap.docs) {
        if (shouldStopSeedLikesRun()) {
          break;
        }
        if (input.config.maxPostsPerRun > 0 && getSeedLikesRunStatus().scannedPosts >= input.config.maxPostsPerRun) {
          pushSeedLikesEvent("info", "Reached SEED_LIKES_MAX_POSTS_PER_RUN cap");
          break;
        }

        const postId = doc.id;
        const postData = (doc.data() ?? {}) as Record<string, unknown>;
        const title = readPostTitle(postData);
        const authorId = readPostAuthorId(postData);
        setSeedLikesCurrentPost({ postId, title, authorId });
        incrementSeedLikesCounters({ scannedPosts: 1 });
        scannedSinceLog += 1;

        const currentLikeCount = readPostLikeCountFromFirestoreData(postData);
        if (currentLikeCount >= input.config.minExistingLikes) {
          incrementSeedLikesCounters({ skippedEnoughLikes: 1 });
          if (scannedSinceLog >= PROGRESS_LOG_INTERVAL) {
            scannedSinceLog = 0;
            logProgress();
          }
          continue;
        }

        const plan = await planSeedLikesForPost({
          db,
          postId,
          postData,
          config: input.config,
          seedLikerPool,
          profileMap,
          runId
        });

        if (!plan) {
          continue;
        }

        if (plan.outcome === "skipped_below_target_min") {
          incrementSeedLikesCounters({ skippedBelowTargetMin: 1 });
          if (input.mode === "dryRun") {
            setSeedLikesDryRunPreview(plan);
          }
          pushSeedLikesEvent("warn", `Skipped ${postId}: ${plan.warning ?? "below targetMin"}`);
          if (input.scope === "first") {
            processedEligible = 1;
            pushSeedLikesEvent("info", "First eligible post inspected; stopping");
            break;
          }
          if (scannedSinceLog >= PROGRESS_LOG_INTERVAL) {
            scannedSinceLog = 0;
            logProgress();
          }
          continue;
        }

        if (plan.likeDocs.length === 0) {
          incrementSeedLikesCounters({ skippedNoAvailableSeedLikers: 1 });
          if (input.mode === "dryRun") {
            setSeedLikesDryRunPreview(plan);
          }
          if (input.scope === "first") {
            processedEligible = 1;
            pushSeedLikesEvent("info", "First eligible post inspected; stopping");
            break;
          }
          if (scannedSinceLog >= PROGRESS_LOG_INTERVAL) {
            scannedSinceLog = 0;
            logProgress();
          }
          continue;
        }

        incrementSeedLikesCounters({ eligiblePosts: 1, plannedLikes: plan.likeDocs.length });
        processedEligible += 1;

        if (input.mode === "dryRun") {
          setSeedLikesDryRunPreview(plan);
          pushSeedLikesEvent("info", `Dry-run planned ${plan.likeDocs.length} likes for ${postId}`);
        } else {
          try {
            const written = await writeSeedPostPlan(db, plan, runId);
            incrementSeedLikesCounters({ writtenLikes: written });
            pushSeedLikesEvent("info", `Wrote ${written} likes for ${postId}`);
          } catch (error) {
            incrementSeedLikesCounters({ failedPosts: 1 });
            pushSeedLikesEvent(
              "error",
              `Failed ${postId}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        if (input.scope === "first") {
          pushSeedLikesEvent("info", "First eligible post processed; stopping");
          break;
        }

        if (scannedSinceLog >= PROGRESS_LOG_INTERVAL) {
          scannedSinceLog = 0;
          logProgress();
        }
      }

      lastDocId = snap.docs[snap.docs.length - 1]?.id ?? null;
      if (input.scope === "first" && processedEligible > 0) {
        break;
      }
      if (snap.size < input.config.batchSize) {
        break;
      }
      if (input.config.maxPostsPerRun > 0 && getSeedLikesRunStatus().scannedPosts >= input.config.maxPostsPerRun) {
        break;
      }
    }
  } catch (error) {
    pushSeedLikesEvent("error", error instanceof Error ? error.message : String(error));
  } finally {
    logProgress();
    finishSeedLikesRun();
    pushSeedLikesEvent("info", "Run finished");
  }
}

function assertCanStart(): void {
  const current = getSeedLikesRunStatus();
  if (current.isRunning) {
    throw new SeedLikesAlreadyRunningError();
  }
}

export function stopSeedLikesRun(): void {
  requestSeedLikesStop();
}

export async function startSeedLikesRun(input: {
  config: SeedLikesConfig;
  mode: "dryRun" | "write";
  scope: "first" | "all";
}): Promise<{ runId: string }> {
  if (input.mode === "write" && !input.config.allowWrites) {
    throw new SeedLikesWriteDisabledError();
  }
  assertCanStart();
  const runId = makeRunId(input.config.runIdPrefix);
  void runSeedLikesJob({ ...input, runId });
  return { runId };
}

export async function dryRunFirstEligiblePost(config: SeedLikesConfig): Promise<SeedPostPlan | null> {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }
  const seedLikerPool = await resolveSeedLikerPool(db, config.useOldWebLikers);
  const profileMap = await hydrateSeedLikerProfiles(db, seedLikerPool.ids);
  const runId = makeRunId(config.runIdPrefix);

  let lastDocId: string | null = null;
  while (true) {
    let query = db.collection("posts").orderBy(FieldPath.documentId()).limit(config.batchSize);
    if (lastDocId) {
      query = query.startAfter(lastDocId);
    }
    const snap = await query.get();
    if (snap.empty) {
      return null;
    }

    for (const doc of snap.docs) {
      const postData = (doc.data() ?? {}) as Record<string, unknown>;
      const currentLikeCount = readPostLikeCountFromFirestoreData(postData);
      if (currentLikeCount >= config.minExistingLikes) {
        continue;
      }
      const plan = await planSeedLikesForPost({
        db,
        postId: doc.id,
        postData,
        config,
        seedLikerPool,
        profileMap,
        runId
      });
      if (plan) {
        setSeedLikesDryRunPreview(plan);
        return plan;
      }
    }

    lastDocId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.size < config.batchSize) {
      return null;
    }
  }
}
