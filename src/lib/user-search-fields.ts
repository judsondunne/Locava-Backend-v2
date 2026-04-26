/**
 * Normalized Firestore fields for indexed user search (`searchHandle`, `searchName`).
 * Used by backfill, internal ops, and any server-side user doc writes.
 */

/** Collapse internal ASCII/Unicode whitespace runs to a single space; trim ends. */
export function collapseWhitespace(input: string): string {
  return input.trim().replace(/\s+/gu, " ");
}

/**
 * Normalize handle for search: strip leading @, trim, collapse whitespace, lowercase.
 * Underscores and digits are preserved. Returns null if there is no usable handle string.
 */
export function normalizeSearchHandleFromRaw(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(/^@+/u, "");
  const collapsed = collapseWhitespace(stripped);
  if (collapsed.length === 0) return null;
  return collapsed.toLowerCase();
}

/**
 * Normalize display name for search: trim, collapse whitespace, lowercase.
 * Returns null if there is no usable name string.
 */
export function normalizeSearchNameFromRaw(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = collapseWhitespace(raw);
  if (collapsed.length === 0) return null;
  return collapsed.toLowerCase();
}

export type UserSearchFieldsSummaryFlags = {
  /** No non-empty normalized handle (missing or whitespace-only). */
  missingHandle: boolean;
  /** No non-empty normalized name (missing or whitespace-only). */
  missingName: boolean;
};

export type ExpectedSearchFields = {
  searchHandle: string | undefined;
  searchName: string | undefined;
} & UserSearchFieldsSummaryFlags;

/**
 * Derive expected search* fields from canonical user fields.
 * Does not invent values when source fields are absent or empty.
 */
export function deriveExpectedSearchFields(docData: Record<string, unknown>): ExpectedSearchFields {
  const searchHandle = normalizeSearchHandleFromRaw(docData.handle);
  const searchName = normalizeSearchNameFromRaw(docData.name);
  return {
    searchHandle: searchHandle ?? undefined,
    searchName: searchName ?? undefined,
    missingHandle: searchHandle === null,
    missingName: searchName === null
  };
}

export type SearchFieldPatch = {
  searchHandle?: string;
  searchName?: string;
};

/**
 * Compute which search* keys must be written so stored values match normalized sources.
 * Omits keys when no update is needed or when the source field cannot be derived.
 */
export function computeSearchFieldPatch(
  docData: Record<string, unknown>,
  expected?: ExpectedSearchFields
): SearchFieldPatch | null {
  const exp = expected ?? deriveExpectedSearchFields(docData);
  const patch: SearchFieldPatch = {};

  const existingHandle = docData.searchHandle;
  const existingName = docData.searchName;

  if (exp.searchHandle !== undefined) {
    if (existingHandle !== exp.searchHandle) {
      patch.searchHandle = exp.searchHandle;
    }
  }

  if (exp.searchName !== undefined) {
    if (existingName !== exp.searchName) {
      patch.searchName = exp.searchName;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Merge canonical handle/name on an outgoing user write payload with derived search fields.
 * Call from any Firestore `.set` / `.update` that touches `handle` or `name`.
 */
export function mergeSearchFieldsIntoUserWritePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const derived = deriveExpectedSearchFields(payload);
  const next: Record<string, unknown> = { ...payload };
  if (derived.searchHandle !== undefined) {
    next.searchHandle = derived.searchHandle;
  }
  if (derived.searchName !== undefined) {
    next.searchName = derived.searchName;
  }
  return next;
}
