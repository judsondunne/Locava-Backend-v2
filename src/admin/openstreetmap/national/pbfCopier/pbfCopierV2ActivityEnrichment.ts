/**
 * Evidence-based secondary activity enrichment for PBF Copier V2 preview docs.
 * Conservative: only adds activities with explicit OSM/support evidence.
 */
import {
  dedupeActivities,
  isLocavaActivity,
  normalizeActivity,
  type LocavaActivity,
} from "../../../../lib/inventory/activities/locavaActivities.js";
import { canonicalizePreviewDocActivities } from "./pbfCopierV2CanonicalActivities.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import type { PbfDestinationQualityCounters } from "./pbfCopierV2DestinationQuality.js";

export type ActivityEvidence = Record<string, string>;

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasSupportMeta(
  doc: PbfCopierPreviewDoc,
  key: keyof NonNullable<PbfCopierPreviewDoc["supportMetadata"]>
): boolean {
  const list = doc.supportMetadata?.[key];
  return Boolean(list && list.length > 0);
}

function isSwimmingContext(tags: Record<string, string>): boolean {
  if (tag(tags, "swimming") === "yes" || tag(tags, "bathing") === "yes") return true;
  if (tag(tags, "leisure") === "swimming_area" || tag(tags, "sport") === "swimming") return true;
  return false;
}

function addCanonical(
  acts: LocavaActivity[],
  evidence: ActivityEvidence,
  activity: string,
  reason: string
): boolean {
  const norm = normalizeActivity(activity);
  if (!norm || acts.includes(norm)) return false;
  acts.push(norm);
  evidence[norm] = reason;
  return true;
}

function deriveEnrichedActivities(doc: PbfCopierPreviewDoc): {
  activities: LocavaActivity[];
  activityEvidence?: ActivityEvidence;
  enriched: boolean;
} {
  const tags = doc.sourceTagSample ?? {};
  const base = dedupeActivities(
    [...(doc.activities ?? []), doc.primaryActivity].filter((a): a is string => Boolean(a))
  );
  const acts: LocavaActivity[] = [...base];
  const evidence: ActivityEvidence = { ...(doc.activityEvidence ?? {}) };
  let enriched = false;

  const primary = doc.primaryActivity ? normalizeActivity(doc.primaryActivity) : acts[0] ?? null;

  if (primary === "hiking" || primary === "trail" || doc.primaryCategory === "hiking") {
    if (!acts.includes("hiking")) acts.unshift("hiking");
    if (hasSupportMeta(doc, "viewpoints")) enriched = addCanonical(acts, evidence, "view", "supportMetadata.viewpoints") || enriched;
    if (hasSupportMeta(doc, "waterfalls")) enriched = addCanonical(acts, evidence, "waterfall", "supportMetadata.waterfalls") || enriched;
    if (tag(tags, "tourism") === "viewpoint") {
      enriched = addCanonical(acts, evidence, "view", "tourism=viewpoint on route") || enriched;
    }
    if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") {
      enriched = addCanonical(acts, evidence, "waterfall", "waterfall tag on corridor") || enriched;
    }
    const bicycle = tag(tags, "bicycle");
    const foot = tag(tags, "foot");
    if (bicycle && ["yes", "designated"].includes(bicycle) && foot !== "no") {
      enriched = addCanonical(acts, evidence, "biking", `bicycle=${bicycle}`) || enriched;
    }
    if (tag(tags, "horse") && ["yes", "designated"].includes(tag(tags, "horse")!)) {
      enriched = addCanonical(acts, evidence, "riding", `horse=${tag(tags, "horse")}`) || enriched;
    }
  }

  if (primary === "peak" || tag(tags, "natural") === "peak") {
    if (!acts.includes("hiking")) acts.unshift("hiking");
    if (tag(tags, "tourism") === "viewpoint") {
      enriched = addCanonical(acts, evidence, "view", "peak tourism=viewpoint") || enriched;
    }
  }

  if (primary === "view" || tag(tags, "tourism") === "viewpoint") {
    if (!acts.includes("view")) acts.unshift("view");
    if (
      doc.attachedToRouteId ||
      doc.destinationGroupId ||
      tag(tags, "highway") === "path" ||
      tag(tags, "highway") === "footway"
    ) {
      enriched = addCanonical(acts, evidence, "hiking", "viewpoint on trail/park corridor") || enriched;
    }
  }

  if (primary === "waterfall" || tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") {
    if (!acts.includes("waterfall")) acts.unshift("waterfall");
    if (doc.attachedToRouteId || doc.destinationGroupId) {
      enriched = addCanonical(acts, evidence, "hiking", "waterfall on trail corridor") || enriched;
    }
    if (isSwimmingContext(tags)) {
      enriched = addCanonical(acts, evidence, "swimming", "swimming/bathing tags") || enriched;
    }
  }

  if (primary === "beach" || tag(tags, "natural") === "beach") {
    if (!acts.includes("beach")) acts.unshift("beach");
    if (isSwimmingContext(tags)) {
      enriched = addCanonical(acts, evidence, "swimming", "beach swimming tags") || enriched;
    }
  }

  if (tag(tags, "water") === "lake" || tag(tags, "water") === "pond" || tag(tags, "water") === "reservoir") {
    enriched = addCanonical(acts, evidence, "lake", `water=${tag(tags, "water")}`) || enriched;
  }

  if (doc.primaryActivity === "train_bridge") {
    enriched = addCanonical(acts, evidence, "bridge", "train bridge over water") || enriched;
    enriched = addCanonical(acts, evidence, "view", "train bridge scenic context") || enriched;
  }

  const finalActs = dedupeActivities(acts.filter((a) => isLocavaActivity(a)));
  const keptPrimary = primary && isLocavaActivity(primary) ? primary : finalActs[0] ?? primary;

  return {
    activities:
      keptPrimary && !finalActs.includes(keptPrimary as LocavaActivity)
        ? dedupeActivities([keptPrimary, ...finalActs])
        : finalActs,
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
  return canonicalizePreviewDocActivities({
    ...doc,
    activities: result.activities,
    activityEvidence: result.activityEvidence,
  });
}
