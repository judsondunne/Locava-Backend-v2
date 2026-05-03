import type { FirestoreProfileHeader } from "../../repositories/source-of-truth/profile-firestore.adapter.js";

/**
 * Bumped when the profile header entity cache shape or completeness rules change.
 * Old entries without this version are always treated as incomplete.
 */
export const PROFILE_HEADER_CACHE_SCHEMA_VERSION = 1 as const;

export type ProfileHeaderEntityCache = FirestoreProfileHeader & {
  _cacheSchemaVersion: typeof PROFILE_HEADER_CACHE_SCHEMA_VERSION;
};

/** Human-readable provenance for diagnostics (not exposed on HTTP surface). */
export type ProfileHeaderFieldSource =
  | "userDoc"
  | "authUser"
  | "summaryCache"
  | "subcollection_count_agg"
  | "embedded_denormalized"
  | "relationshipCount"
  | "boundedCountRepair"
  | "boundedPostCountRepair"
  | "gridLowerBound"
  | "missing"
  | "fallback";

export function isCompleteProfileHeaderEntityCache(value: unknown): value is ProfileHeaderEntityCache {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v._cacheSchemaVersion !== PROFILE_HEADER_CACHE_SCHEMA_VERSION) return false;
  if (typeof v.userId !== "string" || v.userId.trim().length === 0) return false;
  const counts = v.counts;
  if (!counts || typeof counts !== "object") return false;
  const c = counts as Record<string, unknown>;
  for (const key of ["posts", "followers", "following"] as const) {
    const n = c[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return false;
  }
  if (!("profilePic" in v)) return false;
  if (v.profilePic !== null && typeof v.profilePic !== "string") return false;
  return true;
}

export function withProfileHeaderCacheMetadata(header: FirestoreProfileHeader): ProfileHeaderEntityCache {
  return {
    ...header,
    _cacheSchemaVersion: PROFILE_HEADER_CACHE_SCHEMA_VERSION
  };
}

export function toPublicProfileHeader(header: FirestoreProfileHeader): FirestoreProfileHeader {
  const { _cacheSchemaVersion: _v, ...rest } = header as FirestoreProfileHeader & { _cacheSchemaVersion?: number };
  return rest;
}
