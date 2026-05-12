export type FastTargetedTierBias = "A" | "B";

export type WikidataFastTargetedBucket = {
  bucketId: string;
  label: string;
  priority: number;
  targetQids: string[];
  perBucketLimit: number;
  tierBias: FastTargetedTierBias;
  categoryHints: string[];
};

export const FAST_TARGETED_BUCKET_CONCURRENCY = 4;

const DEFAULT_PER_BUCKET_LIMIT = 12;

export const WIKIDATA_FAST_TARGETED_BUCKETS: WikidataFastTargetedBucket[] = [
  {
    bucketId: "waterfall",
    label: "waterfall",
    priority: 1,
    targetQids: ["Q46169"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["waterfall"],
  },
  {
    bucketId: "cave",
    label: "cave",
    priority: 2,
    targetQids: ["Q34038"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["cave"],
  },
  {
    bucketId: "beach",
    label: "beach",
    priority: 3,
    targetQids: ["Q40080"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["beach"],
  },
  {
    bucketId: "park_protected_area",
    label: "park/protected area",
    priority: 4,
    targetQids: ["Q8502", "Q12280", "Q3497767"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["park", "nature reserve", "protected area"],
  },
  {
    bucketId: "trail",
    label: "trail",
    priority: 5,
    targetQids: ["Q628179"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["hiking trail", "trail"],
  },
  {
    bucketId: "lake",
    label: "lake",
    priority: 6,
    targetQids: ["Q23397"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["lake"],
  },
  {
    bucketId: "mountain_summit",
    label: "mountain/summit",
    priority: 7,
    targetQids: ["Q4022", "Q4989906"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["mountain", "summit"],
  },
  {
    bucketId: "gorge",
    label: "gorge",
    priority: 8,
    targetQids: ["Q133056"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["gorge"],
  },
  {
    bucketId: "quarry",
    label: "quarry",
    priority: 9,
    targetQids: ["Q39614"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["quarry"],
  },
  {
    bucketId: "lighthouse",
    label: "lighthouse",
    priority: 10,
    targetQids: ["Q207386"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["lighthouse"],
  },
  {
    bucketId: "castle_ruins",
    label: "castle/ruins",
    priority: 11,
    targetQids: ["Q23413", "Q839954", "Q109607"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["castle", "ruins", "archaeological site"],
  },
  {
    bucketId: "viewpoint",
    label: "scenic viewpoint",
    priority: 12,
    targetQids: ["Q570116"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["scenic viewpoint", "viewpoint"],
  },
  {
    bucketId: "island",
    label: "island",
    priority: 13,
    targetQids: ["Q23442"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "A",
    categoryHints: ["island"],
  },
  {
    bucketId: "garden",
    label: "garden",
    priority: 14,
    targetQids: ["Q7075", "Q1508374"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "B",
    categoryHints: ["garden", "arboretum"],
  },
  {
    bucketId: "museum",
    label: "museum",
    priority: 15,
    targetQids: ["Q33506"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "B",
    categoryHints: ["museum"],
  },
  {
    bucketId: "public_art",
    label: "public art",
    priority: 16,
    targetQids: ["Q860738", "Q24104689"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "B",
    categoryHints: ["public art", "sculpture"],
  },
  {
    bucketId: "historic_site",
    label: "historic site",
    priority: 17,
    targetQids: ["Q179049"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "B",
    categoryHints: ["historic site"],
  },
  {
    bucketId: "covered_bridge",
    label: "covered bridge",
    priority: 18,
    targetQids: ["Q1825472"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "B",
    categoryHints: ["covered bridge"],
  },
  {
    bucketId: "tourist_attraction",
    label: "tourist attraction",
    priority: 19,
    targetQids: ["Q2267495"],
    perBucketLimit: DEFAULT_PER_BUCKET_LIMIT,
    tierBias: "B",
    categoryHints: ["tourist attraction", "landmark"],
  },
];

export const FAST_TARGETED_EXCLUDED_CATEGORY_HINTS = [
  "library",
  "memorial",
  "cemetery",
  "house",
  "building",
  "architecture",
  "city hall",
  "town hall",
  "courthouse",
];

export function listFastTargetedBucketIds(): string[] {
  return WIKIDATA_FAST_TARGETED_BUCKETS.map((bucket) => bucket.bucketId);
}
