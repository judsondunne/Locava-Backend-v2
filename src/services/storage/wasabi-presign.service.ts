import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readWasabiConfigFromEnv, wasabiPublicUrlForKey, type WasabiRuntimeConfig } from "./wasabi-config.js";

const PRESIGN_EXPIRES_SECONDS = 3600;

export type StagingPresignItem = {
  index: number;
  assetType: "photo" | "video";
  destinationKey?: string;
  contentType?: string;
  /** When set (staging presign / native register client key), object keys diverge from sessionId+index-only layout. */
  clientStagingKey?: string;
};

export type StagingPresignUrlSlot = {
  index: number;
  uploadUrl: string;
  key: string;
  contentType: string;
  /** Second PUT URL for `videos/…_poster.jpg` when assetType is video (same ACL as main object). */
  posterPutUrl?: string;
};

export type StagingPresignResult =
  | { ok: true; urls: StagingPresignUrlSlot[] }
  | { ok: false; code: "not_configured" | "presign_failed"; message: string };

/**
 * Stable asset id / object keys aligned with v1 `directPostUpload.controller.ts`
 * (`buildStableSessionAssetId`, `buildFinalizedSessionAssetPlan`).
 */
export function buildStableSessionAssetId(
  sessionId: string,
  index: number,
  assetType: "photo" | "video",
  clientAssetDisambiguator?: string | null
): string {
  const sessionHash = createHash("sha1").update(sessionId).digest("hex").slice(0, 10);
  const prefix = assetType === "video" ? "video" : "image";
  const trimmed =
    typeof clientAssetDisambiguator === "string" ? clientAssetDisambiguator.trim() : "";
  if (!trimmed) {
    return `${prefix}_${sessionHash}_${index}`;
  }
  const mixHash = createHash("sha1")
    .update(`${trimmed}:${sessionId}:${index}:${assetType}`)
    .digest("hex")
    .slice(0, 10);
  return `${prefix}_${sessionHash}_${mixHash}_${index}`;
}

export function buildFinalizedSessionAssetKeys(
  sessionId: string,
  index: number,
  assetType: "photo" | "video",
  clientAssetDisambiguator?: string | null
): {
  assetId: string;
  originalKey: string;
  posterKey?: string;
} {
  const assetId = buildStableSessionAssetId(sessionId, index, assetType, clientAssetDisambiguator);
  if (assetType === "video") {
    return {
      assetId,
      originalKey: `videos/${assetId}.mp4`,
      posterKey: `videos/${assetId}_poster.jpg`
    };
  }
  return {
    assetId,
    originalKey: `images/${assetId}.jpg`
  };
}

export function buildFinalizedSessionAssetPlan(
  cfg: WasabiRuntimeConfig,
  sessionId: string,
  index: number,
  assetType: "photo" | "video",
  clientAssetDisambiguator?: string | null
): {
  assetId: string;
  originalKey: string;
  originalUrl: string;
  posterKey?: string;
  posterUrl?: string;
} {
  const keys = buildFinalizedSessionAssetKeys(sessionId, index, assetType, clientAssetDisambiguator);
  if (assetType === "video") {
    return {
      assetId: keys.assetId,
      originalKey: keys.originalKey,
      originalUrl: wasabiPublicUrlForKey(cfg, keys.originalKey),
      posterKey: keys.posterKey,
      posterUrl: keys.posterKey ? wasabiPublicUrlForKey(cfg, keys.posterKey) : undefined
    };
  }
  return {
    assetId: keys.assetId,
    originalKey: keys.originalKey,
    originalUrl: wasabiPublicUrlForKey(cfg, keys.originalKey)
  };
}

function createS3Client(cfg: WasabiRuntimeConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey
    }
  });
}

/**
 * Batch presigned PUT URLs for phone → Wasabi direct upload (same semantics as v1
 * `wasabiService.presignPostSessionStagingBatch`).
 */
export async function presignPostSessionStagingBatch(
  items: StagingPresignItem[],
  sessionId: string
): Promise<StagingPresignResult> {
  const cfg = readWasabiConfigFromEnv();
  if (!cfg) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "Wasabi credentials missing. Set WASABI_ACCESS_KEY_ID and WASABI_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)."
    };
  }

  try {
    const client = createS3Client(cfg);
    const urls: StagingPresignUrlSlot[] = [];

    for (const item of items) {
      const disambiguator = item.clientStagingKey?.trim() || null;
      const finalized = buildFinalizedSessionAssetPlan(
        cfg,
        sessionId,
        item.index,
        item.assetType,
        disambiguator
      );
      const key = item.destinationKey ?? finalized.originalKey;
      const contentType =
        item.contentType ?? (item.assetType === "video" ? "video/mp4" : "image/jpeg");

      const command = new PutObjectCommand({
        Bucket: cfg.bucketName,
        Key: key,
        ContentType: contentType,
        ACL: "public-read"
      });

      const uploadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRES_SECONDS });

      let posterPutUrl: string | undefined;
      if (item.assetType === "video" && finalized.posterKey) {
        const posterCmd = new PutObjectCommand({
          Bucket: cfg.bucketName,
          Key: finalized.posterKey,
          ContentType: "image/jpeg",
          ACL: "public-read"
        });
        posterPutUrl = await getSignedUrl(client, posterCmd, { expiresIn: PRESIGN_EXPIRES_SECONDS });
      }

      urls.push({
        index: item.index,
        uploadUrl,
        key,
        contentType,
        ...(posterPutUrl ? { posterPutUrl } : {})
      });
    }

    return { ok: true, urls };
  } catch (error) {
    return {
      ok: false,
      code: "presign_failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export type LegacyStagePresignRow = StagingPresignUrlSlot & {
  assetId: string;
  originalKey: string;
  originalUrl: string;
  posterKey?: string;
  posterUrl?: string;
};

/** Maps presign slots to v1 `stagePresign` response rows (includes asset metadata URLs). */
export function enrichPresignSlotsForLegacyCompat(
  cfg: WasabiRuntimeConfig,
  sessionId: string,
  slots: StagingPresignUrlSlot[],
  normalizedItems: Array<{ index: number; assetType: "photo" | "video"; clientStagingKey?: string }>
): LegacyStagePresignRow[] {
  return slots.map((slot) => {
    const match = normalizedItems.find((it) => it.index === slot.index);
    const assetType = match?.assetType ?? "photo";
    const disambiguator = match?.clientStagingKey?.trim() || null;
    const finalized = buildFinalizedSessionAssetPlan(cfg, sessionId, slot.index, assetType, disambiguator);
    return {
      ...slot,
      assetId: finalized.assetId,
      originalKey: finalized.originalKey,
      originalUrl: finalized.originalUrl,
      posterKey: finalized.posterKey,
      posterUrl: finalized.posterUrl
    };
  });
}

export async function presignWasabiPutObject(input: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<
  | { ok: true; uploadUrl: string; bucket: string }
  | { ok: false; code: "not_configured" | "presign_failed"; message: string }
> {
  const cfg = readWasabiConfigFromEnv();
  if (!cfg) {
    return {
      ok: false,
      code: "not_configured",
      message: "Wasabi credentials missing"
    };
  }
  try {
    const client = createS3Client(cfg);
    const command = new PutObjectCommand({
      Bucket: cfg.bucketName,
      Key: input.key,
      ContentType: input.contentType,
      ACL: "public-read"
    });
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: input.expiresInSeconds ?? PRESIGN_EXPIRES_SECONDS
    });
    return {
      ok: true,
      uploadUrl,
      bucket: cfg.bucketName
    };
  } catch (error) {
    return {
      ok: false,
      code: "presign_failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
