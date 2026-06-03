/**
 * PBF candidate tag filter.
 *
 * Early-filter step that runs before the existing Locava classifier — keeps
 * raw OSM throughput tractable on a national PBF without weakening the
 * classifier itself. The filter only DECIDES which raw objects to send to
 * `classifyOsmFeaturesForLocava`. Rejected objects from the classifier are
 * still discarded downstream the same way they are today.
 *
 * The default policy is the union of:
 *   - tag keys the bbox-Overpass query already pulls (FEATURE_TAG_KEYS)
 *   - offroad / access / surface keys offroad classifiers care about
 *   - identifier/metadata keys we want to preserve (name, ref, wikidata,
 *     wikipedia, mapillary, image, website, opening_hours, operator, fee)
 *
 * Anything matching is forwarded; anything not matching is dropped as
 * non-Locava (cheap, conservative pre-filter — never the final decision).
 */

export type PbfTagFilterPolicy = {
  /** Tag keys whose presence alone makes the object a Locava candidate. */
  keys: ReadonlyArray<string>;
  /**
   * Tag key/value pairs that elevate an object into the candidate set even
   * when the bare key would not. Mostly highway-track-style overrides.
   */
  keyValuePairs?: ReadonlyArray<{ key: string; values: ReadonlyArray<string> }>;
  /**
   * Tag pairs that act as "if value is truthy, also keep". e.g. atv=yes.
   */
  truthyValueKeys?: ReadonlyArray<string>;
};

const PRIMARY_FEATURE_TAG_KEYS = [
  "amenity",
  "natural",
  "leisure",
  "tourism",
  "historic",
  "waterway",
  "place",
  "man_made",
  "barrier",
  "shop",
  "craft",
  "office",
  "building",
  "landuse",
  "water",
  "wetland",
  "railway",
  "aeroway",
  "power",
  "emergency",
  "healthcare",
  "sport",
  "public_transport",
  "boundary",
  "route",
  "information",
  "mountain_pass",
] as const;

const OFFROAD_TAG_KEYS = [
  "atv",
  "ohv",
  "ohrv",
  "4wd_only",
  "motorcycle",
  "motor_vehicle",
  "tracktype",
  "smoothness",
  "surface",
  "maintenance",
  "seasonal",
  "legal_trail",
  "class",
  "road_class",
  "highway_class",
  "town_highway_class",
  "vt_class",
  "nh_class",
  "sac_scale",
  "trail_visibility",
] as const;

const METADATA_TAG_KEYS = [
  "name",
  "name:en",
  "ref",
  "wikidata",
  "wikipedia",
  "image",
  "mapillary",
  "website",
  "opening_hours",
  "operator",
  "fee",
  "access",
] as const;

const PARKING_KEYS = ["parking"] as const;

const TRUTHY_VALUE_KEYS = [
  "atv",
  "ohv",
  "ohrv",
  "4wd_only",
  "motorcycle",
] as const;

export const DEFAULT_PBF_TAG_FILTER_POLICY: PbfTagFilterPolicy = {
  keys: [
    ...PRIMARY_FEATURE_TAG_KEYS,
    ...OFFROAD_TAG_KEYS,
    ...METADATA_TAG_KEYS,
    ...PARKING_KEYS,
  ],
  keyValuePairs: [
    { key: "highway", values: ["unclassified", "track", "service", "path", "footway", "bridleway", "cycleway", "trailhead", "ford"] },
  ],
  truthyValueKeys: TRUTHY_VALUE_KEYS,
};

/**
 * Bbox exhaustive mode — align with buildHartlandOverpassQuery / FEATURE_TAG_KEYS so
 * bridges (highway=* + bridge=yes), named roads, and trail ways are not dropped before
 * the classifier. Only used when geoFilterEnabled (full PBF scan + viewport filter).
 */
export const BBOX_EXHAUSTIVE_PBF_TAG_FILTER_POLICY: PbfTagFilterPolicy = {
  keys: [
    ...DEFAULT_PBF_TAG_FILTER_POLICY.keys,
    "highway",
    "bridge",
    "foot",
    "hiking",
    "bicycle",
    "horse",
    "covered",
  ],
  keyValuePairs: DEFAULT_PBF_TAG_FILTER_POLICY.keyValuePairs,
  truthyValueKeys: DEFAULT_PBF_TAG_FILTER_POLICY.truthyValueKeys,
};

export function resolvePbfTagFilterPolicy(input?: { geoFilterEnabled?: boolean }): PbfTagFilterPolicy {
  return input?.geoFilterEnabled ? BBOX_EXHAUSTIVE_PBF_TAG_FILTER_POLICY : DEFAULT_PBF_TAG_FILTER_POLICY;
}

/**
 * Pre-built Set for O(1) lookups during high-throughput streaming.
 */
function buildKeySet(policy: PbfTagFilterPolicy): Set<string> {
  return new Set(policy.keys.map((k) => k.toLowerCase()));
}

export type PbfTagFilter = {
  policy: PbfTagFilterPolicy;
  /**
   * Returns true if this set of tags should be sent to the classifier.
   * The function NEVER mutates the tags object and NEVER decides activities.
   */
  isCandidate(tags: Record<string, string> | undefined | null): boolean;
};

export function createPbfTagFilter(
  policy: PbfTagFilterPolicy = DEFAULT_PBF_TAG_FILTER_POLICY
): PbfTagFilter {
  const keySet = buildKeySet(policy);
  const truthyKeys = new Set((policy.truthyValueKeys ?? []).map((k) => k.toLowerCase()));
  const kvIndex: Map<string, Set<string>> = new Map();
  for (const pair of policy.keyValuePairs ?? []) {
    const lc = pair.key.toLowerCase();
    const set = kvIndex.get(lc) ?? new Set<string>();
    for (const value of pair.values) {
      set.add(String(value).toLowerCase());
    }
    kvIndex.set(lc, set);
  }

  return {
    policy,
    isCandidate(tags) {
      if (!tags) return false;
      for (const key of Object.keys(tags)) {
        const lc = key.toLowerCase();
        if (keySet.has(lc)) return true;
        const allowedValues = kvIndex.get(lc);
        if (allowedValues) {
          const value = tags[key];
          if (typeof value === "string" && allowedValues.has(value.toLowerCase())) {
            return true;
          }
        }
        if (truthyKeys.has(lc)) {
          const value = tags[key];
          if (typeof value === "string" && value.trim().length > 0 && value.toLowerCase() !== "no") {
            return true;
          }
        }
      }
      return false;
    },
  };
}
