import { createHash } from "node:crypto";
import { assertMonolithProxyOutboundAllowed } from "../../config/monolith-proxy-allowlist.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { readWasabiConfigFromEnv, wasabiPublicUrlForKey } from "../storage/wasabi-config.js";
import { buildFinalizedSessionAssetPlan, enrichPresignSlotsForLegacyCompat, presignPostSessionStagingBatch } from "../storage/wasabi-presign.service.js";
import { waitForObjectKeys } from "../storage/wasabi-staging.service.js";
import { PostsStageRepository, type PostStageRecord } from "../../repositories/mutations/posts-stage.repository.js";

type PublishInput = {
  viewerId: string;
  authorizationHeader: string | undefined;
  stageId: string;
  clientMutationId: string;
  title?: string;
  caption?: string;
  activities: string[];
  privacy: "Public Spot" | "Friends Spot" | "Secret Spot";
  lat?: number | null;
  long?: number | null;
  address?: string;
  tags: string[];
  texts?: unknown[];
  recordingsList?: unknown[];
};

export class PostsPublishService {
  constructor(private readonly stageRepository = new PostsStageRepository()) {}

  async stage(input: {
    viewerId: string;
    clientMutationId: string;
    title?: string;
    caption?: string;
    activities: string[];
    privacy: "Public Spot" | "Friends Spot" | "Secret Spot";
    lat?: number | null;
    long?: number | null;
    address?: string;
    tags: string[];
    assets: Array<{ assetIndex: number; assetType: "photo" | "video"; contentType?: string; destinationKey?: string }>;
  }) {
    return this.stageRepository.createOrGetStage({
      viewerId: input.viewerId,
      clientMutationId: input.clientMutationId,
      title: input.title,
      caption: input.caption,
      activities: input.activities,
      privacy: input.privacy,
      lat: input.lat,
      long: input.long,
      address: input.address,
      tags: input.tags,
      assets: input.assets.map((asset) => ({
        assetIndex: asset.assetIndex,
        assetType: asset.assetType,
        destinationKey: asset.destinationKey,
        uploaded: false
      }))
    });
  }

  async signUpload(viewerId: string, stageId: string, items: Array<{ assetIndex: number; assetType: "photo" | "video"; destinationKey?: string }>) {
    const stage = await this.stageRepository.getStageOrThrow(viewerId, stageId);
    const signed = await presignPostSessionStagingBatch(
      items.map((it) => ({
        index: it.assetIndex,
        assetType: it.assetType,
        ...(it.destinationKey ? { destinationKey: it.destinationKey } : {})
      })),
      stage.stageId
    );
    if (!signed.ok) {
      throw new Error(signed.message || "presign_failed");
    }
    const cfg = readWasabiConfigFromEnv();
    if (!cfg) throw new Error("object_storage_unavailable");
    const urls = enrichPresignSlotsForLegacyCompat(
      cfg,
      stage.stageId,
      signed.urls,
      items.map((item) => ({ index: item.assetIndex, assetType: item.assetType }))
    );
    return { stage, urls };
  }

  async completeUpload(viewerId: string, stageId: string, items: Array<{ assetIndex: number; assetType: "photo" | "video"; objectKey?: string }>) {
    const stage = await this.stageRepository.getStageOrThrow(viewerId, stageId);
    const cfg = readWasabiConfigFromEnv();
    if (!cfg) throw new Error("object_storage_unavailable");
    const keys = items.map((item) => {
      if (item.objectKey?.trim()) return item.objectKey.trim();
      const plan = buildFinalizedSessionAssetPlan(cfg, stage.stageId, item.assetIndex, item.assetType);
      return plan.originalKey;
    });
    const ready = await waitForObjectKeys(cfg, keys);
    if (!ready.success) throw new Error(ready.error || "storage_probe_failed");
    const present = new Set(ready.presentKeys);
    const initialMissingKeys = keys.filter((key) => !present.has(key));
    if (initialMissingKeys.length > 0) {
      // Some buckets can lag/deny HEAD visibility immediately after presigned PUT.
      // Probe public URLs before declaring the upload missing.
      const checks = await Promise.all(
        initialMissingKeys.map(async (key) => {
          try {
            const res = await fetch(wasabiPublicUrlForKey(cfg, key), {
              method: "HEAD"
            });
            return { key, exists: res.ok };
          } catch {
            return { key, exists: false };
          }
        })
      );
      for (const check of checks) {
        if (check.exists) {
          present.add(check.key);
        }
      }
    }
    const missingKeys = keys.filter((key) => !present.has(key));
    const requireStorageProbe = process.env.POST_UPLOAD_REQUIRE_STORAGE_PROBE === "1";
    const completed = items
      .map((item, idx) => ({ ...item, objectKey: keys[idx] }))
      .filter((item) => {
        if (present.has(item.objectKey ?? "")) return true;
        if (!requireStorageProbe && item.objectKey && item.objectKey.trim().length > 0) {
          return true;
        }
        return false;
      });
    const updated = await this.stageRepository.markAssetsUploaded(
      viewerId,
      stageId,
      completed
    );
    const finalizedMissing = requireStorageProbe
      ? missingKeys
      : missingKeys.filter((key) => !completed.some((item) => item.objectKey === key));
    return { stage: updated, missingKeys: finalizedMissing };
  }

  async publish(input: PublishInput): Promise<{ postId: string; replayed: boolean }> {
    const existingPostId = await this.stageRepository.getIdempotentPublishedPostId(input.viewerId, input.clientMutationId);
    if (existingPostId) {
      return {
        postId: existingPostId,
        replayed: true
      };
    }
    const stage = await this.stageRepository.markPublishing(input.viewerId, input.stageId);
    const postId = await this.publishToLegacyMonolith(stage, input);
    await this.stageRepository.markPublished(input.viewerId, input.stageId, input.clientMutationId, postId);
    await invalidateEntitiesForMutation({
      mutationType: "posting.complete",
      postId,
      viewerId: input.viewerId
    });
    return {
      postId,
      replayed: false
    };
  }

  private async publishToLegacyMonolith(stage: PostStageRecord, input: PublishInput): Promise<string> {
    const base = process.env.LEGACY_MONOLITH_PROXY_BASE_URL?.trim();
    if (!base) {
      throw new Error("legacy_monolith_unavailable");
    }
    const url = `${base.replace(/\/+$/, "")}/api/v1/product/upload/create-from-staged`;
    assertMonolithProxyOutboundAllowed(url);
    const body: Record<string, unknown> = {
      sessionId: stage.stageId,
      userId: input.viewerId,
      title: input.title ?? stage.title ?? "",
      content: input.caption ?? stage.caption ?? "",
      activities: input.activities.length ? input.activities : (stage.activities ?? []),
      lat: String(input.lat ?? stage.lat ?? 0),
      long: String(input.long ?? stage.long ?? 0),
      address: input.address ?? stage.address ?? "",
      privacy: input.privacy ?? stage.privacy ?? "Public Spot",
      tags: input.tags,
      texts: input.texts ?? [],
      recordings: input.recordingsList ?? [],
      idempotencyKey: createHash("sha256").update(`${input.viewerId}:${input.clientMutationId}`).digest("hex")
    };
    const authHeader =
      input.authorizationHeader?.trim() ||
      (process.env.LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN?.trim()
        ? `Bearer ${process.env.LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN.trim()}`
        : "");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authHeader ? { authorization: authHeader } : {})
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; postId?: string; error?: string; message?: string };
    if (!response.ok || !payload.success || !payload.postId) {
      throw new Error(payload.error || payload.message || "publish_failed");
    }
    return payload.postId;
  }
}
