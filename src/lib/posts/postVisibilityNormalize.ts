/**
 * Shared visibility normalization for master-post writes and standardized render reads.
 *
 * Master post storage: `public` | `friends` | `private` (never persist `unknown` on finalize)
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
 * Normalize classification.visibility before Firestore / master post writes.
 * Never persists `unknown` for active user-created posts.
 */
export function normalizeClassificationVisibility(
  input: unknown,
  privacyLabel?: unknown,
  privacy?: unknown,
): MasterPostVisibility {
  const raw = readVisibilityString(input);
  const normalized = raw.toLowerCase();
  if (normalized === "public") return "public";
  if (normalized === "private") return "private";
  if (normalized === "friends" || normalized === "group" || normalized === "followers") {
    return "friends";
  }

  const label = readVisibilityString(privacyLabel).toLowerCase();
  const priv = readVisibilityString(privacy).toLowerCase();
  if (label.includes("private") || priv.includes("private") || priv === "private spot") {
    return "private";
  }
  if (
    label === "public route" ||
    label === "public spot" ||
    priv === "public route" ||
    priv === "public spot"
  ) {
    return "public";
  }

  return "public";
}

/**
 * Normalize any legacy/missing visibility before writing to Firestore / master post.
 */
export function normalizePostVisibilityForWrite(
  value: unknown,
  privacyLabel?: unknown,
  privacy?: unknown,
): MasterPostVisibility {
  return normalizeClassificationVisibility(value, privacyLabel, privacy);
}

export type CoerceStandardizedVisibilityOptions = {
  postId?: string;
  surface?: string | null;
  privacyLabel?: unknown;
  privacy?: unknown;
  /** When true, emit visibility coercion logs for non-trivial remaps. */
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

  const label = readVisibilityString(options?.privacyLabel).toLowerCase();
  const priv = readVisibilityString(options?.privacy).toLowerCase();
  if (label.includes("private") || priv.includes("private") || priv === "private spot") {
    return "private";
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
  const next =
    legacyMap[normalized] ??
    (label === "public route" || label === "public spot" || priv === "public route" || priv === "public spot"
      ? "public"
      : "public");

  if (options?.logCoercion && raw && raw.toLowerCase() !== next) {
    // eslint-disable-next-line no-console
    console.info("classification.visibility.invalid_coerced", {
      postId: options.postId ?? null,
      surface: options.surface ?? null,
      oldVisibility: raw,
      newVisibility: next,
      privacyLabel: readVisibilityString(options.privacyLabel) || null,
      privacy: readVisibilityString(options.privacy) || null,
      source: "render_standardized_visibility_coerce",
    });
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
  classification: { visibility?: unknown; privacyLabel?: unknown; [key: string]: unknown },
  ctx: { postId: string; surface?: string | null; privacy?: unknown },
): void {
  classification.visibility = coerceStandardizedVisibility(classification.visibility, {
    postId: ctx.postId,
    surface: ctx.surface ?? null,
    privacyLabel: classification.privacyLabel,
    privacy: ctx.privacy,
    logCoercion: true,
  });
}
