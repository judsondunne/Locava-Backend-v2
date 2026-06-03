import type { LocavaInventorySpot, LocavaRejectedItem } from "./inventoryLocavaTypes.js";
import { isWeakGenericName } from "./inventoryDisplayNames.js";

export type FinalPolishDiagnostics = {
  swimmingAndBeach: {
    acceptedSwimming: Array<Record<string, unknown>>;
    acceptedBeaches: Array<Record<string, unknown>>;
    rejectedSwimmingBeachCandidates: Array<Record<string, unknown>>;
    privateSwimmingBeachRejected: Array<Record<string, unknown>>;
    generatedBeachNames: Array<Record<string, unknown>>;
  };
  anchors: {
    parentSpotsWithAnchors: number;
    anchorTypes: Record<string, number>;
    areaCenterFallbacks: Array<Record<string, unknown>>;
    viewpointAnchoredParents: Array<Record<string, unknown>>;
    waterfallAnchoredParents: Array<Record<string, unknown>>;
    swimmingAnchoredParents: Array<Record<string, unknown>>;
    beachAnchoredParents: Array<Record<string, unknown>>;
  };
  names: {
    generatedNamesCount: number;
    weakGenericAcceptedCount: number;
    weakGenericAcceptedSamples: Array<Record<string, unknown>>;
    generatedNameSamples: Array<Record<string, unknown>>;
    nameOnlyRejectedSamples: Array<Record<string, unknown>>;
  };
  access: {
    privateRejectedCount: number;
    publicAccessBoostedCount: number;
    missingAccessAcceptedWithContextCount: number;
    privateRejectedSamples: Array<Record<string, unknown>>;
  };
  remainingConcerns: string[];
};

function spotBrief(s: LocavaInventorySpot): Record<string, unknown> {
  return {
    name: s.displayName ?? s.name,
    rawName: s.rawName,
    category: s.category,
    sourceKey: s.sourceKey,
    displayPriority: s.displayPriority,
    anchor: s.primaryAnchor?.anchorType,
    nameQuality: s.nameQuality,
  };
}

export function buildFinalPolishDiagnostics(input: {
  spots: LocavaInventorySpot[];
  rejected: LocavaRejectedItem[];
}): FinalPolishDiagnostics {
  const swimmingCats = new Set(["swimming", "swimming_hole"]);
  const beachCats = new Set(["beach"]);

  const acceptedSwimming = input.spots.filter((s) => swimmingCats.has(s.category)).map(spotBrief);
  const acceptedBeaches = input.spots.filter((s) => beachCats.has(s.category)).map(spotBrief);

  const rejectedSwimmingBeachCandidates = input.rejected
    .filter(
      (r) =>
        /swim|beach|bathing|natural=beach|leisure=swimming/.test(
          `${r.rawTypeLabel} ${JSON.stringify(r.topTags)} ${r.name ?? ""}`.toLowerCase()
        )
    )
    .slice(0, 30)
    .map((r) => ({
      name: r.name,
      sourceKey: r.sourceKey,
      rejectionReason: r.rejectionReason,
      score: r.locavaScore,
    }));

  const privateSwimmingBeachRejected = input.rejected
    .filter((r) => r.rejectionReason === "private_access" && /swim|beach|bathing/.test(`${r.rawTypeLabel} ${JSON.stringify(r.topTags)}`))
    .slice(0, 20)
    .map((r) => ({ name: r.name, sourceKey: r.sourceKey, rejectionReason: r.rejectionReason }));

  const generatedBeachNames = input.spots
    .filter((s) => (beachCats.has(s.category) || swimmingCats.has(s.category)) && s.displayNameGenerated)
    .slice(0, 20)
    .map((s) => ({ rawName: s.rawName, displayName: s.displayName, reason: s.generatedNameReason }));

  const anchorTypes: Record<string, number> = {};
  const viewpointAnchoredParents: Array<Record<string, unknown>> = [];
  const waterfallAnchoredParents: Array<Record<string, unknown>> = [];
  const swimmingAnchoredParents: Array<Record<string, unknown>> = [];
  const beachAnchoredParents: Array<Record<string, unknown>> = [];
  const areaCenterFallbacks: Array<Record<string, unknown>> = [];

  let parentSpotsWithAnchors = 0;
  for (const s of input.spots) {
    if (!s.primaryAnchor || s.primaryAnchor.anchorType === "area_center") {
      if (s.childHighlights && s.childHighlights.length > 0 && s.anchorQuality === "area_center_fallback") {
        areaCenterFallbacks.push(spotBrief(s));
      }
      continue;
    }
    parentSpotsWithAnchors += 1;
    anchorTypes[s.primaryAnchor.anchorType] = (anchorTypes[s.primaryAnchor.anchorType] ?? 0) + 1;
    const brief = spotBrief(s);
    if (s.primaryAnchor.anchorType === "viewpoint") viewpointAnchoredParents.push(brief);
    if (s.primaryAnchor.anchorType === "waterfall") waterfallAnchoredParents.push(brief);
    if (s.primaryAnchor.anchorType === "swimming") swimmingAnchoredParents.push(brief);
    if (s.primaryAnchor.anchorType === "beach") beachAnchoredParents.push(brief);
  }

  const weakGenericAcceptedSamples = input.spots
    .filter((s) => isWeakGenericName(s.rawName ?? s.name) && !s.displayNameGenerated)
    .slice(0, 20)
    .map(spotBrief);

  const generatedNameSamples = input.spots
    .filter((s) => s.displayNameGenerated)
    .slice(0, 20)
    .map((s) => ({
      rawName: s.rawName,
      displayName: s.displayName,
      reason: s.generatedNameReason,
      sourceKey: s.sourceKey,
    }));

  const nameOnlyRejectedSamples = input.rejected
    .filter((r) => r.rejectionReason === "name_only_no_locava_signal")
    .slice(0, 20)
    .map((r) => ({ name: r.name, sourceKey: r.sourceKey, rawTypeLabel: r.rawTypeLabel }));

  const privateRejectedSamples = input.rejected
    .filter((r) => r.rejectionReason === "private_access")
    .slice(0, 20)
    .map((r) => ({ name: r.name, sourceKey: r.sourceKey, rawTypeLabel: r.rawTypeLabel }));

  const privateRejectedCount = input.rejected.filter((r) => r.rejectionReason === "private_access").length;
  const publicAccessBoostedCount = input.spots.filter((s) =>
    s.tagSignals.some((t) => t.includes("public_access") || t.includes("permissive"))
  ).length;
  const missingAccessAcceptedWithContextCount = input.spots.filter(
    (s) =>
      (s.category === "beach" || s.category === "swimming" || s.category === "swimming_hole") &&
      !s.tags.access &&
      s.parentContext?.relation !== "none"
  ).length;

  const remainingConcerns: string[] = [];
  for (const s of input.spots) {
    const dn = (s.displayName ?? s.name).trim().toLowerCase();
    if (["beach", "water", "natural feature", "natural_feature"].includes(dn)) {
      remainingConcerns.push(`accepted_generic_displayName:${s.sourceKey}:${dn}`);
    }
    if (s.nameQuality === "weak_generic" && !s.displayNameGenerated) {
      remainingConcerns.push(`weak_generic_not_renamed:${s.sourceKey}`);
    }
  }
  for (const r of rejectedSwimmingBeachCandidates) {
    if (r.rejectionReason === "below_threshold") {
      remainingConcerns.push(`swimming_beach_below_threshold:${r.sourceKey}`);
    }
  }
  for (const s of input.spots) {
    if (s.childHighlights?.some((c) => c.type === "viewpoint") && s.primaryAnchor?.anchorType === "area_center") {
      remainingConcerns.push(`parent_has_viewpoint_no_anchor:${s.sourceKey}`);
    }
  }

  return {
    swimmingAndBeach: {
      acceptedSwimming,
      acceptedBeaches,
      rejectedSwimmingBeachCandidates,
      privateSwimmingBeachRejected,
      generatedBeachNames,
    },
    anchors: {
      parentSpotsWithAnchors,
      anchorTypes,
      areaCenterFallbacks: areaCenterFallbacks.slice(0, 10),
      viewpointAnchoredParents: viewpointAnchoredParents.slice(0, 10),
      waterfallAnchoredParents: waterfallAnchoredParents.slice(0, 10),
      swimmingAnchoredParents: swimmingAnchoredParents.slice(0, 10),
      beachAnchoredParents: beachAnchoredParents.slice(0, 10),
    },
    names: {
      generatedNamesCount: input.spots.filter((s) => s.displayNameGenerated).length,
      weakGenericAcceptedCount: weakGenericAcceptedSamples.length,
      weakGenericAcceptedSamples,
      generatedNameSamples,
      nameOnlyRejectedSamples,
    },
    access: {
      privateRejectedCount,
      publicAccessBoostedCount,
      missingAccessAcceptedWithContextCount,
      privateRejectedSamples,
    },
    remainingConcerns,
  };
}
