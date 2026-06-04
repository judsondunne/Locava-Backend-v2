/**
 * Shared visibility normalization for master-post writes and standardized render reads.
 *
 * Master post storage: `public` | `friends` | `private` | `unknown`
 * Standardized render contract: `public` | `private` | `group`
 */

export const MASTER_POST_VISIBILITY_VALUES = [
  "public",
  "friends",
  "private",
  "unknown",
] as const;
export type MasterPostVisibility = (typeof MASTER_POST_VISIBILITY_VALUES)[number];

export const STANDARDIZED_VISIBILITY_VALUES = ["public", "private", "group"] as const;
export type StandardizedVisibilityValue = (typeof STANDARDIZED_VISIBILITY_VALUES)[number];

function readVisibilityString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalize any legacy/missing visibility before writing to Firestore / master post.
 */
export function normalizePostVisibilityForWrite(value: unknown): MasterPostVisibility {
  const raw = readVisibilityString(value);
  const normalized = raw.toLowerCase();
  if ((MASTER_POST_VISIBILITY_VALUES as readonly string[]).includes(normalized)) {
    return normalized as MasterPostVisibility;
  }
  const legacyMap: Record<string, MasterPostVisibility> = {
    group: "friends",
    followers: "friends",
    "public spot": "public",
    "public route": "public",
    "friends spot": "friends",
    "private spot": "private",
  };
  return legacyMap[normalized] ?? "public";
}

export type CoerceStandardizedVisibilityOptions = {
  postId?: string;
  surface?: string | null;
  /** When true, emit RENDER_STANDARDIZED_VISIBILITY_COERCE for non-trivial remaps. */
  logCoercion?: boolean;
};

/**
 * Maps master-post / legacy visibility strings into the strict standardized enum.
 * Never returns values outside `public` | `private` | `group`.
 */
export function coerceStandardizedVisibility(
  value: unknown,
  options?: CoerceStandardizedVisibilityOptions,
): StandardizedVisibilityValue {
  const raw = readVisibilityString(value);
  const normalized = raw.toLowerCase();
  if ((STANDARDIZED_VISIBILITY_VALUES as readonly string[]).includes(normalized)) {
    return normalized as StandardizedVisibilityValue;
  }
  const legacyMap: Record<string, StandardizedVisibilityValue> = {
    friends: "group",
    followers: "group",
    unknown: "public",
    "public spot": "public",
    "public route": "public",
    "friends spot": "group",
    "private spot": "private",
  };
  const next = legacyMap[normalized] ?? "public";
  if (options?.logCoercion && raw && raw !== next) {
    // eslint-disable-next-line no-console
    console.info("RENDER_STANDARDIZED_VISIBILITY_COERCE", {
      postId: options.postId ?? null,
      surface: options.surface ?? null,
      oldVisibility: raw,
      newVisibility: next,
      source: "render_standardized_visibility_coerce",
    });
  }
  return next;
}

/** Final safety pass before Zod parse on standardized render docs. */
export function ensureStandardizedClassificationVisibility(
  classification: { visibility?: unknown; [key: string]: unknown },
  ctx: { postId: string; surface?: string | null },
): void {
  classification.visibility = coerceStandardizedVisibility(classification.visibility, {
    postId: ctx.postId,
    surface: ctx.surface ?? null,
    logCoercion: true,
  });
}
