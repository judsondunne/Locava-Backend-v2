/**
 * Safe profile upsert helpers.
 *
 * Separation of auth/provider identity vs Locava-owned profile identity:
 *   - Google/Apple/Firebase Auth identity (`displayName`, `photoURL`, `email` from the
 *     provider, `providerData[].displayName`) is PROVIDER METADATA. It belongs on
 *     provider-specific fields only (e.g. `oauthInfo`, `authEmail`, `googleDisplayName`,
 *     `email` when that is what the user typed) and must NEVER be written into the
 *     public Locava identity surface for an existing user.
 *   - Locava username / handle (`handle`, `searchHandle`, `username`, `userName`,
 *     `userHandle`, `displayUsername`) and the public display name (`name`,
 *     `displayName`, `searchName`, `publicName`) are USER-OWNED APP IDENTITY. Once the
 *     onboarding / NameSet flow writes them they are the source of truth.
 *
 * Rules (BUG-FIX #1 / B + Google sign-in identity-preservation hardening):
 *   - Existing Firestore user doc wins.
 *   - Onboarding-typed (caller-supplied non-empty) values win for existing users only
 *     when they differ from the stored value.
 *   - Existing custom profile photo wins.
 *   - Google/provider photo/name/email-derived handle are fallback only for brand-new
 *     users with empty fields.
 *   - Never overwrite profile fields with null/undefined/empty provider values.
 *   - Never regenerate/reset handle on sign-in.
 *
 * Usage:
 *   - For a brand-new user (no doc exists) → write the full canonical payload as-is.
 *   - For an existing user doc → build a "fill-missing-only" patch that:
 *       (a) keeps every protected field (handle / userHandle / username / userName /
 *           displayUsername / name / displayName / searchHandle / searchName /
 *           profilePic + aliases / phoneNumber / bio / email) untouched whenever the
 *           existing Firestore value is non-empty, AND
 *       (b) strips empty/null/undefined incoming values for those protected fields so
 *           merge:true cannot clobber them with provider fallbacks.
 *
 * Non-protected fields (activityProfile, age, school, branchData, push tokens, lastSeen,
 * etc.) follow caller-provided values so onboarding can still fill them in if missing.
 */

/**
 * Profile fields that must never be replaced by an empty / provider-fallback value on
 * an existing Locava user doc.
 *
 * The list intentionally includes legacy aliases (`userHandle`, `userName`,
 * `displayUsername`, `publicName`, `username`) so any future code path that mistakenly
 * sends a Google-derived value under one of those names still cannot clobber the
 * existing Locava identity. This centralizes the rule so future providers / writers
 * cannot accidentally overwrite Locava identity fields.
 */
export const PROTECTED_PROFILE_FIELDS: ReadonlyArray<string> = [
  // Locava-owned handle / username surface (and every alias readers / legacy writers
  // may key off of). Google/Apple data must never reach any of these.
  "handle",
  "userHandle",
  "username",
  "userName",
  "displayUsername",
  "searchHandle",
  // Public display name surface.
  "name",
  "displayName",
  "publicName",
  "searchName",
  // Profile photo aliases (already-fixed photo behavior is preserved by listing them
  // here so the safe upsert continues to refuse empty provider photo values).
  "profilePic",
  "profilePicture",
  "photoURL",
  "photo",
  "avatarUrl",
  // Other user-owned identity facts that onboarding/edit-profile owns.
  "phoneNumber",
  "number",
  "bio",
  "email"
];

/**
 * Subset of PROTECTED_PROFILE_FIELDS that represent the Locava-owned "username/handle"
 * surface. Used for diagnostic logging (`hadExistingUsername`, `hadExistingHandle`)
 * without leaking the actual stored values.
 */
const LOCAVA_USERNAME_HANDLE_FIELDS: ReadonlyArray<string> = [
  "handle",
  "userHandle",
  "username",
  "userName",
  "displayUsername",
  "searchHandle"
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
  /**
   * Protected fields where existing was non-empty AND incoming was non-empty AND they
   * differed — but the existing value still won. We keep this name for log-shape
   * compatibility; the current policy never lets a typed Google/Apple/email-prefix
   * value overwrite a Locava-owned protected field during createProfile.
   */
  overwrittenByTyped: string[];
  /** Protected fields where the proposed value was empty AND existing was empty (no-op). */
  remainedEmptyFields: string[];
}

/**
 * Build a Firestore-safe payload that never clobbers existing protected fields with
 * provider-fallback values OR with typed values that originated from a Google/Apple
 * onboarding fallback ladder.
 *
 * Policy (locked-down identity preservation for `createProfile`):
 *   - If `existingDoc` is null/undefined → returns `proposedPayload` unchanged. The
 *     caller is responsible for creating a new doc; for a brand-new user, the typed
 *     onboarding values legitimately become the source of truth.
 *   - If `existingDoc` is present (existing Locava user, possibly re-routed through
 *     onboarding as existing_incomplete):
 *       * For every PROTECTED_PROFILE_FIELDS entry that already has a non-empty value
 *         in the existing doc, the proposed value is REMOVED from the payload — no
 *         matter whether the incoming value is empty, null, undefined, a Google
 *         displayName, an email prefix, or even a typed value the Native fallback
 *         ladder constructed from Google data. EDIT-PROFILE is the only flow that may
 *         legitimately update these fields and it does not route through this helper.
 *       * For protected fields where existing is empty AND incoming is non-empty,
 *         the incoming value is kept — that's a legitimate gap-fill (e.g. a user who
 *         never set a displayName editing one in).
 *       * For protected fields where both sides are empty, the empty incoming is
 *         stripped so Firestore never gets an empty string written.
 *
 * Non-protected fields (activityProfile, age, school, branchData, push tokens,
 * lastSeen, etc.) follow caller-provided values so onboarding can still fill them in
 * if missing.
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

    if (existingMeaningful) {
      // Locava-owned identity wins for every protected field with a stored value.
      // Strip the incoming value regardless of whether it is empty, provider-derived,
      // or appears to be "typed" — this helper is invoked from the createProfile path
      // which must never overwrite an existing Locava-owned identity field. Edits to
      // these fields belong on a dedicated edit-profile path.
      delete proposed[field];
      if (
        incomingMeaningful &&
        !(isMeaningfulString(incoming) && isMeaningfulString(existing) && incoming.trim() === existing.trim())
      ) {
        // Non-empty incoming that DIFFERS from stored value was refused. Recorded for
        // logging visibility (e.g. AUTH_GOOGLE_EXISTING_USER_PRESERVED_PROFILE).
        overwrittenByTyped.push(field);
      } else {
        preservedFields.push(field);
      }
      continue;
    }

    if (!incomingMeaningful) {
      // Both empty: strip — never write empty strings into Firestore.
      delete proposed[field];
      remainedEmptyFields.push(field);
      continue;
    }
    // incomingMeaningful && !existingMeaningful → fill the gap, keep as proposed.
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

/**
 * Build a privacy-safe summary of which Locava identity fields existed on the user doc
 * BEFORE this merge ran. Used by callers (auth profile create / Google sign-in) to emit
 * an `AUTH_PROFILE_MERGE_PRESERVED_LOCAVA_IDENTITY` log without leaking the actual
 * stored handle / username / email values.
 */
export function summarizeLocavaIdentityPresence(
  existingDoc: Record<string, unknown> | null | undefined
): {
  hadExistingUsername: boolean;
  hadExistingHandle: boolean;
  hadExistingDisplayName: boolean;
  hadExistingProfilePic: boolean;
} {
  if (!existingDoc) {
    return {
      hadExistingUsername: false,
      hadExistingHandle: false,
      hadExistingDisplayName: false,
      hadExistingProfilePic: false
    };
  }
  const hasMeaningful = (field: string): boolean => isMeaningfulValue(existingDoc[field]);
  const hadExistingHandle =
    hasMeaningful("handle") || hasMeaningful("userHandle") || hasMeaningful("searchHandle");
  const hadExistingUsername =
    hadExistingHandle || hasMeaningful("username") || hasMeaningful("userName") || hasMeaningful("displayUsername");
  const hadExistingDisplayName =
    hasMeaningful("name") || hasMeaningful("displayName") || hasMeaningful("publicName") || hasMeaningful("searchName");
  const hadExistingProfilePic =
    hasMeaningful("profilePic") ||
    hasMeaningful("profilePicture") ||
    hasMeaningful("photoURL") ||
    hasMeaningful("photo") ||
    hasMeaningful("avatarUrl");
  return {
    hadExistingUsername,
    hadExistingHandle,
    hadExistingDisplayName,
    hadExistingProfilePic
  };
}

/** Subset of PROTECTED_PROFILE_FIELDS that represent Locava username/handle aliases. */
export const PROTECTED_LOCAVA_USERNAME_HANDLE_FIELDS = LOCAVA_USERNAME_HANDLE_FIELDS;
