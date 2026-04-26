import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import type { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { readWasabiConfigFromEnv, type WasabiRuntimeConfig } from "./wasabi-config.js";

/** Same prefix layout as Locava Backend v1 `wasabi.service.ts`. */
export function postSessionStagingPrefix(userId: string, sessionId: string): string {
  return `postSessionStaging/${userId}/${sessionId}/`;
}

export function postSessionStagingObjectKey(
  userId: string,
  sessionId: string,
  index: number,
  ext: "jpg" | "mp4"
): string {
  return `postSessionStaging/${userId}/${sessionId}/${index}.${ext}`;
}

export function postSessionStagingPosterObjectKey(userId: string, sessionId: string, index: number): string {
  return `postSessionStaging/${userId}/${sessionId}/${index}.poster.jpg`;
}

export function postSessionStagingObjectKeyForAsset(
  userId: string,
  sessionId: string,
  index: number,
  assetType: "photo" | "video"
): string {
  return postSessionStagingObjectKey(userId, sessionId, index, assetType === "video" ? "mp4" : "jpg");
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

export async function headObjectExists(cfg: WasabiRuntimeConfig, key: string): Promise<boolean> {
  const client = createS3Client(cfg);
  try {
    await client.send(new HeadObjectCommand({ Bucket: cfg.bucketName, Key: key }));
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForObjectKeys(
  cfg: WasabiRuntimeConfig,
  keys: string[],
  opts?: { attempts?: number; baseDelayMs?: number }
): Promise<{ success: boolean; presentKeys: string[]; error?: string }> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return { success: true, presentKeys: [] };
  const attempts = opts?.attempts ?? 6;
  const baseDelayMs = opts?.baseDelayMs ?? 350;
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const existence = await Promise.all(
        unique.map(async (key) => ({ key, exists: await headObjectExists(cfg, key) }))
      );
      const presentKeys = existence.filter((x) => x.exists).map((x) => x.key);
      if (presentKeys.length === unique.length) {
        return { success: true, presentKeys: unique };
      }
      if (attempt === attempts - 1) {
        return { success: true, presentKeys };
      }
      await sleep(baseDelayMs * (attempt + 1));
    }
    return { success: true, presentKeys: [] };
  } catch (e) {
    return {
      success: false,
      presentKeys: [],
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

export async function deleteAllObjectsUnderPrefix(
  cfg: WasabiRuntimeConfig,
  prefix: string
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  let deletedCount = 0;
  let continuationToken: string | undefined;
  const client = createS3Client(cfg);
  try {
    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucketName,
          Prefix: prefix,
          MaxKeys: 500,
          ContinuationToken: continuationToken
        })
      );
      const keys =
        listed.Contents?.map((c) => c.Key).filter((k): k is string => typeof k === "string" && k.length > 0) ?? [];
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: cfg.bucketName,
            Delete: { Objects: keys.map((Key) => ({ Key })) }
          })
        );
        deletedCount += keys.length;
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return { success: true, deletedCount };
  } catch (e) {
    return {
      success: false,
      deletedCount,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

export async function purgePostSessionStaging(
  cfg: WasabiRuntimeConfig,
  userId: string,
  sessionId: string
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  return deleteAllObjectsUnderPrefix(cfg, postSessionStagingPrefix(userId, sessionId));
}

export async function uploadPostSessionStagingFromBuffer(
  cfg: WasabiRuntimeConfig,
  userId: string,
  sessionId: string,
  index: number,
  assetType: "photo" | "video",
  buffer: Buffer,
  opts?: { destinationKey?: string; contentType?: string }
): Promise<{ success: boolean; error?: string }> {
  const ext = assetType === "video" ? "mp4" : "jpg";
  const key = opts?.destinationKey ?? postSessionStagingObjectKey(userId, sessionId, index, ext);
  const contentType =
    opts?.contentType ?? (assetType === "video" ? "video/mp4" : "image/jpeg");
  const client = createS3Client(cfg);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: "public-read"
      })
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadPostSessionStagingFromDisk(
  cfg: WasabiRuntimeConfig,
  userId: string,
  sessionId: string,
  index: number,
  assetType: "photo" | "video",
  filePath: string,
  opts?: { destinationKey?: string; contentType?: string }
): Promise<{ success: boolean; error?: string }> {
  const ext = assetType === "video" ? "mp4" : "jpg";
  const key = opts?.destinationKey ?? postSessionStagingObjectKey(userId, sessionId, index, ext);
  const contentType =
    opts?.contentType ?? (assetType === "video" ? "video/mp4" : "image/jpeg");
  const client = createS3Client(cfg);
  try {
    const stream = createReadStream(filePath);
    const upload = new Upload({
      client,
      params: {
        Bucket: cfg.bucketName,
        Key: key,
        Body: stream,
        ContentType: contentType,
        ACL: "public-read"
      }
    });
    await upload.done();
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadPostSessionStagingFromStream(
  cfg: WasabiRuntimeConfig,
  userId: string,
  sessionId: string,
  index: number,
  assetType: "photo" | "video",
  bodyStream: Readable,
  options?: {
    contentLength?: number;
    contentType?: string;
    destinationKey?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const ext = assetType === "video" ? "mp4" : "jpg";
  const key =
    options?.destinationKey ?? postSessionStagingObjectKey(userId, sessionId, index, ext);
  const contentType =
    options?.contentType ?? (assetType === "video" ? "video/mp4" : "image/jpeg");
  const client = createS3Client(cfg);
  try {
    const uploadParams: {
      Bucket: string;
      Key: string;
      Body: Readable;
      ContentType: string;
      ACL: "public-read";
      ContentLength?: number;
    } = {
      Bucket: cfg.bucketName,
      Key: key,
      Body: bodyStream,
      ContentType: contentType,
      ACL: "public-read"
    };
    if (
      options?.contentLength != null &&
      Number.isFinite(options.contentLength) &&
      options.contentLength > 0
    ) {
      uploadParams.ContentLength = options.contentLength;
    }
    const upload = new Upload({ client, params: uploadParams });
    await upload.done();
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadPostSessionPosterFromBuffer(
  cfg: WasabiRuntimeConfig,
  userId: string,
  sessionId: string,
  index: number,
  buffer: Buffer,
  opts?: { destinationKey?: string }
): Promise<{ success: boolean; key?: string; error?: string }> {
  const key = opts?.destinationKey ?? postSessionStagingPosterObjectKey(userId, sessionId, index);
  const client = createS3Client(cfg);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucketName,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable"
      })
    );
    return { success: true, key };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function getWasabiConfigOrNull(): WasabiRuntimeConfig | null {
  return readWasabiConfigFromEnv();
}

export async function unlinkQuiet(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore */
  }
}
