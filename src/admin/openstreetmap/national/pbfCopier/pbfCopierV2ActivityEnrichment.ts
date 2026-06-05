/**
 * Evidence-based secondary activity enrichment for PBF Copier V2 preview docs.
 */
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import type { PbfDestinationQualityCounters } from "./pbfCopierV2DestinationQuality.js";

export type ActivityEvidence = Record<string, string>;

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function uniqActivities(acts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of acts) {
    const key = a.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function hasSupportMeta(
  doc: PbfCopierPreviewDoc,
  key: keyof NonNullable<PbfCopierPreviewDoc["supportMetadata"]>
): boolean {
  const list = doc.supportMetadata?.[key];
  return Boolean(list && list.length > 0);
}

function isSwimmingContext(tags: Record<string, string>, name: string): boolean {
  if (tag(tags, "swimming") === "yes" || tag(tags, "bathing") === "yes") return true;
  if (tag(tags, "leisure") === "swimming_area" || tag(tags, "sport") === "swimming") return true;
  if (/\b(swimming area|swim area|swimming hole|bathing)\b/i.test(name)) return true;
  return false;
}

function deriveEnrichedActivities(doc: PbfCopierPreviewDoc): {
  activities: string[];
  activityEvidence?: ActivityEvidence;
  enriched: boolean;
} {
  const tags = doc.sourceTagSample ?? {};
  const primary = (doc.primaryActivity || "").trim().toLowerCase();
  const acts = uniqActivities([...(doc.activities ?? []), primary].filter(Boolean));
  const evidence: ActivityEvidence = {};
  let enriched = false;

  const add = (activity: string, reason: string) => {
    if (!activity || acts.includes(activity)) return;
    acts.push(activity);
    evidence[activity] = reason;
    enriched = true;
  };

  if (primary && !acts.includes(primary)) acts.unshift(primary);

  if (primary === "hiking" || primary === "trail" || doc.primaryCategory === "hiking") {
    if (!acts.includes("hiking")) acts.unshift("hiking");
    if (hasSupportMeta(doc, "viewpoints")) add("sightseeing", "supportMetadata.viewpoints");
    if (hasSupportMeta(doc, "waterfalls")) add("waterfall", "supportMetadata.waterfalls");
    if (tag(tags, "tourism") === "viewpoint") add("sightseeing", "tourism=viewpoint");
    if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") {
      add("waterfall", "waterfall tag on corridor");
    }
    const bicycle = tag(tags, "bicycle");
    const foot = tag(tags, "foot");
    if (bicycle && ["yes", "designated"].includes(bicycle) && foot !== "no") {
      add("biking", `bicycle=${bicycle}`);
    }
    if (tag(tags, "horse") && ["yes", "designated"].includes(tag(tags, "horse")!)) {
      add("horseback", `horse=${tag(tags, "horse")}`);
    }
  }

  if (primary === "peak" || tag(tags, "natural") === "peak") {
    if (!acts.includes("hiking")) acts.unshift("hiking");
    if (tag(tags, "tourism") === "viewpoint" || /\b(lookout|overlook|scenic)\b/i.test(doc.displayName || "")) {
      add("sightseeing", "peak viewpoint/scenic context");
    }
  }

  if (primary === "viewpoint" || tag(tags, "tourism") === "viewpoint") {
    if (!acts.includes("viewpoint")) acts.unshift("viewpoint");
    if (!acts.includes("sightseeing")) acts.push("sightseeing");
    if (
      doc.attachedToRouteId ||
      doc.destinationGroupId ||
      tag(tags, "highway") === "path" ||
      tag(tags, "highway") === "footway"
    ) {
      add("hiking", "viewpoint on trail/park corridor");
    }
  }

  if (primary === "waterfall" || tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") {
    if (!acts.includes("waterfall")) acts.unshift("waterfall");
    if (doc.attachedToRouteId || doc.destinationGroupId) add("hiking", "waterfall on trail corridor");
    if (isSwimmingContext(tags, doc.displayName || "")) add("swimming", "swimming/bathing tags or name");
  }

  if (primary === "beach" || tag(tags, "natural") === "beach") {
    if (!acts.includes("beach")) acts.unshift("beach");
    if (isSwimmingContext(tags, doc.displayName || "")) add("swimming", "beach swimming context");
  }

  if (primary === "train_bridge") {
    if (!acts.includes("train_bridge")) acts.unshift("train_bridge");
    if (!acts.includes("sightseeing")) acts.push("sightseeing");
  }

  const finalActs = uniqActivities(acts.filter((a) => a && a !== "osm" && !a.startsWith("railway=")));
  const keptPrimary = primary && !primary.startsWith("railway=") ? primary : finalActs[0] ?? primary;

  return {
    activities: keptPrimary && !finalActs.includes(keptPrimary) ? [keptPrimary, ...finalActs] : finalActs,
    activityEvidence: Object.keys(evidence).length ? evidence : undefined,
    enriched,
  };
}

export function enrichActivities(
  doc: PbfCopierPreviewDoc,
  counters?: PbfDestinationQualityCounters
): PbfCopierPreviewDoc {
  const result = deriveEnrichedActivities(doc);
  if (counters) {
    if (result.enriched) counters.activitiesEnrichedWithEvidence += 1;
    else counters.activitiesSkippedNoEvidence += 1;
  }
  return {
    ...doc,
    activities: result.activities,
    activityEvidence: result.activityEvidence,
  };
}
