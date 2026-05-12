import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

export type VersionConfigPayload = {
  success: true;
  versionNumber: string;
  forceUpdate: boolean;
  shouldUpdate: boolean;
};

export type VersionConfigResolution = VersionConfigPayload & {
  source: "firestore" | "default" | "firestore_unavailable";
  cacheAgeMs: number;
};

const DEFAULT_VERSION_CONFIG: VersionConfigPayload = {
  success: true,
  versionNumber: "1.0.0",
  forceUpdate: false,
  shouldUpdate: false
};

const VERSION_CONFIG_CACHE_TTL_MS = 30_000;

let cachedConfig: { fetchedAtMs: number; resolution: VersionConfigResolution } | null = null;

function normalizeVersionNumber(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return DEFAULT_VERSION_CONFIG.versionNumber;
}

function normalizeBooleanFlag(value: unknown): boolean {
  return value === true;
}

function buildResolution(
  payload: VersionConfigPayload,
  source: VersionConfigResolution["source"],
  cacheAgeMs: number
): VersionConfigResolution {
  return {
    ...payload,
    source,
    cacheAgeMs
  };
}

export function resetVersionConfigCacheForTests(): void {
  cachedConfig = null;
}

export async function resolveVersionConfig(): Promise<VersionConfigResolution> {
  const now = Date.now();
  if (cachedConfig && now - cachedConfig.fetchedAtMs < VERSION_CONFIG_CACHE_TTL_MS) {
    return {
      ...cachedConfig.resolution,
      cacheAgeMs: now - cachedConfig.fetchedAtMs
    };
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    const resolution = buildResolution(DEFAULT_VERSION_CONFIG, "firestore_unavailable", 0);
    cachedConfig = { fetchedAtMs: now, resolution };
    return resolution;
  }

  try {
    const snap = await db.collection("version").doc("config").get();
    if (!snap.exists) {
      const resolution = buildResolution(DEFAULT_VERSION_CONFIG, "default", 0);
      cachedConfig = { fetchedAtMs: now, resolution };
      return resolution;
    }

    const data = snap.data();
    const payload: VersionConfigPayload = {
      success: true,
      versionNumber: normalizeVersionNumber(data?.versionNumber),
      forceUpdate: normalizeBooleanFlag(data?.forceUpdate),
      shouldUpdate: normalizeBooleanFlag(data?.shouldUpdate)
    };
    const resolution = buildResolution(payload, "firestore", 0);
    cachedConfig = { fetchedAtMs: now, resolution };
    return resolution;
  } catch {
    const resolution = buildResolution(DEFAULT_VERSION_CONFIG, "firestore_unavailable", 0);
    cachedConfig = { fetchedAtMs: now, resolution };
    return resolution;
  }
}
