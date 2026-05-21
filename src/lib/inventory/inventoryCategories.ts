export const INVENTORY_SPOT_CATEGORIES = [
  "viewpoint",
  "trailhead",
  "park",
  "waterfall",
  "beach",
  "lake",
  "river",
  "swimming",
  "campground",
  "picnic_area",
  "historic",
  "ruins",
  "castle",
  "attraction",
  "museum",
  "cafe",
  "coffee",
  "scenic",
  "natural_feature",
] as const;

export const INVENTORY_ROUTE_CATEGORIES = ["hiking", "walking", "running", "biking", "trail"] as const;

const SPOT_TAG_MAP: Record<string, string> = {
  viewpoint: "viewpoint",
  "view point": "viewpoint",
  peak: "viewpoint",
  summit: "viewpoint",
  trailhead: "trailhead",
  "trail head": "trailhead",
  park: "park",
  national_park: "park",
  state_park: "park",
  waterfall: "waterfall",
  falls: "waterfall",
  beach: "beach",
  lake: "lake",
  pond: "lake",
  reservoir: "lake",
  river: "river",
  stream: "river",
  swimming: "swimming",
  "swimming hole": "swimming",
  campground: "campground",
  camp_site: "campground",
  picnic: "picnic_area",
  picnic_site: "picnic_area",
  historic: "historic",
  ruins: "ruins",
  castle: "castle",
  attraction: "attraction",
  tourism: "attraction",
  museum: "museum",
  cafe: "cafe",
  coffee: "coffee",
  scenic: "scenic",
  natural: "natural_feature",
  wetland: "natural_feature",
  marsh: "natural_feature",
  protected_area: "park",
  national_historical_park: "historic",
};

const ROUTE_TAG_MAP: Record<string, string> = {
  hiking: "hiking",
  foot: "hiking",
  path: "hiking",
  walking: "walking",
  pedestrian: "walking",
  running: "running",
  biking: "biking",
  bicycle: "biking",
  cycleway: "biking",
  trail: "trail",
};

const CATEGORY_ACTIVITIES: Record<string, string[]> = {
  viewpoint: ["hiking", "scenic"],
  trailhead: ["hiking"],
  park: ["hiking", "walking"],
  waterfall: ["hiking", "scenic"],
  beach: ["swimming", "walking"],
  lake: ["swimming", "hiking"],
  river: ["hiking", "swimming"],
  swimming: ["swimming"],
  campground: ["camping", "hiking"],
  picnic_area: ["picnic", "walking"],
  historic: ["historic", "walking"],
  ruins: ["historic", "hiking"],
  castle: ["historic", "walking"],
  attraction: ["walking"],
  museum: ["walking"],
  cafe: ["food"],
  coffee: ["food"],
  scenic: ["scenic", "hiking"],
  natural_feature: ["hiking", "nature"],
  hiking: ["hiking"],
  walking: ["walking"],
  running: ["running"],
  biking: ["biking"],
  trail: ["hiking", "walking"],
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function mapSpotCategoryFromTags(tags: Record<string, unknown>): {
  category: string;
  categories: string[];
  activities: string[];
} {
  const tokens: string[] = [];
  for (const [key, raw] of Object.entries(tags)) {
    tokens.push(normalizeToken(key));
    if (typeof raw === "string") tokens.push(normalizeToken(raw));
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") tokens.push(normalizeToken(item));
      }
    }
  }

  const categories = new Set<string>();
  for (const token of tokens) {
    const mapped = SPOT_TAG_MAP[token];
    if (mapped) categories.add(mapped);
  }
  if (categories.size === 0) {
    categories.add("natural_feature");
  }

  const primary = [...categories].sort()[0] ?? "natural_feature";
  const activities = new Set<string>();
  for (const cat of categories) {
    for (const act of CATEGORY_ACTIVITIES[cat] ?? []) {
      activities.add(act);
    }
  }
  return {
    category: primary,
    categories: [...categories],
    activities: [...activities],
  };
}

export function mapRouteCategoryFromTags(tags: Record<string, unknown>): {
  activity: "hiking" | "walking" | "running" | "biking" | "other";
  categories: string[];
  activities: string[];
} {
  const tokens: string[] = [];
  for (const [key, raw] of Object.entries(tags)) {
    tokens.push(normalizeToken(key));
    if (typeof raw === "string") tokens.push(normalizeToken(raw));
  }

  const categories = new Set<string>();
  for (const token of tokens) {
    const mapped = ROUTE_TAG_MAP[token];
    if (mapped) categories.add(mapped);
  }
  if (categories.size === 0) categories.add("hiking");

  const primary = [...categories].sort()[0] ?? "hiking";
  const activity =
    primary === "walking" || primary === "running" || primary === "biking" || primary === "hiking"
      ? primary
      : primary === "trail"
        ? "hiking"
        : "other";

  const activities = new Set<string>();
  for (const cat of categories) {
    for (const act of CATEGORY_ACTIVITIES[cat] ?? []) {
      activities.add(act);
    }
  }
  return {
    activity,
    categories: [...categories],
    activities: [...activities],
  };
}

export function isAcceptedSpotCategory(category: string): boolean {
  return (INVENTORY_SPOT_CATEGORIES as readonly string[]).includes(category);
}

export function isAcceptedRouteCategory(category: string): boolean {
  return (INVENTORY_ROUTE_CATEGORIES as readonly string[]).includes(category);
}

export function isStrongSpotCategory(category: string): boolean {
  return ["viewpoint", "waterfall", "trailhead", "park", "historic", "castle", "scenic"].includes(category);
}
