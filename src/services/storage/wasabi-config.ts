/**
 * Wasabi (S3-compatible) configuration — mirrors env keys used by Locava Backend v1
 * (`Locava Backend/src/config/wasabi.ts`) so the same deployment secrets work for v2.
 */
export type WasabiRuntimeConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  bucketName: string;
};

export function readWasabiConfigFromEnv(): WasabiRuntimeConfig | null {
  const accessKeyId =
    process.env.WASABI_ACCESS_KEY_ID?.trim() ||
    process.env.AWS_ACCESS_KEY_ID?.trim() ||
    process.env.NEXT_PUBLIC_WASABI_ACCESS_KEY_ID?.trim() ||
    "";
  const secretAccessKey =
    process.env.WASABI_SECRET_ACCESS_KEY?.trim() ||
    process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
    process.env.NEXT_PUBLIC_WASABI_SECRET_ACCESS_KEY?.trim() ||
    "";
  const region =
    process.env.WASABI_REGION?.trim() || process.env.NEXT_PUBLIC_WASABI_REGION?.trim() || "us-east-1";
  const endpoint =
    process.env.WASABI_ENDPOINT?.trim() ||
    process.env.NEXT_PUBLIC_WASABI_ENDPOINT?.trim() ||
    `https://s3.${region}.wasabisys.com`;
  const bucketName =
    process.env.WASABI_BUCKET_NAME?.trim() ||
    process.env.NEXT_PUBLIC_WASABI_BUCKET_NAME?.trim() ||
    "locava.app";

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    region,
    endpoint: endpoint.replace(/\/+$/, ""),
    bucketName
  };
}

/** Path-style public HTTPS URL for a bucket object (matches v1 `wasabiPublicUrlForKey`). */
export function wasabiPublicUrlForKey(cfg: WasabiRuntimeConfig, key: string): string {
  const base = cfg.endpoint.replace(/\/+$/, "");
  return `${base}/${cfg.bucketName}/${key.replace(/^\/+/, "")}`;
}
