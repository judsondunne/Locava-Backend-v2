/**
 * Safe profile upsert helpers.
 *
 * Rules (BUG-FIX #1 / B):
 *   - Existing Firestore user doc wins.
 *   - Onboarding-typed (caller-supplied non-empty) values win.
 *   - Existing custom profile photo wins.
 *   - Google/provider photo/name/email-derived handle are fallback only for brand-new
 *     users with empty fields.
 *   - Never overwrite profile fields with null/undefined/empty provider values.
 *   - Never regenerate/reset handle on sign-in.
 *
 * Usage:
 *   - For a brand-new user (no doc exists) → write the full canonical payload as-is.
 *   - For an existing user doc → build a "fill-missing-only" patch that:
 *       (a) keeps every protected field (handle/name/profilePic/displayName/email/etc)
 *           untouched whenever the existing Firestore value is non-empty, AND
 *       (b) strips empty/null/undefined incoming values for those protected fields so
 *           merge:true cannot clobber them with provider fallbacks.
 *
 * Non-protected fields (activityProfile, age, school, branchData, push tokens, lastSeen,
 * etc.) follow caller-provided values so onboarding can still fill them in if missing.
 */

/** Profile fields that must never be replaced by an empty / provider-fallback value. */
export const PROTECTED_PROFILE_FIELDS: ReadonlyArray<string> = [
  "handle",
  "searchHandle",
  "name",
  "displayName",
  "searchName",
  "profilePic",
  "profilePicture",
  "photoURL",
  "photo",
  "avatarUrl",
  "phoneNumber",
  "number",
  "bio",
  "email"
];

function isMeaningfulString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export interface SafeProfileUpsertInput {
  /** Existing Firestore user doc (if any). */
  existingDoc: Record<string, unknown> | null | undefined;
  /** Canonical write payload built from caller input + provider fallbacks. */
  proposedPayload: Record<string, unknown>;
}

export interface SafeProfileUpsertResult {
  /** Final payload to send to Firestore set(... , { merge: true }). */
  safePayload: Record<string, unknown>;
  /** Protected fields that were preserved because existing non-empty value won. */
  preservedFields: string[];
  /** Protected fields that the caller explicitly overrode (typed non-empty value). */
  overwrittenByTyped: string[];
  /** Protected fields where the proposed value was empty AND existing was empty (no-op). */
  remainedEmptyFields: string[];
}

/**
 * Build a Firestore-safe payload that never clobbers existing protected fields with
 * empty/provider-fallback values.
 *
 * If `existingDoc` is null/undefined → returns `proposedPayload` unchanged (caller is
 * responsible for creating a new doc).
 */
export function buildSafeProfileUpsertPayload(input: SafeProfileUpsertInput): SafeProfileUpsertResult {
  const proposed = { ...input.proposedPayload };
  const preservedFields: string[] = [];
  const overwrittenByTyped: string[] = [];
  const remainedEmptyFields: string[] = [];

  if (!input.existingDoc) {
    return {
      safePayload: proposed,
      preservedFields,
      overwrittenByTyped,
      remainedEmptyFields
    };
  }

  for (const field of PROTECTED_PROFILE_FIELDS) {
    const hasIncoming = Object.prototype.hasOwnProperty.call(proposed, field);
    if (!hasIncoming) continue;
    const incoming = proposed[field];
    const existing = input.existingDoc[field];
    const incomingMeaningful = isMeaningfulValue(incoming);
    const existingMeaningful = isMeaningfulValue(existing);

    if (!incomingMeaningful && existingMeaningful) {
      // Existing wins; strip the empty incoming so merge:true cannot overwrite.
      delete proposed[field];
      preservedFields.push(field);
      continue;
    }

    if (!incomingMeaningful && !existingMeaningful) {
      // Both empty: also strip — never write empty strings into Firestore.
      delete proposed[field];
      remainedEmptyFields.push(field);
      continue;
    }

    if (incomingMeaningful && existingMeaningful) {
      // Typed value wins over existing only if they actually differ.
      // (Equal values are still kept; harmless idempotent write.)
      const sameString =
        isMeaningfulString(incoming) &&
        isMeaningfulString(existing) &&
        incoming.trim() === existing.trim();
      if (!sameString) overwrittenByTyped.push(field);
      continue;
    }

    // incomingMeaningful && !existingMeaningful → fill the gap, no log.
  }

  return {
    safePayload: proposed,
    preservedFields,
    overwrittenByTyped,
    remainedEmptyFields
  };
}

/** Pure helper for ergonomic callers that already have separate inputs. */
export function decideExistingUserMergePolicy(input: {
  existingDoc: Record<string, unknown> | null | undefined;
}): "fill_missing_only" | "create_new_doc" {
  return input.existingDoc ? "fill_missing_only" : "create_new_doc";
}
