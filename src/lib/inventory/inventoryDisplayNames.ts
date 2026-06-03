import type { ParentContext } from "./inventoryParentContext.js";

export type NameQuality = "osm_name" | "generated_from_parent" | "generated_from_category" | "weak_generic" | "unnamed";

const WEAK_GENERIC_NAMES = new Set([
  "beach",
  "water",
  "pond",
  "lake",
  "wetland",
  "marsh",
  "path",
  "trail",
  "viewpoint",
  "picnic site",
  "picnic_site",
  "swimming area",
  "swimming_area",
  "natural feature",
  "natural_feature",
  "unnamed trail segment",
  "parking",
  "shelter",
  "information",
  "swimming hole",
  "river access",
]);

function normalizeWeak(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, " ");
}

export function isWeakGenericName(name: string | null | undefined): boolean {
  if (!name?.trim()) return true;
  const n = normalizeWeak(name);
  return WEAK_GENERIC_NAMES.has(n) || n === "unnamed spot" || n.length < 3;
}

export type DisplayNameResult = {
  rawName: string | null;
  displayName: string;
  nameQuality: NameQuality;
  nameWarnings: string[];
  displayNameGenerated: boolean;
  generatedNameReason?: string;
};

export function buildDisplayName(input: {
  rawName: string | null;
  category: string;
  parentContext?: ParentContext;
  nearestLocality?: string | null;
  tags?: Record<string, string>;
}): DisplayNameResult {
  const raw = input.rawName?.trim() || null;
  const nameWarnings: string[] = [];

  if (raw && !isWeakGenericName(raw)) {
    return {
      rawName: raw,
      displayName: raw,
      nameQuality: "osm_name",
      nameWarnings,
      displayNameGenerated: false,
    };
  }

  const parent = input.parentContext?.parentName;
  const cat = input.category;

  if (parent && (cat === "beach" || cat === "swimming" || cat === "swimming_hole")) {
    const suffix =
      cat === "beach" ? " Beach" : cat.includes("swim") ? " Swimming Area" : " River Access";
    return {
      rawName: raw,
      displayName: `${parent}${suffix}`,
      nameQuality: "generated_from_parent",
      nameWarnings: raw ? ["weak_generic_raw_name"] : [],
      displayNameGenerated: true,
      generatedNameReason: "parent_place_beach_swimming",
    };
  }

  if (parent && cat === "viewpoint") {
    return {
      rawName: raw,
      displayName: `${parent} Viewpoint`,
      nameQuality: "generated_from_parent",
      nameWarnings: raw ? ["weak_generic_raw_name"] : [],
      displayNameGenerated: true,
      generatedNameReason: "parent_place_viewpoint",
    };
  }

  if (parent && cat === "waterfall") {
    return {
      rawName: raw,
      displayName: raw && !isWeakGenericName(raw) ? raw : `${parent} Waterfall`,
      nameQuality: raw && !isWeakGenericName(raw) ? "osm_name" : "generated_from_parent",
      nameWarnings: [],
      displayNameGenerated: !(raw && !isWeakGenericName(raw)),
      generatedNameReason: "parent_place_waterfall",
    };
  }

  if (parent && (cat === "wetland" || cat === "marsh")) {
    return {
      rawName: raw,
      displayName: `${parent} Wetland`,
      nameQuality: "generated_from_parent",
      nameWarnings: raw ? ["weak_generic_raw_name"] : [],
      displayNameGenerated: true,
      generatedNameReason: "parent_place_wetland",
    };
  }

  if (parent && (cat === "picnic_site" || cat === "shelter")) {
    const suffix = cat === "shelter" ? " Shelter" : " Picnic Area";
    return {
      rawName: raw,
      displayName: `${parent}${suffix}`,
      nameQuality: "generated_from_parent",
      nameWarnings: [],
      displayNameGenerated: true,
      generatedNameReason: "parent_place_picnic_shelter",
    };
  }

  if (parent && cat === "bridge") {
    return {
      rawName: raw,
      displayName: raw && !isWeakGenericName(raw) ? raw : `${parent} Bridge`,
      nameQuality: raw && !isWeakGenericName(raw) ? "osm_name" : "generated_from_parent",
      nameWarnings: [],
      displayNameGenerated: !(raw && !isWeakGenericName(raw)),
      generatedNameReason: "parent_place_bridge",
    };
  }

  const locality = input.nearestLocality ?? (input.parentContext?.relation === "nearest_locality" ? parent : null);
  if (locality && (cat === "beach" || cat === "swimming" || cat === "swimming_hole")) {
    const label = cat === "beach" ? "Beach" : "Swimming Spot";
    return {
      rawName: raw,
      displayName: `${label} near ${locality}`,
      nameQuality: "generated_from_category",
      nameWarnings: ["no_parent_area_used_locality"],
      displayNameGenerated: true,
      generatedNameReason: "locality_beach_swimming",
    };
  }

  if (raw) {
    return {
      rawName: raw,
      displayName: raw,
      nameQuality: "weak_generic",
      nameWarnings: ["weak_generic_kept"],
      displayNameGenerated: false,
    };
  }

  const fallback = cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    rawName: null,
    displayName: fallback || "Unnamed place",
    nameQuality: "unnamed",
    nameWarnings: ["unnamed_fallback"],
    displayNameGenerated: true,
    generatedNameReason: "category_fallback",
  };
}
