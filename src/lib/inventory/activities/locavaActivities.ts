/**
 * Canonical Locava inventory activity taxonomy + aliases.
 */

export const LOCAVA_ACTIVITIES = [
  "things",
  "biking",
  "diving",
  "castle",
  "golfing",
  "park",
  "rockformations",
  "war",
  "ocean",
  "restaurants",
  "swimming",
  "beach",
  "view",
  "cafe",
  "train",
  "tower",
  "historical",
  "walking",
  "nationalpark",
  "forest",
  "spa",
  "animals",
  "mountain",
  "swimminghole",
  "pond",
  "garden",
  "skiing",
  "stargazing",
  "farm",
  "lifting",
  "museum",
  "offroading",
  "riding",
  "desert",
  "skateboarding",
  "island",
  "climbing",
  "tropical",
  "fishing",
  "fireworks",
  "abandoned",
  "hiking",
  "random",
  "sunset",
  "ropeswing",
  "archery",
  "kayaking",
  "hockey",
  "surfing",
  "snowmobiling",
  "jetski",
  "soccer",
  "basketball",
  "shopping",
  "monuments",
  "gondola",
  "rv",
  "bowling",
  "skating",
  "rollerblading",
  "cave",
  "shippingyard",
  "boxing",
  "fountain",
  "hotairballoon",
  "sailing",
  "lighthouse",
  "river",
  "sculptures",
  "applepicking",
  "mural",
  "ruins",
  "bridge",
  "weird",
  "waterfall",
  "playground",
  "burger",
  "fair",
  "amusementpark",
  "pizza",
  "farmersmarket",
  "chinesefood",
  "movies",
  "quarries",
  "gunrange",
  "pier",
  "trail",
  "trailhead",
  "camping",
  "picnic",
  "brewery",
  "bar",
  "icecream",
  "coffee",
  "bakery",
  "breakfast",
  "diner",
  "foodtrucks",
  "market",
  "water",
  "lake",
  "wateraccess",
  "boating",
  "canoeing",
  "paddleboarding",
  "waterpark",
  "waterfront",
  "dam",
  "coveredbridge",
  "overlook",
  "ledge",
  "peak",
  "hill",
  "lookout",
  "wildlife",
  "birdwatching",
  "nature",
  "conservation",
  "recreationarea",
  "campground",
  "historicpark",
  "historicbuilding",
  "cemetery",
  "memorial",
  "theater",
  "art",
  "gallery",
  "library",
  "farmstand",
  "orchard",
  "vineyard",
  "winery",
  "distillery",
  "maplesugar",
  "skiingnordic",
  "snowshoeing",
  "mtb",
  "boardwalk",
  "scenicdrive",
  "unmaintainedroad",
  "atv",
  "class4road",
  "legaltrail",
  "statepark",
  "townpark",
  "dogfriendly",
  "familyfriendly",
  "accessible",
  "seasonal",
  "hidden",
  "localfavorite",
] as const;

export type LocavaActivity = (typeof LOCAVA_ACTIVITIES)[number];

const CANONICAL_SET = new Set<string>(LOCAVA_ACTIVITIES);

/** Maps alias / legacy slug → canonical activity */
export const LOCAVA_ACTIVITY_ALIASES: Record<string, LocavaActivity> = {
  hotairballon: "hotairballoon",
  hot_air_balloon: "hotairballoon",
  ice_cream: "icecream",
  icecream: "icecream",
  farmers_market: "farmersmarket",
  farmersmarket: "farmersmarket",
  marketplace: "farmersmarket",
  viewpoint: "view",
  vista: "view",
  scenic: "view",
  overlook: "overlook",
  lookout: "lookout",
  nature_reserve: "nature",
  protected_area: "conservation",
  woodland: "forest",
  wood: "forest",
  peak: "peak",
  hill: "hill",
  mountain: "mountain",
  swim: "swimming",
  swimming_area: "swimming",
  swimming_hole: "swimminghole",
  swimminghole: "swimminghole",
  class4: "class4road",
  class_4: "class4road",
  class_iv: "class4road",
  legal_trail: "legaltrail",
  unmaintained_road: "unmaintainedroad",
  off_road: "offroading",
  offroad: "offroading",
  ohv: "atv",
  fourwheel: "offroading",
  "4wd": "offroading",
  mtb: "mtb",
  cycleway: "biking",
  bicycle: "biking",
  footway: "walking",
  path: "trail",
  foot: "hiking",
  nordic: "skiingnordic",
  snowshoe: "snowshoeing",
  pub: "bar",
  fast_food: "restaurants",
  restaurant: "restaurants",
  chinese: "chinesefood",
  burger: "burger",
  pizza: "pizza",
  brewery: "brewery",
  brewing: "brewery",
  cafe: "cafe",
  coffee: "coffee",
  museum: "museum",
  historic: "historical",
  heritage: "historical",
  monument: "monuments",
  memorial: "memorial",
  ruins: "ruins",
  castle: "castle",
  artwork: "sculptures",
  mural: "mural",
  art: "art",
  quarry: "quarries",
  bare_rock: "rockformations",
  cliff: "climbing",
  cave: "cave",
  wetland: "nature",
  marsh: "nature",
  bog: "nature",
  waterfall: "waterfall",
  falls: "waterfall",
  pier: "pier",
  marina: "pier",
  dock: "boating",
  lighthouse: "lighthouse",
  bridge: "bridge",
  covered_bridge: "coveredbridge",
  railroad_bridge: "bridge",
  train: "train",
  railway: "train",
  golf: "golfing",
  playground: "playground",
  skatepark: "skateboarding",
  gun_range: "gunrange",
  gunrange: "gunrange",
  cinema: "movies",
  theatre: "theater",
  theater: "theater",
  amusement_park: "amusementpark",
  fair: "fair",
  orchard: "orchard",
  apple: "applepicking",
  farmstand: "farmstand",
  vineyard: "vineyard",
  winery: "winery",
  distillery: "distillery",
  maple: "maplesugar",
  sugarhouse: "maplesugar",
  food: "restaurants",
  scenic_view: "view",
  natural_feature: "nature",
  national_park: "nationalpark",
  state_park: "statepark",
  town_park: "townpark",
  recreation_area: "recreationarea",
  campground: "campground",
  camping: "camping",
  picnic_site: "picnic",
  trailhead: "trailhead",
  boardwalk: "boardwalk",
  ropeswing: "ropeswing",
  weird: "weird",
  things: "things",
  random: "random",
  local_favorite: "localfavorite",
  dog_friendly: "dogfriendly",
  family_friendly: "familyfriendly",
  water_access: "wateraccess",
  waterpark: "waterpark",
  waterfront: "waterfront",
  paddleboard: "paddleboarding",
  sup: "paddleboarding",
  canoe: "canoeing",
  kayak: "kayaking",
  birdwatching: "birdwatching",
  wildlife: "wildlife",
  animals: "animals",
  zoo: "animals",
  stargazing: "stargazing",
  sunset: "sunset",
  ledge: "ledge",
  abandoned: "abandoned",
  disused: "abandoned",
  hiking: "hiking",
  walking: "walking",
  trail: "trail",
  offroading: "offroading",
};

export function normalizeActivity(input: string | null | undefined): LocavaActivity | null {
  if (!input?.trim()) return null;
  const raw = input.trim().toLowerCase().replace(/\s+/g, "").replace(/-/g, "_");
  const compact = raw.replace(/_/g, "");
  if (CANONICAL_SET.has(compact)) return compact as LocavaActivity;
  if (CANONICAL_SET.has(raw)) return raw as LocavaActivity;
  const aliased = LOCAVA_ACTIVITY_ALIASES[raw] ?? LOCAVA_ACTIVITY_ALIASES[compact];
  if (aliased) return aliased;
  return null;
}

export function isLocavaActivity(input: string | null | undefined): input is LocavaActivity {
  return normalizeActivity(input) != null;
}

export function dedupeActivities(activities: string[]): LocavaActivity[] {
  const out: LocavaActivity[] = [];
  const seen = new Set<string>();
  for (const a of activities) {
    const norm = normalizeActivity(a);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export type ActivityWeightMap = Record<string, number>;

export function rankActivities(weights: ActivityWeightMap): LocavaActivity[] {
  return Object.entries(weights)
    .map(([activity, weight]) => ({ activity: normalizeActivity(activity), weight }))
    .filter((e): e is { activity: LocavaActivity; weight: number } => e.activity != null && e.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((e) => e.activity);
}

export function pickPrimaryActivity(weights: ActivityWeightMap, hints?: { routeActivity?: string; category?: string }): LocavaActivity | null {
  const ranked = rankActivities(weights);
  if (!ranked.length) return null;

  const topWeight = weights[ranked[0]!] ?? 0;
  const topTier = ranked.filter((a) => (weights[a] ?? 0) >= topWeight - 1);

  const priorityGroups: LocavaActivity[][] = [
    ["offroading"],
    ["coveredbridge"],
    ["waterfall"],
    ["swimming", "beach", "swimminghole"],
    ["view", "overlook", "lookout", "sunset"],
    ["hiking", "trail", "trailhead"],
    ["mtb", "biking"],
    ["cafe", "coffee"],
    ["icecream"],
    ["restaurants", "burger", "pizza", "chinesefood"],
    ["brewery", "bar"],
    ["museum", "historical", "castle", "monuments"],
    ["bridge"],
    ["quarries", "rockformations"],
    ["lighthouse", "pier", "campground", "camping", "picnic"],
    ["weird", "things"],
    ["mountain", "peak", "hill"],
    ["park", "forest", "conservation", "nationalpark", "statepark", "recreationarea"],
    ["nature"],
  ];

  for (const group of priorityGroups) {
    for (const g of group) {
      if (topTier.includes(g)) return g;
    }
  }

  if (hints?.routeActivity) {
    const fromRoute = normalizeActivity(hints.routeActivity);
    if (fromRoute && topTier.includes(fromRoute)) return fromRoute;
  }

  return ranked[0] ?? null;
}

export const ACTIVITY_SEARCH_SYNONYMS: Record<string, string[]> = {
  view: ["overlook", "vista", "lookout", "scenic view", "sunset spot"],
  sunset: ["golden hour", "sunset view", "evening view"],
  swimming: ["swim", "swimming area", "bathing"],
  swimminghole: ["swimming hole", "swim hole", "river swim"],
  beach: ["beach area", "sand", "shore"],
  offroading: ["off road", "4x4", "atv", "ohv", "class 4", "class iv", "unmaintained road"],
  unmaintainedroad: ["unmaintained road", "class 4", "town highway"],
  class4road: ["class 4", "class iv", "class four"],
  legaltrail: ["legal trail", "aotclass 7"],
  hiking: ["hike", "trail", "footpath", "walking trail"],
  forest: ["woods", "woodland", "trees"],
  waterfall: ["falls", "cascade", "cataract"],
  icecream: ["ice cream", "creamery", "gelato"],
  farmersmarket: ["farmers market", "market", "marketplace"],
  historical: ["historic", "heritage", "history"],
  museum: ["exhibit", "gallery"],
  quarry: ["quarries", "rock quarry"],
  cafe: ["coffee shop", "coffee", "espresso"],
};

export function expandActivitySearchAliases(activities: LocavaActivity[]): string[] {
  const out = new Set<string>();
  for (const a of activities) {
    out.add(a);
    for (const syn of ACTIVITY_SEARCH_SYNONYMS[a] ?? []) out.add(syn);
  }
  return [...out];
}
