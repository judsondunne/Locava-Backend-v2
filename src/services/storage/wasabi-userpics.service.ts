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

export type UploadUserProfilePicResult =
  | { ok: true; key: string; url: string }
  | { ok: false; message: string };

export async function uploadUserProfilePicture(opts: {
  cfg: WasabiRuntimeConfig;
  userId: string;
  bytes: Buffer;
  contentType: string;
}): Promise<UploadUserProfilePicResult> {
  const { cfg, userId, bytes, contentType } = opts;
  if (!userId.trim()) return { ok: false, message: "userId required" };
  if (!bytes.length) return { ok: false, message: "empty file" };

  const normalizedType = contentType.trim().toLowerCase();
  const ext =
    normalizedType.includes("png") ? "png" : normalizedType.includes("webp") ? "webp" : "jpg";

  const ts = Date.now();
  const nonce = randomUUID().slice(0, 8);
  const key = `userPics/${userId}/profilePic_${ts}_${nonce}.${ext}`;

  try {
    const client = createS3Client(cfg);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucketName,
        Key: key,
        Body: bytes,
        ContentType: normalizedType || "image/jpeg",
        ACL: "public-read",
        Metadata: {
          userId,
          uploadedAt: String(ts)
        }
      })
    );
    return { ok: true, key, url: wasabiPublicUrlForKey(cfg, key) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "upload_failed" };
  }
}

