import {
  wasabiPublicUrlForKey,
  type WasabiRuntimeConfig,
} from "./wasabi-config.js";
import { waitForObjectKeys } from "./wasabi-staging.service.js";

export type AssertUploadedObjectKeysResult =
  | { ok: true; presentKeys: string[] }
  | { ok: false; missingKeys: string[]; error?: string };

/**
 * Probe Wasabi for uploaded object keys (HEAD + public URL fallback), matching
 * photo `completeUpload` behavior. When POST_UPLOAD_REQUIRE_STORAGE_PROBE=1,
 * missing keys fail hard; otherwise a probe error fails, but empty present sets
 * after retries still return ok for transitional buckets (same as photos).
 */
export async function assertUploadedObjectKeysPresent(
  cfg: WasabiRuntimeConfig,
  keys: Array<string | null | undefined>,
  opts?: {
    requireStorageProbe?: boolean;
    headPublicUrl?: (url: string) => Promise<boolean>;
    waitForKeys?: typeof waitForObjectKeys;
  }
): Promise<AssertUploadedObjectKeysResult> {
  const unique = Array.from(
    new Set(
      keys
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter((k) => k.length > 0)
    )
  );
  if (unique.length === 0) {
    return { ok: true, presentKeys: [] };
  }

  const wait = opts?.waitForKeys ?? waitForObjectKeys;
  const ready = await wait(cfg, unique);
  if (!ready.success) {
    return {
      ok: false,
      missingKeys: unique,
      error: ready.error || "storage_probe_failed",
    };
  }

  const present = new Set(ready.presentKeys);
  const initialMissing = unique.filter((key) => !present.has(key));
  if (initialMissing.length > 0) {
    const headPublic =
      opts?.headPublicUrl ??
      (async (url: string) => {
        try {
          const res = await fetch(url, { method: "HEAD" });
          return res.ok;
        } catch {
          return false;
        }
      });
    const checks = await Promise.all(
      initialMissing.map(async (key) => {
        const exists = await headPublic(wasabiPublicUrlForKey(cfg, key));
        return { key, exists };
      })
    );
    for (const check of checks) {
      if (check.exists) present.add(check.key);
    }
  }

  const missingKeys = unique.filter((key) => !present.has(key));
  const requireStorageProbe =
    opts?.requireStorageProbe ?? process.env.POST_UPLOAD_REQUIRE_STORAGE_PROBE === "1";

  if (missingKeys.length === 0) {
    return { ok: true, presentKeys: unique };
  }
  if (requireStorageProbe) {
    return {
      ok: false,
      missingKeys,
      error: "storage_probe_missing_keys",
    };
  }
  // Soft mode (photo completeUpload parity): accept declared keys when probe is inconclusive.
  return { ok: true, presentKeys: Array.from(present) };
}
