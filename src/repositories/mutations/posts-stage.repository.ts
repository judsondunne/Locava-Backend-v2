import { createHash, randomUUID } from "node:crypto";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export type StageAssetRecord = {
  assetIndex: number;
  assetType: "photo" | "video";
  destinationKey?: string;
  objectKey?: string;
  uploaded?: boolean;
};

export type PostStageRecord = {
  stageId: string;
  viewerId: string;
  clientMutationId: string;
  state: "staged" | "publishing" | "published" | "cancelled" | "failed";
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  title?: string;
  caption?: string;
  activities?: string[];
  privacy?: "Public Spot" | "Friends Spot" | "Secret Spot";
  lat?: number | null;
  long?: number | null;
  address?: string;
  tags?: string[];
  assets: StageAssetRecord[];
  publishedPostId?: string;
};

const STAGES = "postStages";
const IDEMPOTENCY = "postPublishIdempotency";
const STAGE_TTL_MS = 45 * 60 * 1000;

export class PostsStageRepositoryError extends Error {
  constructor(
    public readonly code:
      | "stage_not_found"
      | "stage_not_owned"
      | "stage_expired"
      | "stage_not_ready"
      | "stage_not_publishable"
      | "idempotency_conflict",
    message: string
  ) {
    super(message);
  }
}

function requireDb() {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new SourceOfTruthRequiredError("posts_stage_firestore_unavailable");
  }
  return db;
}

function stageDocId(viewerId: string, clientMutationId: string): string {
  return `stg_${createHash("sha256").update(`${viewerId}:${clientMutationId}`).digest("hex").slice(0, 24)}`;
}

function publishIdempotencyDocId(viewerId: string, clientMutationId: string): string {
  return createHash("sha256").update(`${viewerId}:${clientMutationId}`).digest("hex").slice(0, 32);
}

export class PostsStageRepository {
  async createOrGetStage(input: Omit<PostStageRecord, "stageId" | "state" | "createdAtMs" | "updatedAtMs" | "expiresAtMs">): Promise<{ stage: PostStageRecord; replayed: boolean }> {
    const db = requireDb();
    const now = Date.now();
    const docId = stageDocId(input.viewerId, input.clientMutationId);
    const ref = db.collection(STAGES).doc(docId);
    incrementDbOps("queries", 1);
    const existing = await ref.get();
    if (existing.exists) {
      const data = existing.data() as PostStageRecord;
      if (data.expiresAtMs > now && data.state !== "cancelled") {
        return { stage: data, replayed: true };
      }
    }
    const stage: PostStageRecord = {
      ...input,
      stageId: docId,
      state: "staged",
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + STAGE_TTL_MS
    };
    await ref.set(stage);
    incrementDbOps("writes", 1);
    return { stage, replayed: false };
  }

  async getStageOrThrow(viewerId: string, stageId: string): Promise<PostStageRecord> {
    const db = requireDb();
    const ref = db.collection(STAGES).doc(stageId);
    incrementDbOps("queries", 1);
    const snap = await ref.get();
    if (!snap.exists) throw new PostsStageRepositoryError("stage_not_found", "Post stage was not found.");
    const stage = snap.data() as PostStageRecord;
    if (stage.viewerId !== viewerId) throw new PostsStageRepositoryError("stage_not_owned", "Post stage does not belong to this viewer.");
    if (stage.expiresAtMs <= Date.now()) throw new PostsStageRepositoryError("stage_expired", "Post stage has expired.");
    return stage;
  }

  async markAssetsUploaded(viewerId: string, stageId: string, items: Array<{ assetIndex: number; assetType: "photo" | "video"; objectKey?: string }>): Promise<PostStageRecord> {
    const db = requireDb();
    const stage = await this.getStageOrThrow(viewerId, stageId);
    const byIndex = new Map(items.map((it) => [it.assetIndex, it] as const));
    const nextAssets = stage.assets.map((asset) => {
      const update = byIndex.get(asset.assetIndex);
      if (!update) return asset;
      return {
        ...asset,
        uploaded: true,
        objectKey: update.objectKey ?? asset.objectKey
      };
    });
    const updated: PostStageRecord = {
      ...stage,
      assets: nextAssets,
      updatedAtMs: Date.now()
    };
    await db.collection(STAGES).doc(stageId).set(updated);
    incrementDbOps("writes", 1);
    return updated;
  }

  async getIdempotentPublishedPostId(viewerId: string, clientMutationId: string): Promise<string | null> {
    const db = requireDb();
    const docId = publishIdempotencyDocId(viewerId, clientMutationId);
    incrementDbOps("queries", 1);
    const snap = await db.collection(IDEMPOTENCY).doc(docId).get();
    if (!snap.exists) return null;
    const postId = (snap.data() as { postId?: string } | undefined)?.postId;
    return typeof postId === "string" && postId ? postId : null;
  }

  async markPublishing(viewerId: string, stageId: string): Promise<PostStageRecord> {
    const db = requireDb();
    const stage = await this.getStageOrThrow(viewerId, stageId);
    const ready = stage.assets.every((asset) => asset.uploaded === true);
    if (!ready) {
      throw new PostsStageRepositoryError("stage_not_ready", "All media assets must be completed before publish.");
    }
    if (stage.state !== "staged" && stage.state !== "failed") {
      throw new PostsStageRepositoryError("stage_not_publishable", "Post stage is not publishable.");
    }
    const updated: PostStageRecord = {
      ...stage,
      state: "publishing",
      updatedAtMs: Date.now()
    };
    await db.collection(STAGES).doc(stageId).set(updated);
    incrementDbOps("writes", 1);
    return updated;
  }

  async markPublished(viewerId: string, stageId: string, clientMutationId: string, postId: string): Promise<void> {
    const db = requireDb();
    const stage = await this.getStageOrThrow(viewerId, stageId);
    const now = Date.now();
    const updated: PostStageRecord = {
      ...stage,
      state: "published",
      updatedAtMs: now,
      publishedPostId: postId
    };
    const idempotencyId = publishIdempotencyDocId(viewerId, clientMutationId);
    await db.runTransaction(async (tx) => {
      tx.set(db.collection(STAGES).doc(stageId), updated);
      tx.set(db.collection(IDEMPOTENCY).doc(idempotencyId), {
        viewerId,
        stageId,
        postId,
        updatedAtMs: now,
        nonce: randomUUID().slice(0, 8)
      });
    });
    incrementDbOps("writes", 2);
  }
}
