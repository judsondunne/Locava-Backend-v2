/**
 * Search Home v1 activity rails — **native-only** membership (Locava-Native ACTIVITY_OPTIONS).
 * Sync list with: Locava-Native/src/features/post/activitiesOptions.ts
 *
 * Each rail uses one real picker activity from the native app; query + projection share the same tag set.
 */

export const NATIVE_ACTIVITY_OPTIONS = [
  "park",
  "bench",
  "graveyards",
  "swimming",
  "bridges",
  "restaurants",
  "abandoned",
  "hiking",
  "ocean",
  "shopping",
  "rockformations",
  "cave",
  "market",
  "ruins",
  "kayaking",
  "weird",
  "beach",
  "view",
  "sunset",
  "cafe",
  "train",
  "ropeswing",
  "hockey",
  "surfing",
  "snowmobiling",
  "animals",
  "spa",
  "jetski",
  "soccer",
  "basketball",
  "monuments",
  "gondola",
  "rv",
  "bowling",
  "skating",
  "rollerblading",
  "shippingyard",
  "boxing",
  "fountain",
  "hotairballon",
  "sailing",
  "lighthouse",
  "river",
  "sculptures",
  "applepicking",
  "mural",
  "waterfall",
  "playground",
  "war",
  "garden",
  "swimminghole",
  "diving",
  "golfing",
  "skiing",
  "castle",
  "stargazing",
  "biking",
  "farm",
  "lifting",
  "museum",
  "offroading",
  "tower",
  "historical",
  "walking",
  "nationalpark",
  "forest",
  "mountain",
  "pond",
  "lake",
  "riding",
  "desert",
  "skateboarding",
  "climbing",
  "tropical",
  "fishing",
  "fireworks",
  "random",
  "archery",
  "fair",
  "amusementpark",
  "pizza",
  "chinesefood",
  "movies",
  "quarries",
  "pier",
] as const;

export type NativeActivityOption = (typeof NATIVE_ACTIVITY_OPTIONS)[number];

const NATIVE_ACTIVITY_OPTION_SET = new Set<string>(NATIVE_ACTIVITY_OPTIONS);

/** Mirrors Locava-Native `normalizeActivityId` + plural UI tokens → native slug. */
export function normalizeActivityTagForSearchHome(activity: string | null | undefined): string {
  if (!activity) return "";
  const lower = activity.trim().toLowerCase();
  if (!lower) return "";
  const aliases: Record<string, string> = {
    resturants: "restaurants",
    resturant: "restaurants",
    restaraunt: "restaurants",
    restaraunts: "restaurants",
    "off-roading": "offroading",
    "star-gazing": "stargazing",
    "scuba diving": "diving",
    "cave exploring": "cave",
    "national park": "nationalpark",
    "hot air balloon": "hotairballon",
    "swimming hole": "swimminghole",
    views: "view",
    castles: "castle",
    parks: "park",
    graveyard: "graveyards",
    cemetery: "graveyards",
    cemeteries: "graveyards",
    lakes: "lake",
    beaches: "beach",
    waterfalls: "waterfall",
  };
  if (aliases[lower]) return aliases[lower];
  return lower.replace(/[^a-z0-9]+/g, "");
}

export function isNativeActivityOption(tag: string): boolean {
  const n = normalizeActivityTagForSearchHome(tag);
  return n.length > 0 && NATIVE_ACTIVITY_OPTION_SET.has(n);
}

/** Eight first-paint rails — Locava-Native `ACTIVITY_OPTIONS` ids. */
export const SEARCH_HOME_V1_ACTIVITY_KEYS = [
  "biking",
  "hiking",
  "castle",
  "park",
  "swimming",
  "beach",
  "view",
  "waterfall",
] as const;

export type SearchHomeV1ActivityKey = (typeof SEARCH_HOME_V1_ACTIVITY_KEYS)[number];

export const SEARCH_HOME_V1_ACTIVITY_MEMBERS: Record<SearchHomeV1ActivityKey, readonly string[]> = {
  biking: ["biking"],
  hiking: ["hiking"],
  castle: ["castle"],
  park: ["park"],
  swimming: ["swimming"],
  beach: ["beach"],
  view: ["view"],
  waterfall: ["waterfall"],
};

for (const key of SEARCH_HOME_V1_ACTIVITY_KEYS) {
  const members = SEARCH_HOME_V1_ACTIVITY_MEMBERS[key];
  if (members.length > 10) {
    throw new Error(`search_home_v1: activity "${key}" exceeds Firestore array-contains-any limit (${members.length})`);
  }
  for (const m of members) {
    if (!NATIVE_ACTIVITY_OPTION_SET.has(m)) {
      throw new Error(`search_home_v1: activity "${key}" member "${m}" is not in NATIVE_ACTIVITY_OPTIONS`);
    }
  }
}

/** Legacy URL / cached keys → canonical rail (native slug). */
const LEGACY_SEARCH_HOME_ACTIVITY_KEY: Record<string, SearchHomeV1ActivityKey> = {
  castles: "castle",
  parks: "park",
  beaches: "beach",
  waterfalls: "waterfall",
  views: "view",
};

export const SEARCH_HOME_V1_MIX_DISPLAY_TITLE: Record<SearchHomeV1ActivityKey, string> = {
  biking: "Biking",
  hiking: "Hiking",
  castle: "Castles",
  park: "Parks",
  swimming: "Swimming",
  beach: "Beach",
  view: "Views",
  waterfall: "Waterfalls",
};

export function resolveSearchHomeV1MixCanonicalKey(activityKeyRaw: string): SearchHomeV1ActivityKey | null {
  let k = String(activityKeyRaw ?? "").trim().toLowerCase();
  if (k.startsWith("activity:")) k = k.slice("activity:".length).trim();
  if ((SEARCH_HOME_V1_ACTIVITY_KEYS as readonly string[]).includes(k)) return k as SearchHomeV1ActivityKey;
  return LEGACY_SEARCH_HOME_ACTIVITY_KEY[k] ?? null;
}

/** Tags to query in Firestore (`array-contains` or `array-contains-any`). */
export function resolveSearchHomeV1ActivityAliases(activityKeyRaw: string): readonly string[] {
  const canonical = resolveSearchHomeV1MixCanonicalKey(activityKeyRaw);
  if (canonical) return SEARCH_HOME_V1_ACTIVITY_MEMBERS[canonical];
  let k = String(activityKeyRaw ?? "").trim().toLowerCase();
  if (k.startsWith("activity:")) k = k.slice("activity:".length).trim();
  const n = normalizeActivityTagForSearchHome(k);
  if (n && NATIVE_ACTIVITY_OPTION_SET.has(n)) return [n];
  return [];
}

/** Allowed normalized tags for projection filtering (same as query membership). */
export function membershipNormalizedSetForSearchHomeMix(activityKeyRaw: string): Set<string> {
  return new Set(resolveSearchHomeV1ActivityAliases(activityKeyRaw).map((t) => normalizeActivityTagForSearchHome(t)));
}
