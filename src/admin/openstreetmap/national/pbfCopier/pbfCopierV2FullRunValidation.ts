import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import type { PbfV2FullRunRecord } from "./pbfCopierV2FullRunTypes.js";

function tag(doc: PbfCopierPreviewDoc, key: string): string | undefined {
  return doc.sourceTagSample?.[key]?.trim().toLowerCase();
}

export function buildFullRunValidationWarnings(
  run: PbfV2FullRunRecord,
  visibleSample: PbfCopierPreviewDoc[]
): string[] {
  const warnings: string[] = [];
  const dq = run.stats.destinationQuality;

  const trainBridges = visibleSample.filter((d) => d.primaryActivity === "train_bridge").length;
  const unmarkedHiking = dq.finalRescuedUnmarkedHikingTrails + dq.unnamedHikingTrailsIncluded;
  const visibleTrafficSignals = visibleSample.filter((d) => tag(d, "highway") === "traffic_signals").length;
  const visibleLevelCrossing = visibleSample.filter((d) => tag(d, "railway") === "level_crossing").length;
  const visibleResidential = visibleSample.filter(
    (d) => tag(d, "landuse") === "residential" || tag(d, "building") === "warehouse"
  ).length;
  const missingMarkers = visibleSample.filter(
    (d) =>
      (d.kind === "unexplored_route" || d.primaryActivity === "train_bridge") &&
      !d.routeMarkerCoordinate &&
      d.lat == null
  ).length;

  if (trainBridges === 0 && run.stats.chunksProcessed > 2) {
    warnings.push("train_bridge count is 0 in visible sample — verify rail bridges in Vermont extract");
  }
  if (unmarkedHiking === 0 && run.stats.chunksProcessed > 2) {
    warnings.push("unmarked hiking trail rescues are 0 — verify trail coverage");
  }
  if (visibleTrafficSignals > 0) warnings.push(`visible highway=traffic_signals: ${visibleTrafficSignals}`);
  if (visibleLevelCrossing > 0) warnings.push(`visible railway=level_crossing: ${visibleLevelCrossing}`);
  if (visibleResidential > 0) warnings.push(`visible residential/warehouse junk: ${visibleResidential}`);
  if (missingMarkers > 0) warnings.push(`visible routes/bridges missing marker coordinates: ${missingMarkers}`);

  return warnings;
}

export function sampleVisibleByCategory(items: PbfCopierPreviewDoc[], limitPer = 3): Record<string, PbfCopierPreviewDoc[]> {
  const buckets: Record<string, PbfCopierPreviewDoc[]> = {};
  const assign = (key: string, doc: PbfCopierPreviewDoc) => {
    const list = buckets[key] ?? [];
    if (list.length >= limitPer) return;
    list.push(doc);
    buckets[key] = list;
  };

  for (const doc of items) {
    if (doc.filteredOut) continue;
    const act = doc.primaryActivity || doc.primaryCategory || "other";
    if (act === "hiking" || act === "trail") assign("hiking_trails", doc);
    else if (act === "train_bridge") assign("train_bridges", doc);
    else if (["restaurant", "cafe", "bar", "bakery"].includes(act)) assign("food_drink", doc);
    else if (doc.primaryCategory === "shop" || act.startsWith("shop")) assign("shops", doc);
    else if (act === "viewpoint") assign("viewpoints", doc);
    else if (act === "waterfall") assign("waterfalls", doc);
    else if (act === "beach" || act === "swimming") assign("beaches_swimming", doc);
    else if (act === "peak") assign("peaks", doc);
    else if (["park", "hiking", "nature_reserve"].includes(doc.primaryCategory)) assign("parks_outdoor", doc);
    else assign("other", doc);
  }
  return buckets;
}
