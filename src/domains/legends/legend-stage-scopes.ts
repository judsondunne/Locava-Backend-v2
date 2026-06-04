import type { LegendPostCreatedInput, LegendScopeId } from "./legends.types.js";

export function isSupportedLegendScopeId(scopeId: string): boolean {
  if (scopeId.startsWith("activity:")) return true;
  if (scopeId.startsWith("place:state:") || scopeId.startsWith("place:country:")) return true;
  if (scopeId.startsWith("placeActivity:state:") || scopeId.startsWith("placeActivity:country:")) return true;
  return false;
}

function normalizeScopeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

/** Canonical persisted field is `derivedScopes`; read legacy aliases for older stage docs. */
export function readPersistedDerivedScopes(raw: unknown): string[] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fieldNames = ["derivedScopes", "scopes", "stagedScopes", "scopeIds"] as const;
  for (const fieldName of fieldNames) {
    const scopes = normalizeScopeList(obj[fieldName]);
    if (scopes.length > 0) return scopes;
  }
  return [];
}

export type LegendStageContextSnapshot = {
  activityIds: string[];
  state: string | null;
  country: string | null;
  geohash: string | null;
  city: string | null;
};

export function readStageContextSnapshot(raw: unknown): LegendStageContextSnapshot | null {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ctx =
    obj.stageContext && typeof obj.stageContext === "object"
      ? (obj.stageContext as Record<string, unknown>)
      : null;
  if (!ctx) return null;
  const activityIds = normalizeScopeList(ctx.activityIds ?? ctx.activities).slice(0, 6);
  const state = typeof ctx.state === "string" && ctx.state.trim() ? ctx.state.trim() : null;
  const country = typeof ctx.country === "string" && ctx.country.trim() ? ctx.country.trim() : null;
  const geohash = typeof ctx.geohash === "string" && ctx.geohash.trim() ? ctx.geohash.trim() : null;
  const city = typeof ctx.city === "string" && ctx.city.trim() ? ctx.city.trim() : null;
  if (activityIds.length === 0 && !state && !country && !geohash && !city) return null;
  return { activityIds, state, country, geohash, city };
}

export function filterSupportedLegendScopes(scopeIds: string[], maxScopes = 8): LegendScopeId[] {
  return [...new Set(scopeIds.filter((scopeId) => scopeId && isSupportedLegendScopeId(scopeId)))].slice(0, maxScopes);
}

export type ResolvedCommitScopes = {
  derivedScopes: LegendScopeId[];
  persistedScopeCount: number;
  commitReadScopeCount: number;
  fallbackRecomputeScopeCount: number;
  scopeSource: "persisted" | "recomputed" | "persisted+recomputed";
};

export function resolveCommitDerivedScopes(input: {
  stageRaw: unknown;
  legendPost: LegendPostCreatedInput;
  recompute: (post: LegendPostCreatedInput) => LegendScopeId[];
  maxScopes?: number;
}): ResolvedCommitScopes {
  const maxScopes = input.maxScopes ?? 8;
  const persistedRaw = readPersistedDerivedScopes(input.stageRaw);
  const persistedScopeCount = persistedRaw.length;
  const commitReadScopes = filterSupportedLegendScopes(persistedRaw, maxScopes);
  const commitReadScopeCount = commitReadScopes.length;

  if (commitReadScopeCount > 0) {
    return {
      derivedScopes: commitReadScopes,
      persistedScopeCount,
      commitReadScopeCount,
      fallbackRecomputeScopeCount: 0,
      scopeSource: "persisted"
    };
  }

  const stageContext = readStageContextSnapshot(input.stageRaw);
  const recomputePost: LegendPostCreatedInput = {
    ...input.legendPost,
    activities:
      Array.isArray(input.legendPost.activities) && input.legendPost.activities.length > 0
        ? input.legendPost.activities
        : stageContext?.activityIds ?? [],
    state: input.legendPost.state ?? stageContext?.state ?? null,
    country: input.legendPost.country ?? stageContext?.country ?? null,
    city: input.legendPost.city ?? stageContext?.city ?? null,
    geohash: input.legendPost.geohash ?? stageContext?.geohash ?? null
  };
  const recomputed = filterSupportedLegendScopes(input.recompute(recomputePost), maxScopes);
  const fallbackRecomputeScopeCount = recomputed.length;

  if (fallbackRecomputeScopeCount > 0) {
    return {
      derivedScopes: recomputed,
      persistedScopeCount,
      commitReadScopeCount,
      fallbackRecomputeScopeCount,
      scopeSource: "recomputed"
    };
  }

  return {
    derivedScopes: [],
    persistedScopeCount,
    commitReadScopeCount,
    fallbackRecomputeScopeCount: 0,
    scopeSource: "persisted"
  };
}

export function assertNoSilentScopeLoss(input: {
  stageDocPath: string;
  stageId: string;
  postId: string;
  persistedScopeCount: number;
  commitReadScopeCount: number;
  fallbackRecomputeScopeCount: number;
  resolvedScopeCount: number;
}): void {
  if (input.persistedScopeCount <= 0) return;
  if (input.resolvedScopeCount > 0) return;
  const message = "legend_stage_scope_loss";
  console.error(`[legend.commit] ${message}`, {
    stageDocPath: input.stageDocPath,
    stageId: input.stageId,
    postId: input.postId,
    persistedScopeCount: input.persistedScopeCount,
    commitReadScopeCount: input.commitReadScopeCount,
    fallbackRecomputeScopeCount: input.fallbackRecomputeScopeCount,
    resolvedScopeCount: input.resolvedScopeCount
  });
  throw new Error(message);
}
