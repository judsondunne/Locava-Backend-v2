import { CopyObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  buildFinalizedSessionAssetKeys,
  buildStableSessionAssetId
} from "../storage/wasabi-presign.service.js";
import { wasabiPublicUrlForKey, type WasabiRuntimeConfig } from "../storage/wasabi-config.js";
import { isLikelyPublicFinalImageUrl, isPendingPlaceholderUrl, isStagingObjectKey } from "./photo-url-guards.js";

type ResolveInput = {
  cfg: WasabiRuntimeConfig | null;
  sessionId: string;
  index: number;
  clientMediaKey?: string | null;
  uploadedObjectKey?: string | null;
  fallbackOriginalUrl?: string | null;
};

type ResolveOutput = {
  assetId: string;
  finalKey: string;
  finalUrl: string | null;
  promoted: boolean;
  publicReadable: boolean;
  imageVariantsPending: boolean;
};

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

async function headObject(client: S3Client, bucket: string, key: string): Promise<{ ok: boolean; contentType?: string }> {
  try {
    const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { ok: true, contentType: typeof out.ContentType === "string" ? out.ContentType : undefined };
  } catch {
    return { ok: false };
  }
}

async function verifyPublicUrl(url: string): Promise<boolean> {
  if (!isLikelyPublicFinalImageUrl(url)) return false;
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) return true;
  } catch {
    // fall through
  }
  try {
    const get = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    return get.ok || get.status === 206;
  } catch {
    return false;
  }
}

export async function resolveFinalImageAssetForPost(input: ResolveInput): Promise<ResolveOutput> {
  const assetId = buildStableSessionAssetId(input.sessionId, input.index, "photo", input.clientMediaKey ?? null);
  const keys = buildFinalizedSessionAssetKeys(input.sessionId, input.index, "photo", input.clientMediaKey ?? null);
  const finalKey = keys.originalKey;
  if (!input.cfg) {
    return { assetId, finalKey, finalUrl: null, promoted: false, publicReadable: false, imageVariantsPending: true };
  }
  const cfg = input.cfg;
  const client = createS3Client(cfg);
  const sourceKey = (input.uploadedObjectKey ?? "").trim() || finalKey;
  let promoted = false;

  if (isStagingObjectKey(sourceKey) || sourceKey !== finalKey) {
    const srcHead = await headObject(client, cfg.bucketName, sourceKey);
    if (srcHead.ok) {
      const contentType = (srcHead.contentType ?? "image/jpeg").toLowerCase();
      const safeContentType = contentType.includes("webp") ? "image/webp" : "image/jpeg";
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: cfg.bucketName,
            CopySource: `${cfg.bucketName}/${sourceKey}`,
            Key: finalKey,
            ACL: "public-read",
            ContentType: safeContentType,
            MetadataDirective: "REPLACE"
          })
        );
        promoted = true;
        console.info("[posting.photo.promote]", { sessionId: input.sessionId, mediaIndex: input.index, sourceKey, finalKey });
      } catch (error) {
        console.warn("[posting.photo.promote]", {
          sessionId: input.sessionId,
          mediaIndex: input.index,
          sourceKey,
          finalKey,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const finalHead = await headObject(client, cfg.bucketName, finalKey);
  const finalUrl = wasabiPublicUrlForKey(cfg, finalKey);
  const publicReadable = finalHead.ok && (await verifyPublicUrl(finalUrl));
  if (publicReadable) {
    console.info("[posting.photo.public_url_verified]", { sessionId: input.sessionId, mediaIndex: input.index, finalKey, finalUrl });
    return { assetId, finalKey, finalUrl, promoted, publicReadable: true, imageVariantsPending: true };
  }
  const fallbackUrl = (input.fallbackOriginalUrl ?? "").trim();
  if (fallbackUrl && isLikelyPublicFinalImageUrl(fallbackUrl) && !isPendingPlaceholderUrl(fallbackUrl)) {
    const fallbackOk = await verifyPublicUrl(fallbackUrl);
    if (fallbackOk) {
      return { assetId, finalKey, finalUrl: fallbackUrl, promoted, publicReadable: true, imageVariantsPending: true };
    }
  }
  return { assetId, finalKey, finalUrl: null, promoted, publicReadable: false, imageVariantsPending: true };
}
