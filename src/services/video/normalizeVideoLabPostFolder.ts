import type { WasabiRuntimeConfig } from "../storage/wasabi-config.js";
import { headObjectExists } from "../storage/wasabi-staging.service.js";

/**
 * Canonical folder name under `videos-lab/` for a post. Never returns `post_post_*`.
 */
export function normalizeVideoLabPostFolder(postIdOrKey: string): string {
  const t = String(postIdOrKey ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!t) return "post_unknown";
  let s = t;
  while (s.startsWith("post_post_")) {
    s = s.replace(/^post_post_/, "post_");
  }
  if (s.startsWith("post_")) return s;
  return `post_${s}`;
}

/** If `url` is under cfg endpoint + bucket, return the object key; otherwise null. */
export function objectKeyFromWasabiPublicUrl(cfg: WasabiRuntimeConfig, url: string): string | null {
  const base = cfg.endpoint.replace(/\/+$/, "");
  const prefix = `${base}/${cfg.bucketName}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length).replace(/^\/+/, "");
  return key.length > 0 ? key : null;
}

async function repairVideosLabPostDoublePrefixInString(
  cfg: WasabiRuntimeConfig,
  s: string,
  warnings: string[]
): Promise<string> {
  if (!s.includes("videos-lab/post_post_")) return s;
  const candidate = s.replaceAll("videos-lab/post_post_", "videos-lab/post_");
  if (candidate === s) return s;
  const key = objectKeyFromWasabiPublicUrl(cfg, candidate);
  if (key && (await headObjectExists(cfg, key))) {
    return candidate;
  }
  warnings.push("legacy_double_post_prefix_url");
  return s;
}

function isFirestoreTimestampLike(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as { toMillis?: unknown }).toMillis === "function"
  );
}

async function mapRepairValue(
  cfg: WasabiRuntimeConfig,
  v: unknown,
  warnings: string[]
): Promise<unknown> {
  if (typeof v === "string") {
    return repairVideosLabPostDoublePrefixInString(cfg, v, warnings);
  }
  if (Array.isArray(v)) {
    return Promise.all(v.map((x) => mapRepairValue(cfg, x, warnings)));
  }
  if (v && typeof v === "object") {
    if (v instanceof Date || isFirestoreTimestampLike(v)) return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = await mapRepairValue(cfg, val, warnings);
    }
    return out;
  }
  return v;
}

/**
 * Rewrites `videos-lab/post_post_*` URLs to `videos-lab/post_*` when the normalized object exists in Wasabi.
 * Otherwise keeps the original URL and records `legacy_double_post_prefix_url` (non-blocking).
 */
export async function repairVideosLabDoublePostPrefixUrlsDeep(
  cfg: WasabiRuntimeConfig,
  root: Record<string, unknown>
): Promise<{ value: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  const value = (await mapRepairValue(cfg, root, warnings)) as Record<string, unknown>;
  const unique = Array.from(new Set(warnings));
  return { value, warnings: unique };
}
