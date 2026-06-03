import type { OsmFeatureListItem } from "../../openstreetmap/osmFeatureParse.js";
import {
  extractRoadClassSignals,
  extractVehicleSignals,
  hasExplicitVehicleSignal,
  inferAccessStatus,
  inferOffroadCategory,
  OFFROAD_ACCESS_WARNINGS,
  textContainsOffroadClassSignal,
  type OffroadAccessStatus,
  type OffroadCategory,
  type OffroadConfidence,
  type RoadClassSignals,
  type VehicleSignals,
} from "./inventoryOffroadSignals.js";

export type OffroadClassificationResult = {
  sourceKey: string;
  decision: "accept" | "candidate" | "reject";
  score: number;
  activity: "offroading";
  legalDisplayLabel: "Unmaintained road";
  offroadCategory: OffroadCategory;
  offroadConfidence: OffroadConfidence;
  accessStatus: OffroadAccessStatus;
  accessWarnings: string[];
  seasonalWarnings: string[];
  sourceSignals: string[];
  vehicleSignals: VehicleSignals;
  roadClassSignals: RoadClassSignals;
  displayName: string;
  rejectionReason?: string;
};

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
]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function positiveVehicle(v?: string): boolean {
  return v != null && ["yes", "designated", "permissive"].includes(v.toLowerCase());
}

/** Named forest/town tracks without class tags — not hiking trails or Class 4 roads. */
export function isGenericNamedForestOrTownRoad(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  const cls = textContainsOffroadClassSignal(name);
  if (cls.vtClass4 || cls.nhClass6 || cls.legalTrail) return false;
  const n = name.toLowerCase();
  if (/\b(trail|path)\b/.test(n) && !/\b(road|highway)\b/.test(n)) return false;
  if (/\b(road|highway|town\s*highway|town\s*rd)\b/.test(n)) return true;
  if (/\b(th)\s*\d+\b/i.test(name)) return true;
  return false;
}

function nameOffroadSignals(name: string | null | undefined): string[] {
  if (!name) return [];
  const n = name.toLowerCase();
  const signals: string[] = [];
  if (/class\s*(4|iv)/i.test(name)) signals.push("name:class4");
  if (/class\s*(6|vi)/i.test(name)) signals.push("name:class6");
  if (/legal\s*trail/i.test(name)) signals.push("name:legal_trail");
  if (/atv|ohrv|ohv|4x4|4wd|jeep/i.test(name)) signals.push("name:offroad");
  if (/unmaintained|forest road|discontinued|pent road/i.test(n)) signals.push("name:unmaintained");
  if (/town highway|town rd|town road/i.test(n)) signals.push("name:town_highway");
  return signals;
}

export function scoreOffroadTags(tags: Record<string, string>, name?: string | null): { score: number; signals: string[]; negatives: string[] } {
  let score = 0;
  const signals: string[] = [];
  const negatives: string[] = [];
  const vehicle = extractVehicleSignals(tags);
  const roadClass = extractRoadClassSignals(tags, name);
  const highway = tag(tags, "highway");
  const access = inferAccessStatus(tags);

  if (positiveVehicle(vehicle.atv)) {
    score += tag(tags, "atv") === "designated" ? 90 : 90;
    signals.push(`atv=${vehicle.atv}`);
  }
  if (positiveVehicle(vehicle.ohv)) {
    score += 90;
    signals.push(`ohv=${vehicle.ohv}`);
  }
  if (positiveVehicle(vehicle.ohrv)) {
    score += 90;
    signals.push(`ohrv=${vehicle.ohrv}`);
  }
  if (vehicle.fourWdOnly) {
    score += 85;
    signals.push("4wd_only=yes");
  }
  if (roadClass.vtClass4) {
    score += 85;
    signals.push("class4");
  }
  if (roadClass.nhClass6) {
    score += 85;
    signals.push("class6");
  }
  if (roadClass.legalTrail) {
    score += 80;
    signals.push("legal_trail");
  }
  if (highway === "track") {
    score += 45;
    signals.push("highway=track");
  } else if (highway === "unclassified") {
    score += 35;
    signals.push("highway=unclassified");
    const surface = tag(tags, "surface");
    if (!surface || UNPAVED_SURFACES.has(surface) || surface === "gravel") {
      score += 25;
      signals.push("unclassified_unpaved_candidate");
    }
  } else if (highway === "service" && tag(tags, "service") !== "driveway" && tag(tags, "service") !== "private") {
    score += 20;
    signals.push("highway=service");
  }
  const tracktype = tag(tags, "tracktype");
  if (tracktype === "grade5" || tracktype === "grade4") {
    score += 50;
    signals.push(`tracktype=${tracktype}`);
  } else if (tracktype === "grade3") {
    score += 45;
    signals.push("tracktype=grade3");
  } else if (tracktype === "grade2") {
    score += 35;
    signals.push("tracktype=grade2");
  }
  const smoothness = tag(tags, "smoothness");
  if (smoothness === "very_bad" || smoothness === "horrible" || smoothness === "very_horrible") {
    score += 45;
    signals.push(`smoothness=${smoothness}`);
  } else if (smoothness === "bad") {
    score += 35;
    signals.push("smoothness=bad");
  }
  const surface = tag(tags, "surface");
  if (surface && ["dirt", "earth", "ground", "mud", "sand", "grass", "rock"].includes(surface)) {
    score += 40;
    signals.push(`surface=${surface}`);
  } else if (surface && ["gravel", "fine_gravel", "unpaved"].includes(surface)) {
    score += 30;
    signals.push(`surface=${surface}`);
  }
  if (tag(tags, "maintenance") === "unmaintained") {
    score += 30;
    signals.push("maintenance=unmaintained");
  }
  if (tag(tags, "seasonal") === "yes") {
    score += 25;
    signals.push("seasonal=yes");
  }
  if (access === "public" || access === "permissive" || access === "designated") {
    score += 25;
    signals.push(`access=${access}`);
  }

  signals.push(...nameOffroadSignals(name));

  if (access === "private") {
    score -= 90;
    negatives.push("access=private");
  }
  if (tag(tags, "motor_vehicle") === "no" && !hasExplicitVehicleSignal(vehicle)) {
    score -= 90;
    negatives.push("motor_vehicle=no");
  }
  if (tag(tags, "service") === "driveway" || tag(tags, "service") === "private") {
    score -= 80;
    negatives.push(`service=${tag(tags, "service")}`);
  }
  if (highway === "residential" && !roadClass.vtClass4 && !roadClass.nhClass6 && !hasExplicitVehicleSignal(vehicle)) {
    score -= 80;
    negatives.push("highway=residential");
  }
  if (["primary", "secondary", "tertiary", "trunk"].includes(highway ?? "") && !roadClass.vtClass4 && !roadClass.nhClass6 && !hasExplicitVehicleSignal(vehicle)) {
    score -= 80;
    negatives.push(`highway=${highway}`);
  }
  if (["footway", "sidewalk", "crossing"].includes(highway ?? "") && !hasExplicitVehicleSignal(vehicle)) {
    score -= 70;
    negatives.push(`highway=${highway}`);
  }
  if (tag(tags, "atv") === "no" && tag(tags, "ohv") === "no" && tag(tags, "motorcycle") === "no" && !vehicle.fourWdOnly) {
    score -= 40;
    negatives.push("vehicle=no");
  }

  return { score, signals, negatives };
}

function inferConfidence(score: number, signals: string[], roadClass: RoadClassSignals, vehicle: VehicleSignals): OffroadConfidence {
  if (
    signals.some((s) => s.startsWith("atv=") || s.startsWith("ohv=") || s.startsWith("ohrv=")) ||
    vehicle.fourWdOnly ||
    roadClass.vtClass4 ||
    roadClass.nhClass6 ||
    roadClass.legalTrail
  ) {
    return "explicit";
  }
  if (score >= 80) return "strong";
  if (score >= 65) return "medium";
  return "candidate";
}

function buildDisplayName(feature: OsmFeatureListItem, roadClass: RoadClassSignals, vehicle: VehicleSignals): string {
  if (feature.hasRealName) return feature.name;
  const locality = tag(feature.tags, "addr:city") ?? tag(feature.tags, "is_in");
  const near = locality ? ` near ${locality}` : "";
  if (roadClass.vtClass4) return `Class 4 Road${near}`;
  if (roadClass.nhClass6) return `Class VI Road${near}`;
  if (vehicle.atv && positiveVehicle(vehicle.atv)) return `ATV Trail${near}`;
  return `Unmaintained Road${near}`;
}

export function classifyOffroadCandidate(
  feature: OsmFeatureListItem,
  context?: { localityName?: string }
): OffroadClassificationResult | null {
  if (feature.geometryKind !== "line" || feature.coordinates.length < 2) return null;

  const tags = feature.tags;
  const highway = tag(tags, "highway");
  const name = feature.hasRealName ? feature.name : null;
  const { score, signals, negatives } = scoreOffroadTags(tags, name);
  const vehicle = extractVehicleSignals(tags);
  const roadClass = extractRoadClassSignals(tags, name);
  const accessStatus = inferAccessStatus(tags);

  if (accessStatus === "private" || accessStatus === "restricted") {
    return {
      sourceKey: feature.id,
      decision: "reject",
      score,
      activity: "offroading",
      legalDisplayLabel: "Unmaintained road",
      offroadCategory: inferOffroadCategory(tags, roadClass, vehicle),
      offroadConfidence: "candidate",
      accessStatus,
      accessWarnings: [...OFFROAD_ACCESS_WARNINGS],
      seasonalWarnings: tag(tags, "seasonal") === "yes" ? ["Seasonal road — verify current access."] : [],
      sourceSignals: signals,
      vehicleSignals: vehicle,
      roadClassSignals: roadClass,
      displayName: buildDisplayName(feature, roadClass, vehicle),
      rejectionReason: accessStatus === "private" ? "private_access" : "restricted_access",
    };
  }

  if (highway === "path" && !hasExplicitVehicleSignal(vehicle) && tag(tags, "motor_vehicle") !== "yes") {
    return null;
  }

  if (tag(tags, "motor_vehicle") === "no" && !hasExplicitVehicleSignal(vehicle) && !positiveVehicle(vehicle.motorcycle)) {
    return {
      sourceKey: feature.id,
      decision: "reject",
      score,
      activity: "offroading",
      legalDisplayLabel: "Unmaintained road",
      offroadCategory: inferOffroadCategory(tags, roadClass, vehicle),
      offroadConfidence: "candidate",
      accessStatus,
      accessWarnings: OFFROAD_ACCESS_WARNINGS,
      seasonalWarnings: [],
      sourceSignals: signals,
      vehicleSignals: vehicle,
      roadClassSignals: roadClass,
      displayName: buildDisplayName(feature, roadClass, vehicle),
      rejectionReason: "motor_vehicle_no",
    };
  }

  if (score < 45) return null;

  const offroadConfidence = inferConfidence(score, signals, roadClass, vehicle);
  const isExplicitClass = roadClass.vtClass4 || roadClass.nhClass6 || roadClass.legalTrail || hasExplicitVehicleSignal(vehicle);

  if (
    highway === "track" &&
    !isExplicitClass &&
    isGenericNamedForestOrTownRoad(name)
  ) {
    return null;
  }

  const acceptThreshold = isExplicitClass ? 55 : 70;
  const decision = score >= acceptThreshold ? "accept" : score >= 45 ? "candidate" : "reject";

  // Generic short forest tracks without class/vehicle signals are usually not Class 4 roads.
  if (
    highway === "track" &&
    !isExplicitClass &&
    !tag(tags, "tracktype") &&
    !tag(tags, "surface") &&
    score < 75
  ) {
    return null;
  }

  // Candidate-tier generic tracks are not publishable offroad routes.
  if (decision === "candidate" && !isExplicitClass) {
    return null;
  }

  return {
    sourceKey: feature.id,
    decision,
    score,
    activity: "offroading",
    legalDisplayLabel: "Unmaintained road",
    offroadCategory: inferOffroadCategory(tags, roadClass, vehicle),
    offroadConfidence,
    accessStatus,
    accessWarnings: [...OFFROAD_ACCESS_WARNINGS],
    seasonalWarnings: tag(tags, "seasonal") === "yes" ? ["Seasonal road — verify current access."] : [],
    sourceSignals: [...signals, ...negatives.map((n) => `-${n}`)],
    vehicleSignals: vehicle,
    roadClassSignals: roadClass,
    displayName: buildDisplayName(feature, roadClass, vehicle),
  };
}

export function isOffroadWayForTrailExclusion(feature: OsmFeatureListItem): boolean {
  if (feature.geometryKind !== "line") return false;
  const { score } = scoreOffroadTags(feature.tags, feature.hasRealName ? feature.name : null);
  return score >= 65 || hasExplicitVehicleSignal(extractVehicleSignals(feature.tags));
}

export { textContainsOffroadClassSignal };
