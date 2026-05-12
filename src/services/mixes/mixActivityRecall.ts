/**
 * Bounded progressive recall for legacy `/v2/mixes/:mixKey/page`.
 * Keeps approved synonym lists small (Firestore array-contains-any max 10 tags).
 */

export const MIX_RECALL_MAX_MERGED_CANDIDATES = 180;
/** Hard cap per Firestore fallback query (approximate doc reads before filtering). */
export const MIX_RECALL_FS_POOL_CAP = 72;

const MAX_FIRESTORE_TAGS = 10;

/** Same normalization as MixesService token matching (singular-ish, lowercase). */
export function normalizeMixActivityToken(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ies$/g, "y")
    .replace(/s$/g, "");
}

/**
 * Tags used in Firestore `activities` array-contains / array-contains-any queries.
 * Keys are normalized primaries (mix filter.activity after trim/lowercase).
 */
const PRIMARY_TO_FIRESTORE_TAGS: Record<string, readonly string[]> = {
  cafe: ["cafe", "cafes", "coffee"],
  cafes: ["cafes", "cafe", "coffee"],
  hiking: ["hiking", "hike", "trail"],
  hike: ["hiking", "hike", "trail"],
  biking: ["biking", "bike", "cycling"],
  cycling: ["cycling", "biking", "bike"],
  beach: ["beach", "ocean"],
  park: ["park", "parks"],
  swimming: ["swimming", "swim"],
  sunset: ["sunset", "sunrise", "view"],
  food: ["food", "restaurant", "restaurants"],
  brunch: ["brunch", "food", "restaurant"],
};

/**
 * Normalized tokens used when matching posts already in the warm pool (intersection with postActivityTokens).
 */
const PRIMARY_EXTRA_MATCH_TOKENS: Record<string, readonly string[]> = {
  cafe: ["coffee shop"],
  cafes: ["coffee shop"],
};

export function approvedFirestoreTagsForRecall(primaryRaw: string): string[] {
  const key = String(primaryRaw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const group = PRIMARY_TO_FIRESTORE_TAGS[key] ?? PRIMARY_TO_FIRESTORE_TAGS[normalizeMixActivityToken(key)];
  const raw = group ?? [String(primaryRaw ?? "").trim().toLowerCase()].filter(Boolean);
  const out = [...new Set(raw.map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean))];
  return out.slice(0, MAX_FIRESTORE_TAGS);
}

/** Token set for permissive pool-side matching (synonyms / approved phrases). */
export function approvedActivityMatchSet(primaryRaw: string): Set<string> {
  const tags = approvedFirestoreTagsForRecall(primaryRaw);
  const set = new Set<string>();
  for (const t of tags) {
    set.add(normalizeMixActivityToken(t));
    set.add(t.trim().toLowerCase());
  }
  const key = String(primaryRaw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const extras = PRIMARY_EXTRA_MATCH_TOKENS[key] ?? PRIMARY_EXTRA_MATCH_TOKENS[normalizeMixActivityToken(key)];
  if (extras) {
    for (const x of extras) {
      set.add(normalizeMixActivityToken(x));
      set.add(String(x).trim().toLowerCase());
    }
  }
  set.add(normalizeMixActivityToken(primaryRaw));
  return set;
}

/**
 * Progressive radius ladder for geo mixes (kilometers). Starts at the requested radius,
 * then expands by fixed mile steps up to the global server cap.
 */
export function geoRadiusRecallLadderKm(requestedKm: number, maxKm: number): number[] {
  const cap = Math.min(maxKm, Math.max(requestedKm, 1e-6));
  const milesSteps = [10, 25, 50, 100].map((mi) => mi * 1.609344);
  const steps = [requestedKm, ...milesSteps, maxKm];
  const uniq = [...new Set(steps.filter((k) => Number.isFinite(k) && k > 0).map((k) => Math.min(maxKm, k)))].sort(
    (a, b) => a - b,
  );
  return uniq;
}
