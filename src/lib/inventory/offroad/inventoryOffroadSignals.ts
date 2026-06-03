export type OffroadCategory =
  | "offroading"
  | "unmaintained_road"
  | "class4_road"
  | "class6_road"
  | "atv_trail"
  | "ohv_trail"
  | "ohrv_trail"
  | "4wd_track"
  | "forest_road"
  | "seasonal_road"
  | "legal_trail"
  | "dirt_road";

export type OffroadConfidence = "explicit" | "strong" | "medium" | "candidate";
export type OffroadAccessStatus =
  | "public"
  | "limited"
  | "permissive"
  | "designated"
  | "unknown"
  | "private"
  | "restricted";

export type VehicleSignals = {
  atv?: string;
  ohv?: string;
  ohrv?: string;
  motorcycle?: string;
  motorVehicle?: string;
  motorcar?: string;
  fourWdOnly?: boolean;
  hgv?: string;
};

export type RoadClassSignals = {
  vtClass4?: boolean;
  nhClass6?: boolean;
  legalTrail?: boolean;
  classTagRaw?: string;
  maintenanceRaw?: string;
};

const POSITIVE_VEHICLE = new Set(["yes", "designated", "permissive", "private"]);
const UNPAVED_SURFACES = new Set([
  "dirt",
  "earth",
  "ground",
  "gravel",
  "fine_gravel",
  "sand",
  "mud",
  "grass",
  "rock",
  "pebblestone",
  "unpaved",
  "compacted",
]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function tagRaw(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim();
}

export function textContainsOffroadClassSignal(text: string): {
  vtClass4: boolean;
  nhClass6: boolean;
  legalTrail: boolean;
} {
  const t = text.toLowerCase();
  return {
    vtClass4: /\bclass\s*(4|iv|four)\b/i.test(text) || /\bclass_?4\b/i.test(t),
    nhClass6: /\bclass\s*(6|vi|six)\b/i.test(text) || /\bclass_?6\b/i.test(t),
    legalTrail: /\blegal\s*trail\b/i.test(t),
  };
}

export function extractRoadClassSignals(tags: Record<string, string>, name?: string | null): RoadClassSignals {
  const classKeys = [
    "class",
    "road_class",
    "highway_class",
    "vt_class",
    "nh_class",
    "town_highway_class",
    "highwayclass",
    "local_class",
    "th_class",
    "vtclass",
    "maintained",
    "description",
    "note",
    "source",
    "ref",
  ];
  let classTagRaw: string | undefined;
  let vtClass4 = false;
  let nhClass6 = false;
  let legalTrail = false;

  for (const [key, rawVal] of Object.entries(tags)) {
    const v = rawVal?.trim();
    if (!v) continue;
    const lowerKey = key.toLowerCase();
    if (classKeys.includes(lowerKey) || lowerKey.includes("class") || lowerKey.includes("highway")) {
      const hit = textContainsOffroadClassSignal(v);
      vtClass4 = vtClass4 || hit.vtClass4;
      nhClass6 = nhClass6 || hit.nhClass6;
      legalTrail = legalTrail || hit.legalTrail;
      if (!classTagRaw && (hit.vtClass4 || hit.nhClass6 || hit.legalTrail || classKeys.includes(lowerKey))) {
        classTagRaw = v;
      }
    }
    if (/pent\s*road|discontinued|unmaintained|class\s*4|class\s*iv|class\s*6|class\s*vi/i.test(v)) {
      const hit = textContainsOffroadClassSignal(v);
      vtClass4 = vtClass4 || hit.vtClass4;
      nhClass6 = nhClass6 || hit.nhClass6;
    }
  }

  const fromName = name ? textContainsOffroadClassSignal(name) : { vtClass4: false, nhClass6: false, legalTrail: false };
  const legalTrailTag =
    tag(tags, "legal_trail") === "yes" ||
    tag(tags, "designation") === "legal_trail" ||
    tag(tags, "official_status") === "legal_trail";

  return {
    vtClass4: vtClass4 || fromName.vtClass4 || classTagRaw === "4" || classTagRaw?.toLowerCase() === "iv",
    nhClass6: nhClass6 || fromName.nhClass6 || classTagRaw === "6" || classTagRaw?.toLowerCase() === "vi",
    legalTrail: legalTrail || legalTrailTag || fromName.legalTrail,
    classTagRaw,
    maintenanceRaw: tagRaw(tags, "maintenance"),
  };
}

export function extractVehicleSignals(tags: Record<string, string>): VehicleSignals {
  return {
    atv: tagRaw(tags, "atv"),
    ohv: tagRaw(tags, "ohv"),
    ohrv: tagRaw(tags, "ohrv"),
    motorcycle: tagRaw(tags, "motorcycle"),
    motorVehicle: tagRaw(tags, "motor_vehicle"),
    motorcar: tagRaw(tags, "motorcar"),
    fourWdOnly: tag(tags, "4wd_only") === "yes",
    hgv: tagRaw(tags, "hgv"),
  };
}

export function hasExplicitVehicleSignal(vehicle: VehicleSignals): boolean {
  const check = (v?: string) => v != null && POSITIVE_VEHICLE.has(v.toLowerCase());
  return check(vehicle.atv) || check(vehicle.ohv) || check(vehicle.ohrv) || vehicle.fourWdOnly === true;
}

export function hasStrongOffroadSignal(tags: Record<string, string>, name?: string | null): boolean {
  const vehicle = extractVehicleSignals(tags);
  const roadClass = extractRoadClassSignals(tags, name);
  if (hasExplicitVehicleSignal(vehicle)) return true;
  if (roadClass.vtClass4 || roadClass.nhClass6 || roadClass.legalTrail) return true;
  if (tag(tags, "4wd_only") === "yes") return true;
  const highway = tag(tags, "highway");
  if (highway === "track") {
    const tracktype = tag(tags, "tracktype");
    if (tracktype === "grade4" || tracktype === "grade5" || tracktype === "grade3") return true;
    const surface = tag(tags, "surface");
    if (surface && UNPAVED_SURFACES.has(surface)) return true;
    if (tag(tags, "maintenance") === "unmaintained") return true;
  }
  return false;
}

export function inferOffroadCategory(
  tags: Record<string, string>,
  roadClass: RoadClassSignals,
  vehicle: VehicleSignals
): OffroadCategory {
  if (roadClass.legalTrail) return "legal_trail";
  if (roadClass.vtClass4) return "class4_road";
  if (roadClass.nhClass6) return "class6_road";
  if (vehicle.atv && POSITIVE_VEHICLE.has(vehicle.atv.toLowerCase())) return "atv_trail";
  if (vehicle.ohv && POSITIVE_VEHICLE.has(vehicle.ohv.toLowerCase())) return "ohv_trail";
  if (vehicle.ohrv && POSITIVE_VEHICLE.has(vehicle.ohrv.toLowerCase())) return "ohrv_trail";
  if (vehicle.fourWdOnly) return "4wd_track";
  if (tag(tags, "highway") === "track") return "dirt_road";
  if (tag(tags, "seasonal") === "yes" || tag(tags, "winter_road") === "yes") return "seasonal_road";
  if (tag(tags, "maintenance") === "unmaintained") return "unmaintained_road";
  return "offroading";
}

export function inferAccessStatus(tags: Record<string, string>): OffroadAccessStatus {
  const access = tag(tags, "access");
  if (access === "private" || tag(tags, "private") === "yes") return "private";
  if (access === "no" || access === "restricted") return "restricted";
  if (access === "designated") return "designated";
  if (access === "permissive") return "permissive";
  if (access === "public" || access === "yes") return "public";
  return "unknown";
}

export const OFFROAD_ACCESS_WARNINGS = [
  "Verify local access, seasonal closures, vehicle rules, and current conditions before driving.",
];

export const OFFROAD_STATE_SOURCE_WARNINGS = [
  "Road classification does not guarantee current motor vehicle access.",
  "Verify town/local rules, seasonal closures, and signage.",
];
