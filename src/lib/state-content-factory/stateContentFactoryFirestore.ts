import { randomUUID } from "node:crypto";
import type { AppEnv } from "../../config/env.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import type { PlaceCandidate } from "../place-candidates/types.js";
import { assertNoPublicPublish } from "./assertNoPublicPublish.js";
import { stateContentFactoryStagingWritesAllowed } from "./stateContentFactoryEnv.js";
import type {
  StateContentFactoryEvaluatedPost,
  StateContentFactoryRunConfig,
  StateContentFactoryRunResult,
  StateContentFactoryStagedPostRecord,
  StateContentFactoryStagedPostStatus,
} from "./types.js";

const RUNS = "stateContentRuns";
const PLACE_CANDIDATES = "placeCandidates";
const STAGED_POSTS = "stagedGeneratedPosts";

const stagedPostsMemory = new Map<string, StateContentFactoryStagedPostRecord>();

export function clearStateContentFactoryStagingMemory(): void {
  stagedPostsMemory.clear();
}

export function stagingWritesEnabled(env: AppEnv, config: StateContentFactoryRunConfig): boolean {
  return (
    config.runMode === "stage_only" &&
    config.allowStagingWrites === true &&
    stateContentFactoryStagingWritesAllowed(env)
  );
}

function requireDb() {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }
  return db;
}

export async function persistStateContentFactoryRun(input: {
  env: AppEnv;
  config: StateContentFactoryRunConfig;
  result: StateContentFactoryRunResult;
  onRead?: () => void;
  onWrite?: () => void;
}): Promise<void> {
  if (!stagingWritesEnabled(input.env, input.config)) return;
  const db = requireDb();
  input.onWrite?.();
  await db.collection(RUNS).doc(input.result.runId).set({
    runId: input.result.runId,
    runMode: input.result.runMode,
    stateName: input.result.stateName,
    stateCode: input.result.stateCode ?? null,
    partial: input.result.partial,
    partialReason: input.result.partialReason ?? null,
    counts: input.result.counts,
    budget: input.result.budget,
    wouldWrite: input.result.wouldWrite,
    actualWrites: input.result.actualWrites,
    publicPostsWritten: 0,
    createdAt: new Date().toISOString(),
  });
}

export async function upsertPlaceCandidateRegistry(input: {
  env: AppEnv;
  config: StateContentFactoryRunConfig;
  candidate: PlaceCandidate;
  runId: string;
  onRead?: () => void;
  onWrite?: () => void;
}): Promise<void> {
  if (!stagingWritesEnabled(input.env, input.config)) return;
  const db = requireDb();
  input.onRead?.();
  input.onWrite?.();
  await db
    .collection(PLACE_CANDIDATES)
    .doc(input.candidate.placeCandidateId)
    .set(
      {
        placeCandidateId: input.candidate.placeCandidateId,
        name: input.candidate.name,
        state: input.candidate.state,
        stateCode: input.candidate.stateCode ?? null,
        lat: input.candidate.lat ?? null,
        lng: input.candidate.lng ?? null,
        primaryCategory: input.candidate.primaryCategory,
        priorityQueue: input.candidate.priorityQueue ?? null,
        eligibleForMediaPipeline: input.candidate.eligibleForMediaPipeline,
        blocked: input.candidate.blocked,
        lastRunId: input.runId,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
}

export async function createStagedGeneratedPost(input: {
  env: AppEnv;
  config: StateContentFactoryRunConfig;
  runId: string;
  evaluated: StateContentFactoryEvaluatedPost;
  onRead?: () => void;
  onWrite?: () => void;
}): Promise<StateContentFactoryStagedPostRecord> {
  assertNoPublicPublish();
  if (!stagingWritesEnabled(input.env, input.config)) {
    throw new Error("staging_writes_disabled");
  }
  const stagedPostId = `staged_${randomUUID()}`;
  const now = new Date().toISOString();
  const record: StateContentFactoryStagedPostRecord = {
    stagedPostId,
    runId: input.runId,
    placeCandidateId: input.evaluated.placeCandidate.placeCandidateId,
    status: input.evaluated.qualityStatus === "needs_review" ? "needs_review" : "staged",
    publishStatus: "not_published",
    stateName: input.evaluated.placeCandidate.state,
    stateCode: input.evaluated.placeCandidate.stateCode,
    place: {
      placeCandidateId: input.evaluated.placeCandidate.placeCandidateId,
      name: input.evaluated.placeCandidate.name,
      lat: input.evaluated.placeCandidate.lat,
      lng: input.evaluated.placeCandidate.lng,
      primaryCategory: input.evaluated.placeCandidate.primaryCategory,
      priorityQueue: input.evaluated.placeCandidate.priorityQueue,
    },
    postPreview: input.evaluated.generatedPost.dryRunPostPreview ?? {},
    quality: {
      status: input.evaluated.qualityStatus,
      reasons: input.evaluated.qualityReasons,
      duplicateHash: input.evaluated.duplicateHash,
    },
    attribution: {
      media: input.evaluated.generatedPost.media.map((asset) => ({
        author: asset.author,
        license: asset.license,
        credit: asset.credit,
        sourceUrl: asset.sourceUrl,
      })),
    },
    debug: {
      groupId: input.evaluated.generatedPost.groupId,
      groupMethod: input.evaluated.generatedPost.groupMethod,
    },
    createdAt: now,
    updatedAt: now,
  };
  const db = requireDb();
  input.onWrite?.();
  await db.collection(STAGED_POSTS).doc(stagedPostId).set(record);
  stagedPostsMemory.set(stagedPostId, record);
  return record;
}

export async function listStagedGeneratedPosts(input: {
  env: AppEnv;
  limit?: number;
  status?: StateContentFactoryStagedPostStatus;
}): Promise<StateContentFactoryStagedPostRecord[]> {
  if (!stateContentFactoryStagingWritesAllowed(input.env)) {
    return [];
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    return [...stagedPostsMemory.values()].slice(0, input.limit ?? 50);
  }
  let query = db.collection(STAGED_POSTS).orderBy("createdAt", "desc").limit(input.limit ?? 50);
  if (input.status) {
    query = db.collection(STAGED_POSTS).where("status", "==", input.status).limit(input.limit ?? 50);
  }
  const snap = await query.get();
  return snap.docs.map((doc) => doc.data() as StateContentFactoryStagedPostRecord);
}

export async function reviewStagedGeneratedPost(input: {
  env: AppEnv;
  stagedPostId: string;
  action: StateContentFactoryStagedPostStatus;
}): Promise<StateContentFactoryStagedPostRecord | null> {
  assertNoPublicPublish();
  if (!stateContentFactoryStagingWritesAllowed(input.env)) {
    throw new Error("staging_writes_disabled");
  }
  const db = requireDb();
  const ref = db.collection(STAGED_POSTS).doc(input.stagedPostId);
  const snap = await ref.get();
  if (!snap.exists) {
    const memory = stagedPostsMemory.get(input.stagedPostId);
    if (!memory) return null;
    const updated = { ...memory, status: input.action, updatedAt: new Date().toISOString() };
    stagedPostsMemory.set(input.stagedPostId, updated);
    return updated;
  }
  const updatedAt = new Date().toISOString();
  await ref.set({ status: input.action, updatedAt }, { merge: true });
  const merged = { ...(snap.data() as StateContentFactoryStagedPostRecord), status: input.action, updatedAt };
  stagedPostsMemory.set(input.stagedPostId, merged);
  return merged;
}
