/**
 * Activity/category → emoji for map-layer markers. Keep in sync with Locava-Native activityEmojiMap.ts.
 */
export const DEFAULT_MAP_LAYER_EMOJI = "📍";

const GENERIC_ACTIVITY_KEYS = new Set([
  "hiking",
  "trail",
  "trails",
  "walking",
  "walk",
  "route",
  "explore",
  "outdoor",
  "outdoors",
  "nature",
  "path",
]);

const EXACT_ACTIVITY_EMOJI: Record<string, string> = {
  beach: "🏖️",
  swimming: "🏊",
  swimminghole: "🏊",
  "swimming hole": "🏊",
  waterfall: "💦",
  waterfalls: "💦",
  hiking: "🥾",
  trail: "🥾",
  view: "🌄",
  viewpoint: "🌄",
  overlook: "🌄",
  scenic: "🌄",
  park: "🌳",
  nationalpark: "🌳",
  picnic: "🧺",
  camping: "⛺",
  campground: "⛺",
  biking: "🚴",
  "mountain biking": "🚵",
  offroading: "🛻",
  walking: "🚶",
  running: "🏃",
  skiing: "🎿",
  fishing: "🎣",
  boating: "🚤",
  kayaking: "🛶",
  climbing: "🧗",
  historical: "🏛️",
  historic: "🏛️",
  ruins: "🏚️",
  castle: "🏰",
  coffee: "☕",
  cafe: "☕",
  food: "🍽️",
  restaurant: "🍽️",
  sunset: "🌅",
  sunrise: "🌅",
  garden: "🌷",
  museum: "🏛️",
  lake: "🌊",
  river: "🏞️",
  pond: "🌊",
  ocean: "🌊",
  mountain: "⛰️",
  cave: "🕳️",
  forest: "🌲",
  wetland: "🦆",
  marsh: "🌿",
  spring: "💧",
  hot_spring: "♨️",
  peak: "⛰️",
  summit: "⛰️",
  lighthouse: "🗼",
  bridge: "🌉",
  dam: "🏗️",
  reservoir: "🌊",
  wildlife: "🦌",
  bird: "🐦",
  beach_access: "🏖️",
  swimming_area: "🏊",
  picnic_site: "🧺",
  camp_site: "⛺",
  attraction: "📍",
  artwork: "🎨",
  monument: "🗿",
  memorial: "🪦",
  archaeological_site: "🏛️",
  gorge: "🏞️",
  valley: "🏞️",
  bay: "🌊",
  island: "🏝️",
  peninsula: "🏝️",
  cliff: "🪨",
  rock: "🪨",
  glacier: "🧊",
  ski: "🎿",
  sled: "🛷",
  horse: "🐎",
  golf: "⛳",
  surf: "🏄",
  dive: "🤿",
  snorkel: "🤿",
};

const SUBSTRING_ACTIVITY_EMOJI: Array<[string, string]> = [
  ["waterfall", "💦"],
  ["swimming", "🏊"],
  ["beach", "🏖️"],
  ["wetland", "🦆"],
  ["marsh", "🌿"],
  ["spring", "💧"],
  ["summit", "⛰️"],
  ["peak", "⛰️"],
  ["view", "🌄"],
  ["scenic", "🌄"],
  ["overlook", "🌄"],
  ["camp", "⛺"],
  ["picnic", "🧺"],
  ["offroad", "🛻"],
  ["class 4", "🛻"],
  ["bike", "🚴"],
  ["cycl", "🚴"],
  ["kayak", "🛶"],
  ["canoe", "🛶"],
  ["fish", "🎣"],
  ["boat", "🚤"],
  ["climb", "🧗"],
  ["historic", "🏛️"],
  ["museum", "🏛️"],
  ["castle", "🏰"],
  ["ruin", "🏚️"],
  ["coffee", "☕"],
  ["cafe", "☕"],
  ["restaurant", "🍽️"],
  ["lake", "🌊"],
  ["river", "🏞️"],
  ["pond", "🌊"],
  ["reservoir", "🌊"],
  ["ocean", "🌊"],
  ["cave", "🕳️"],
  ["forest", "🌲"],
  ["lighthouse", "🗼"],
  ["bridge", "🌉"],
  ["island", "🏝️"],
  ["wildlife", "🦌"],
  ["ski", "🎿"],
  ["surf", "🏄"],
  ["golf", "⛳"],
  ["hik", "🥾"],
  ["trail", "🥾"],
];

function normalizeActivityKey(activity: string): string {
  return activity.trim().toLowerCase().replace(/\s+/g, " ");
}

function singularizeActivityKey(key: string): string {
  if (key.endsWith("ies") && key.length > 4) return `${key.slice(0, -3)}y`;
  if (key.endsWith("s") && key.length > 3 && !key.endsWith("ss")) return key.slice(0, -1);
  return key;
}

export function getMapLayerActivityEmoji(activity: string | undefined | null): string {
  const raw = typeof activity === "string" ? activity.trim() : "";
  if (!raw) return DEFAULT_MAP_LAYER_EMOJI;

  const key = normalizeActivityKey(raw);
  const compact = key.replace(/\s+/g, "");
  const singular = singularizeActivityKey(compact);

  if (EXACT_ACTIVITY_EMOJI[key]) return EXACT_ACTIVITY_EMOJI[key];
  if (EXACT_ACTIVITY_EMOJI[compact]) return EXACT_ACTIVITY_EMOJI[compact];
  if (EXACT_ACTIVITY_EMOJI[singular]) return EXACT_ACTIVITY_EMOJI[singular];

  for (const [needle, emoji] of SUBSTRING_ACTIVITY_EMOJI) {
    if (key.includes(needle) || compact.includes(needle)) return emoji;
  }

  return DEFAULT_MAP_LAYER_EMOJI;
}

function isGenericActivityKey(key: string): boolean {
  const n = normalizeActivityKey(key).replace(/\s+/g, "");
  return GENERIC_ACTIVITY_KEYS.has(n) || GENERIC_ACTIVITY_KEYS.has(singularizeActivityKey(n));
}

/** Prefer category/OSM-specific labels before generic hiking/trail primaryActivity. */
export function resolveMapLayerEmoji(candidates: Array<string | null | undefined>): string {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    ordered.push(t);
  }
  const specific = ordered.filter((c) => !isGenericActivityKey(c));
  const generic = ordered.filter((c) => isGenericActivityKey(c));
  for (const label of [...specific, ...generic]) {
    const emoji = getMapLayerActivityEmoji(label);
    if (emoji !== DEFAULT_MAP_LAYER_EMOJI) return emoji;
  }
  return getMapLayerActivityEmoji(ordered[0]);
}

export function emojiCandidatesFromDoc(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof data.category === "string") out.push(data.category);
  const tags =
    (data.source as { tags?: Record<string, string> } | undefined)?.tags ??
    (data.sourceTags as Record<string, string> | undefined);
  if (tags && typeof tags === "object") {
    for (const key of ["natural", "waterway", "leisure", "tourism", "historic", "amenity", "landuse"]) {
      const v = tags[key];
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
  }
  if (typeof data.primaryActivity === "string") out.push(data.primaryActivity);
  const activities = data.activities;
  if (Array.isArray(activities)) {
    for (const a of activities) {
      if (typeof a === "string" && a.trim()) out.push(a.trim());
    }
  }
  return out;
}
