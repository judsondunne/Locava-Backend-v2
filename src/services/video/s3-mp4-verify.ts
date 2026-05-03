import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { WasabiRuntimeConfig } from "../storage/wasabi-config.js";
import { moovHintFromMp4Prefix, type MoovHint } from "./mp4-moov-hint.js";
import type { RemoteVerifyFail, RemoteVerifyOk } from "./remote-url-verify.js";

export type { RemoteVerifyOk, RemoteVerifyFail };

/** Parse total object size from RFC 7233 `Content-Range: bytes 0-9/9999` headers. */
export function parseTotalLengthFromContentRangeHeader(value: string | undefined): number {
  const v = typeof value === "string" ? value.trim() : "";
  const m = v.match(/\/(\d+)\s*$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function wasabiS3Client(cfg: WasabiRuntimeConfig): S3Client {
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

async function readS3BodyPrefix(
  body: unknown,
  maxBytes: number,
  opts?: { contentLengthKnown?: number },
): Promise<Buffer> {
  if (!body) throw new Error("empty_body");
  const withTransform = body as { transformToByteArray?: () => Promise<Uint8Array> };
  const knownLen = typeof opts?.contentLengthKnown === "number" ? opts.contentLengthKnown : null;
  if (typeof withTransform.transformToByteArray === "function") {
    if (knownLen == null || knownLen > maxBytes) {
      throw new Error("prefer_streaming_prefix_read");
    }
    const arr = await withTransform.transformToByteArray();
    return Buffer.from(arr instanceof Buffer ? arr : arr).subarray(0, maxBytes);
  }
  const iterable = body as AsyncIterable<Uint8Array | Buffer | string>;
  if (iterable && Symbol.asyncIterator in iterable) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of iterable) {
      const buf = typeof c === "string" ? Buffer.from(c) : Buffer.isBuffer(c) ? c : Buffer.from(c);
      chunks.push(buf);
      total += buf.length;
      if (total >= maxBytes) break;
    }
    return Buffer.concat(chunks, Math.min(total, maxBytes));
  }
  throw new Error("unsupported_body");
}

/** Same semantics as verifyRemoteMp4Faststart but reads via authenticated S3 (avoids 403 on non-public lab prefixes). */
export async function verifyS3ObjectMp4Faststart(
  cfg: WasabiRuntimeConfig,
  objectKey: string,
  originalPublicUrl: string,
  variantPublicUrl: string,
  opts?: { requireMoovBeforeMdat?: boolean },
): Promise<RemoteVerifyOk | RemoteVerifyFail> {
  const bucket = cfg.bucketName;
  const normKey = objectKey.replace(/^\/+/, "");

  if (!normKey) return { ok: false, reason: "bad_key" };
  if (originalPublicUrl && variantPublicUrl.trim() === originalPublicUrl.trim()) {
    return { ok: false, reason: "url_equals_original" };
  }

  const client = wasabiS3Client(cfg);
  let headLen = 0;
  let contentType = "";
  /** When HeadObject returns 403/401 (IAM/bucket policy), ranged GetObject often still succeeds. */
  let headUnavailable = false;
  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: normKey
      }),
    );
    contentType = typeof head.ContentType === "string" ? head.ContentType : "";
    headLen = typeof head.ContentLength === "number" ? head.ContentLength : 0;
    if (!headLen) return { ok: false, reason: "missing_content_length" };
  } catch (e: unknown) {
    const code = getHttpStatusFromAwsError(e);
    if (code === 404) return { ok: false, reason: "range_http_404" };
    if (code === 403 || code === 401) {
      headUnavailable = true;
      headLen = 0;
    } else {
      return { ok: false, reason: httpReason("head", code) };
    }
  }

  const prefixCap = 524_288;
  const maxBytes = headUnavailable ? prefixCap : Math.min(prefixCap, Math.max(1, headLen));
  let buf: Buffer = Buffer.alloc(0);
  let usedFullObjectGetFallback = false;
  try {
    const get = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: normKey,
        Range: `bytes=0-${maxBytes - 1}`
      }),
    );
    buf = await readS3BodyPrefix(get.Body, maxBytes, {
      contentLengthKnown: typeof get.ContentLength === "number" ? get.ContentLength : undefined,
    });
    if (headUnavailable) {
      contentType =
        typeof get.ContentType === "string" && get.ContentType.length > 0
          ? get.ContentType
          : contentType;
      const fromRange = parseTotalLengthFromContentRangeHeader(
        typeof get.ContentRange === "string" ? get.ContentRange : undefined,
      );
      const fromPartial =
        typeof get.ContentLength === "number" && get.ContentLength > 0 ? get.ContentLength : 0;
      headLen =
        fromRange > 0
          ? fromRange
          : fromPartial > buf.length
            ? fromPartial
            : fromPartial >= maxBytes && buf.length >= maxBytes
              ? maxBytes + 1
              : buf.length || fromPartial;
      if (!Number.isFinite(headLen) || headLen <= 0) {
        return { ok: false, reason: "missing_content_length" };
      }
    }
  } catch (e: unknown) {
    const code = getHttpStatusFromAwsError(e);
    const bodyPrefixNeedsFullObject =
      e instanceof Error && e.message === "prefer_streaming_prefix_read";
    /** SigV4 ranged reads are forbidden on some Wasabi setups while full-object streamed reads succeed. */
    const retryFullObjectGet =
      code === 403 || code === 401 || (bodyPrefixNeedsFullObject && code == null);

    if (code === 404) return { ok: false, reason: "range_http_404" };
    if (!retryFullObjectGet) {
      return {
        ok: false,
        reason: typeof code === "number" ? httpReason("range", code) : `range_read:${(e as Error)?.message ?? "fail"}`
      };
    }
    try {
      const fullGet = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: normKey,
        }),
      );
      usedFullObjectGetFallback = true;
      if (typeof fullGet.ContentType === "string" && fullGet.ContentType.length > 0) {
        contentType = fullGet.ContentType;
      }
      const fullKnown =
        typeof fullGet.ContentLength === "number" && fullGet.ContentLength > 0 ? fullGet.ContentLength : headLen;
      buf = await readS3BodyPrefix(fullGet.Body, maxBytes, { contentLengthKnown: fullKnown });
      if (headUnavailable && fullKnown > 0) headLen = fullKnown;
    } catch (e2: unknown) {
      const c2 = getHttpStatusFromAwsError(e2);
      if (c2 === 404) return { ok: false, reason: "range_http_404" };
      return { ok: false, reason: httpReason("range_full", c2 ?? code) };
    }
  }

  if (!buf.length) return { ok: false, reason: "empty_range" };

  let ctNorm = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const moovSniffEarly = moovHintFromMp4Prefix(buf);
  if (
    ctNorm.length > 0 &&
    !ctNorm.includes("video/mp4") &&
    !ctNorm.includes("application/octet-stream")
  ) {
    if (
      (headUnavailable || usedFullObjectGetFallback) &&
      moovSniffEarly === "moov_before_mdat_in_prefix"
    ) {
      /* Some S3-compatible stacks omit or mis-declare Content-Type on ranged reads. */
      ctNorm = "video/mp4";
      contentType = "video/mp4";
    }
  }
  if (
    ctNorm.length > 0 &&
    !ctNorm.includes("video/mp4") &&
    !ctNorm.includes("application/octet-stream")
  ) {
    return { ok: false, reason: `unexpected_content_type:${ctNorm || "empty"}` };
  }

  const moovHint: MoovHint = moovSniffEarly;
  if (opts?.requireMoovBeforeMdat !== false && moovHint !== "moov_before_mdat_in_prefix") {
    return { ok: false, reason: `moov_hint:${moovHint}` };
  }
  return { ok: true, contentLength: headLen, contentType, moovHint };
}

function getHttpStatusFromAwsError(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const meta = (e as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return typeof meta?.httpStatusCode === "number" ? meta.httpStatusCode : undefined;
}

function httpReason(phase: "head" | "range" | "range_full", code: number | undefined): string {
  if (code === 403 || code === 401) return `range_http_${phase}_forbidden:${code}`;
  if (typeof code === "number") return `range_http_${code}`;
  return `${phase}_read_failed`;
}
