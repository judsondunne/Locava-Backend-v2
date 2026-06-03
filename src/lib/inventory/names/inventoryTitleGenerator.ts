import { isWeakGenericName } from "../inventoryDisplayNames.js";

export type TitleQuality = "official" | "contextual" | "generated" | "weak" | "bad";

export type InventoryTitleResult = {
  displayName: string;
  subtitle: string;
  rawName: string | null;
  titleQuality: TitleQuality;
  titleReason: string;
  titleWarnings: string[];
};

const NEVER_DISPLAY_CATEGORIES = new Set(["natural_feature", "natural feature", "unnamed trail segment"]);

const TITLE_WEAK_NAMES = new Set([
  "beach",
  "water",
  "pond",
  "lake",
  "wetland",
  "marsh",
  "viewpoint",
  "waterfall",
  "bridge",
  "path",
  "trail",
  "natural feature",
  "natural_feature",
  "unnamed trail segment",
  "swimming area",
  "swimming_area",
]);

function isTitleWeakName(name: string | null | undefined): boolean {
  if (!name?.trim()) return true;
  return isWeakGenericName(name) || TITLE_WEAK_NAMES.has(name.trim().toLowerCase().replace(/_/g, " "));
}

function cleanWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parentName(ctx: { parentPlaceName?: string | null; parentContext?: { parentName?: string } | null }): string | null {
  return ctx.parentPlaceName ?? ctx.parentContext?.parentName ?? null;
}

function nearestPlace(ctx: { nearestLocality?: string | null }): string | null {
  return ctx.nearestLocality?.trim() || null;
}

export function generateInventoryTitle(input: {
  rawName?: string | null;
  category?: string | null;
  tags?: Record<string, string>;
  parentPlaceName?: string | null;
  parentContext?: { parentName?: string; parentCategory?: string } | null;
  nearestLocality?: string | null;
  itemKind?: "spot" | "route";
  activities?: string[];
  primaryActivity?: string | null;
  distanceMiles?: number;
  hasParking?: boolean;
  offroadLabel?: string | null;
}): InventoryTitleResult {
  const raw = input.rawName?.trim() || null;
  const cat = (input.category ?? "").toLowerCase();
  const parent = parentName(input);
  const near = nearestPlace(input);
  const titleWarnings: string[] = [];

  if (NEVER_DISPLAY_CATEGORIES.has(cat) || NEVER_DISPLAY_CATEGORIES.has((raw ?? "").toLowerCase())) {
    if (parent) {
      const mapped = mapNaturalFeatureCategory(cat, input.tags);
      const suffix = mapped ? ` ${capitalizeWords(mapped.replace(/_/g, " "))}` : " Feature";
      return {
        displayName: `${parent}${suffix}`,
        subtitle: buildSubtitle(input),
        rawName: raw,
        titleQuality: "contextual",
        titleReason: "natural_feature_mapped_to_context",
        titleWarnings: ["natural_feature_title_fixed"],
      };
    }
    return {
      displayName: raw && !isWeakGenericName(raw) ? raw : "Unnamed place",
      subtitle: buildSubtitle(input),
      rawName: raw,
      titleQuality: "bad",
      titleReason: "natural_feature_no_context",
      titleWarnings: ["natural_feature_unmapped"],
    };
  }

  if (raw && !isTitleWeakName(raw)) {
    return {
      displayName: cleanWhitespace(raw),
      subtitle: buildSubtitle(input),
      rawName: raw,
      titleQuality: "official",
      titleReason: "strong_official_name",
      titleWarnings,
    };
  }

  if (parent) {
    const contextual = contextualTitleFromParent(parent, cat, raw, input.tags);
    if (contextual) {
      return {
        displayName: contextual,
        subtitle: buildSubtitle(input),
        rawName: raw,
        titleQuality: "contextual",
        titleReason: "generated_from_parent_context",
        titleWarnings: raw ? ["weak_generic_raw_name"] : ["unnamed_with_parent"],
      };
    }
  }

  if (near) {
    const nearTitle = contextualTitleFromNearest(near, cat);
    if (nearTitle) {
      return {
        displayName: nearTitle,
        subtitle: buildSubtitle(input),
        rawName: raw,
        titleQuality: "generated",
        titleReason: "generated_from_nearest_place",
        titleWarnings: ["generated_from_nearest"],
      };
    }
  }

  if (cat && !isWeakGenericName(cat)) {
    return {
      displayName: capitalizeWords(cat.replace(/_/g, " ")),
      subtitle: buildSubtitle(input),
      rawName: raw,
      titleQuality: "weak",
      titleReason: "category_only_title",
      titleWarnings: ["weak_category_title"],
    };
  }

  return {
    displayName: raw ?? "Unnamed place",
    subtitle: buildSubtitle(input),
    rawName: raw,
    titleQuality: "bad",
    titleReason: "no_title_context",
    titleWarnings: ["bad_title"],
  };
}

function mapNaturalFeatureCategory(cat: string, tags?: Record<string, string>): string | null {
  const natural = tags?.natural?.toLowerCase();
  if (natural === "bare_rock" || natural === "rock") return "rock formation";
  if (natural === "peak") return "Peak";
  if (natural === "hill") return "Hill";
  if (natural === "water") return tags?.water === "pond" ? "Pond" : tags?.water === "lake" ? "Lake" : "Water";
  if (natural === "wetland") return "Wetland";
  if (cat.includes("quarry")) return "Quarry";
  return "Natural";
}

function capitalizeWords(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function contextualTitleFromParent(parent: string, cat: string, raw: string | null, tags?: Record<string, string>): string | null {
  const rules: Array<[RegExp | string, string]> = [
    ["beach", " Beach"],
    ["swimming", " Swimming Area"],
    ["swimming_hole", " Swimming Hole"],
    ["swimminghole", " Swimming Hole"],
    ["viewpoint", " Viewpoint"],
    ["waterfall", " Waterfall"],
    ["wetland", " Wetland"],
    ["marsh", " Marsh"],
    ["pond", " Pond"],
    ["lake", " Lake"],
    ["picnic_site", " Picnic Area"],
    ["shelter", " Shelter"],
    ["trailhead", " Trailhead"],
    ["access_point", " Access Point"],
    ["bridge", " Bridge"],
    ["railroad_bridge", " Railroad Bridge"],
    ["path", " Trail"],
    ["footway", " Trail"],
    ["track", " Trail"],
    ["natural_feature", " Feature"],
  ];
  for (const [pattern, suffix] of rules) {
    const matches = typeof pattern === "string" ? cat === pattern : pattern.test(cat);
    if (!matches) continue;
    if (cat === "waterfall") return `${parent} Waterfall`;
    if (cat === "bridge") return `${parent} Bridge`;
    return `${parent}${suffix}`;
  }
  if (cat === "water") {
    const water = tags?.water?.toLowerCase();
    if (water === "pond") return `${parent} Pond`;
    if (water === "lake") return `${parent} Lake`;
    return `${parent} Water Access`;
  }
  if (inputItemKindIsRoute(cat)) return `${parent} Trail`;
  return null;
}

function inputItemKindIsRoute(cat: string): boolean {
  return ["path", "footway", "track", "hiking", "walking", "trail"].includes(cat);
}

function contextualTitleFromNearest(near: string, cat: string): string | null {
  if (cat === "viewpoint") return `Scenic Viewpoint near ${near}`;
  if (cat === "beach") return `Beach near ${near}`;
  if (cat === "swimming" || cat === "swimming_hole") return `Swimming Area near ${near}`;
  if (cat === "waterfall") return `Waterfall near ${near}`;
  return null;
}

function buildSubtitle(input: {
  activities?: string[];
  primaryActivity?: string | null;
  distanceMiles?: number;
  hasParking?: boolean;
  offroadLabel?: string | null;
  parentPlaceName?: string | null;
}): string {
  const parts: string[] = [];
  if (input.offroadLabel) parts.push(input.offroadLabel);
  if (input.primaryActivity) parts.push(capitalizeWords(input.primaryActivity.replace(/([a-z])([A-Z])/g, "$1 $2")));
  const secondary = (input.activities ?? []).filter((a) => a !== input.primaryActivity).slice(0, 4);
  for (const a of secondary) parts.push(capitalizeWords(a));
  if (input.distanceMiles != null && input.distanceMiles > 0) parts.push(`${input.distanceMiles.toFixed(1)} mi`);
  if (input.hasParking) parts.push("Parking nearby");
  if (input.offroadLabel) parts.push("Verify access");
  const unique = [...new Set(parts.filter(Boolean))];
  return unique.slice(0, 6).join(" · ");
}

export function isBadTitleQuality(q: TitleQuality): boolean {
  return q === "bad" || q === "weak";
}
