import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { wasabiPublicUrlForKey, type WasabiRuntimeConfig } from "./wasabi-config.js";

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

function extensionForContentType(contentType: string): string {
  const normalized = contentType.trim().toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  return "jpg";
}

async function uploadGroupPhotoObject(opts: {
  cfg: WasabiRuntimeConfig;
  key: string;
  bytes: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}): Promise<{ ok: true; key: string; url: string } | { ok: false; message: string }> {
  try {
    const client = createS3Client(opts.cfg);
    await client.send(
      new PutObjectCommand({
        Bucket: opts.cfg.bucketName,
        Key: opts.key,
        Body: opts.bytes,
        ContentType: opts.contentType || "image/jpeg",
        ACL: "public-read",
        Metadata: opts.metadata
      })
    );
    return { ok: true, key: opts.key, url: wasabiPublicUrlForKey(opts.cfg, opts.key) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "upload_failed" };
  }
}

export async function uploadGroupChatAvatar(opts: {
  cfg: WasabiRuntimeConfig;
  viewerId: string;
  bytes: Buffer;
  contentType: string;
}): Promise<{ ok: true; key: string; url: string } | { ok: false; message: string }> {
  if (!opts.viewerId.trim()) return { ok: false, message: "viewerId required" };
  if (!opts.bytes.length) return { ok: false, message: "empty file" };
  const ts = Date.now();
  const nonce = randomUUID().slice(0, 8);
  const ext = extensionForContentType(opts.contentType);
  const key = `groupChatPhotos/${opts.viewerId}/group-avatar-${ts}-${nonce}.${ext}`;
  return uploadGroupPhotoObject({
    cfg: opts.cfg,
    key,
    bytes: opts.bytes,
    contentType: opts.contentType.trim().toLowerCase(),
    metadata: {
      viewerId: opts.viewerId,
      uploadedAt: String(ts),
      purpose: "group-avatar"
    }
  });
}

export async function uploadGroupChatPhoto(opts: {
  cfg: WasabiRuntimeConfig;
  viewerId: string;
  conversationId: string;
  bytes: Buffer;
  contentType: string;
}): Promise<{ ok: true; key: string; url: string } | { ok: false; message: string }> {
  if (!opts.viewerId.trim()) return { ok: false, message: "viewerId required" };
  if (!opts.conversationId.trim()) return { ok: false, message: "conversationId required" };
  if (!opts.bytes.length) return { ok: false, message: "empty file" };
  const ts = Date.now();
  const nonce = randomUUID().slice(0, 8);
  const ext = extensionForContentType(opts.contentType);
  const key = `groupChatPhotos/${opts.conversationId}/group-${ts}-${nonce}.${ext}`;
  return uploadGroupPhotoObject({
    cfg: opts.cfg,
    key,
    bytes: opts.bytes,
    contentType: opts.contentType.trim().toLowerCase(),
    metadata: {
      viewerId: opts.viewerId,
      conversationId: opts.conversationId,
      uploadedAt: String(ts),
      purpose: "group-photo"
    }
  });
}
