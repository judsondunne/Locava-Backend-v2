/**
 * Smart display-name derivation for unnamed/nearby outdoor features (PBF Copier V2).
 */
import { isSyntheticPreviewLabel } from "./pbfCopierV2MountainQuality.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type NameSource = "osm_name" | "nearby_route" | "nearby_peak" | "nearby_destination" | "fallback";
export type NameConfidence = "high" | "medium" | "low";

export type DeriveDisplayNameResult = {
  displayName: string;
  derivedName: boolean;
  nameSource: NameSource;
  nameConfidence: NameConfidence;
};

export type DeriveDisplayNameContext = {
  nearestRoute?: PbfCopierPreviewDoc | null;
  nearestDestination?: PbfCopierPreviewDoc | null;
  routeDistanceMeters?: number;
  destinationDistanceMeters?: number;
};

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function osmName(tags: Record<string, string>): string | null {
  const name = tags.name?.trim() || tags["name:en"]?.trim() || tags.alt_name?.trim();
  return name && name.length > 0 ? name : null;
}

function featureTypeLabel(tags: Record<string, string>): string {
  if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") return "Waterfall";
  if (tag(tags, "tourism") === "viewpoint" || tag(tags, "scenic") === "yes") {
    const raw = (tags.name || "").toLowerCase();
    if (/\boverlook\b/.test(raw) || tag(tags, "viewpoint") === "overlook") return "Overlook";
    return "Viewpoint";
  }
  if (tag(tags, "highway") === "path" || tag(tags, "highway") === "footway") return "Connector Trail";
  if (tag(tags, "tourism") === "information") return "Information";
  return "Feature";
}

function cleanContextName(name: string): string {
  return name.trim().replace(/\b(trailhead|parking|viewpoint|overlook)\b/gi, "").trim() || name.trim();
}

function composeName(contextName: string, featureLabel: string): string {
  const base = cleanContextName(contextName);
  if (!base) return featureLabel;
  if (base.toLowerCase().includes(featureLabel.toLowerCase())) return base;
  return `${base} ${featureLabel}`;
}

export function deriveDisplayName(
  item: PbfCopierPreviewDoc,
  context: DeriveDisplayNameContext = {}
): DeriveDisplayNameResult {
  const tags = item.sourceTagSample ?? {};
  const direct = osmName(tags);
  if (direct && !isSyntheticPreviewLabel(item)) {
    return {
      displayName: direct,
      derivedName: false,
      nameSource: "osm_name",
      nameConfidence: "high",
    };
  }

  const alt = tags.alt_name?.trim();
  if (alt) {
    return {
      displayName: alt,
      derivedName: false,
      nameSource: "osm_name",
      nameConfidence: "high",
    };
  }

  const featureLabel = featureTypeLabel(tags);
  const route = context.nearestRoute;
  const dest = context.nearestDestination;
  const routeDist = context.routeDistanceMeters ?? Infinity;
  const destDist = context.destinationDistanceMeters ?? Infinity;

  const isWaterfall =
    tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall" || /\bwaterfall\b/i.test(item.displayName || "");
  const isViewpoint =
    tag(tags, "tourism") === "viewpoint" || tag(tags, "scenic") === "yes" || /\bviewpoint\b/i.test(item.displayName || "");

  if (isWaterfall) {
    if (route && routeDist <= 150 && route.displayName) {
      return {
        displayName: composeName(route.displayName, "Waterfall"),
        derivedName: true,
        nameSource: "nearby_route",
        nameConfidence: "high",
      };
    }
    if (dest && destDist <= 300 && dest.displayName) {
      return {
        displayName: composeName(dest.displayName, "Waterfall"),
        derivedName: true,
        nameSource: "nearby_destination",
        nameConfidence: "medium",
      };
    }
    return { displayName: "Waterfall", derivedName: true, nameSource: "fallback", nameConfidence: "low" };
  }

  if (isViewpoint) {
    const label = featureLabel;
    if (dest && destDist <= 300 && dest.displayName) {
      return {
        displayName: composeName(dest.displayName, label),
        derivedName: true,
        nameSource: "nearby_destination",
        nameConfidence: destDist <= 150 ? "high" : "medium",
      };
    }
    if (route && routeDist <= 200 && route.displayName) {
      return {
        displayName: composeName(route.displayName, label),
        derivedName: true,
        nameSource: "nearby_route",
        nameConfidence: "medium",
      };
    }
    return { displayName: label, derivedName: true, nameSource: "fallback", nameConfidence: "low" };
  }

  if (route && routeDist <= 100 && route.displayName && featureLabel === "Connector Trail") {
    return {
      displayName: composeName(route.displayName, "Connector Trail"),
      derivedName: true,
      nameSource: "nearby_route",
      nameConfidence: "medium",
    };
  }

  if (route && routeDist <= 150 && route.displayName) {
    return {
      displayName: composeName(route.displayName, featureLabel),
      derivedName: true,
      nameSource: "nearby_route",
      nameConfidence: "low",
    };
  }

  if (dest && destDist <= 200 && dest.displayName) {
    return {
      displayName: composeName(dest.displayName, featureLabel),
      derivedName: true,
      nameSource: "nearby_destination",
      nameConfidence: "low",
    };
  }

  return {
    displayName: featureLabel,
    derivedName: true,
    nameSource: "fallback",
    nameConfidence: "low",
  };
}
