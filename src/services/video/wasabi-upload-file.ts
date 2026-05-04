import { createReadStream } from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { wasabiPublicUrlForKey, type WasabiRuntimeConfig } from "../storage/wasabi-config.js";

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

export async function uploadFileToWasabiKey(input: {
  cfg: WasabiRuntimeConfig;
  localPath: string;
  key: string;
  contentType: string;
}): Promise<{ publicUrl: string; sizeBytes: number }> {
  const client = createS3Client(input.cfg);
  const fs = await import("node:fs/promises");
  const st = await fs.stat(input.localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: input.cfg.bucketName,
      Key: input.key.replace(/^\/+/, ""),
      Body: createReadStream(input.localPath),
      ContentType: input.contentType,
      /** Matches v1 + presigned staging uploads — `wasabiPublicUrlForKey` only works if the object is world-readable. */
      ACL: "public-read",
    }),
  );
  return { publicUrl: wasabiPublicUrlForKey(input.cfg, input.key), sizeBytes: st.size };
}
