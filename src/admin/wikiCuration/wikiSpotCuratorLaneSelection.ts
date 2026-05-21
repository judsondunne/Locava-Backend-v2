import type { WikiCuratorPromptCandidate } from "./wikiSpotCuratorPrompt.js";
import type { WikiSpotCuratorDecisionRow } from "./wikiSpotCurator.schema.js";
import { primaryImageFingerprint } from "./wikiSpotCuratorPostProcess.js";
import type { BackendDistanceBucket } from "./wikiSpotCuratorGeo.js";

export type LaneSelectionOptions = {
  maxCorePostsPerSpot: number;
  maxContextPostsPerSpot: number;
  maxTotalPostsPerSpot: number;
  rejectPlaneViews: boolean;
  allowContextualFarRelevant: boolean;
  coreRadiusMeters: number;
  nearbyRadiusMeters: number;
  extendedContextRadiusMeters: number;
};

export type SelectionLane = "core" | "context" | "skipped" | "not_selected";

function compositeSortScore(d: WikiSpotCuratorDecisionRow): number {
  const vm = typeof d.visualMagnetScore === "number" ? d.visualMagnetScore : 5;
  const visit = d.visitWorthyScore;
  const visual = d.visualAppealScore;
  let pen = 0;
  if (d.viewType === "drone") pen += 0.35;
  if (d.viewType === "helicopter") pen += 0.2;
  if (d.viewType === "plane") pen += 50;
  return visit + vm + visual - pen;
}

function fingerprintForDedupe(post: WikiCuratorPromptCandidate | undefined, row: WikiSpotCuratorDecisionRow): string {
  if (!post) return row.postId;
  return (
    primaryImageFingerprint({
      media: post.media || [],
      primaryMediaIndex: post.primaryMediaIndex
    }) || `${post.title}|${row.postId}`
  );
}

/** Too far for any lane unless AI explicitly contextual from a boat etc. */
function publishLaneForRow(
  row: WikiSpotCuratorDecisionRow,
  meters: number | null,
  backendBucket: BackendDistanceBucket,
  opts: LaneSelectionOptions
): "core" | "context" | "reject" {
  const lr = row.locationRelation;
  if (lr === "wrong_place" || lr === "too_far_or_wrong") return "reject";

  if (!opts.allowContextualFarRelevant) {
    if (meters != null && meters > opts.extendedContextRadiusMeters) return "reject";
    return "core";
  }

  if (meters != null && meters > opts.extendedContextRadiusMeters) {
    if (
      lr === "contextual_view" ||
      lr === "broader_area" ||
      lr === "extended_context" ||
      lr === "far_but_relevant"
    )
      return "context";
    return "reject";
  }

  if (meters != null && meters <= opts.coreRadiusMeters) return "core";
  if (lr === "exact" || lr === "nearby" || lr === "core") {
    if (meters == null || meters <= opts.nearbyRadiusMeters) return "core";
  }
  if (meters != null && meters <= opts.nearbyRadiusMeters) return "core";

  if (opts.allowContextualFarRelevant) {
    if (
      lr === "contextual_view" ||
      lr === "broader_area" ||
      lr === "extended_context" ||
      lr === "far_but_relevant"
    )
      return "context";
    if (meters != null && meters > opts.nearbyRadiusMeters && meters <= opts.extendedContextRadiusMeters) {
      return "context";
    }
    if (backendBucket === "extended_context") return "context";
  }

  if (meters == null && (lr === "unclear" || lr === "nearby" || lr === "exact" || lr === "core")) return "core";

  return "core";
}

/**
 * After Gemini: enforce plane skip, dedupe, core/context caps and max total.
 * Mutates decision rows (demotes publish → skip with concerns).
 */
export function enforceLaneSelectionAndDedupe(
  decisions: WikiSpotCuratorDecisionRow[],
  postsById: Map<string, WikiCuratorPromptCandidate>,
  opts: LaneSelectionOptions
): WikiSpotCuratorDecisionRow[] {
  const out = decisions.map((d) => ({ ...d }));

  for (const row of out) {
    row.selectionLane = row.selectionLane ?? "not_selected";
    row.countsAgainstCoreMax = row.countsAgainstCoreMax ?? false;
    row.curationWarnings = row.curationWarnings ?? [];
    const post = postsById.get(row.postId);
    const hints = post?.detectedViewHints;

    if (opts.rejectPlaneViews && (row.viewType === "plane" || hints?.planeLikely)) {
      if (row.decision === "publish") {
        row.decision = "skip";
        row.shouldUseInFinalSpotSet = false;
        row.selectionLane = "skipped";
        row.countsAgainstCoreMax = false;
        row.concerns = [
          ...row.concerns,
          hints?.planeLikely
            ? "Metadata suggests commercial airplane / high-altitude passenger view — skipped by policy."
            : "viewType=plane — skipped by policy (no commercial flight window shots)."
        ];
      }
    }
  }

  const publishPool = out.filter((d) => d.decision === "publish");
  const fpSeen = new Set<string>();
  for (const row of [...publishPool].sort((a, b) => compositeSortScore(b) - compositeSortScore(a) || a.postId.localeCompare(b.postId))) {
    const post = postsById.get(row.postId);
    const fp = fingerprintForDedupe(post, row);
    if (fpSeen.has(fp)) {
      row.decision = "skip";
      row.shouldUseInFinalSpotSet = false;
      row.selectionLane = "skipped";
      row.countsAgainstCoreMax = false;
      row.concerns = [...row.concerns, "Near-duplicate scene vs a higher-scoring selected candidate (server dedupe)."];
    } else {
      fpSeen.add(fp);
    }
  }

  const stillPublish = out.filter((d) => d.decision === "publish");
  const laneMeta = new Map<
    string,
    { lane: "core" | "context" | "reject"; composite: number; meters: number | null; backend: BackendDistanceBucket }
  >();

  for (const row of stillPublish) {
    const meters = row.distanceMetersFromAnchor ?? null;
    const backend = (row.backendDistanceBucket || "unclear") as BackendDistanceBucket;
    const lane = publishLaneForRow(row, meters, backend, opts);
    laneMeta.set(row.postId, { lane, composite: compositeSortScore(row), meters, backend });
  }

  for (const row of out) {
    if (row.decision !== "publish") {
      if (!row.selectionLane || row.selectionLane === "not_selected") row.selectionLane = "skipped";
      row.shouldUseInFinalSpotSet = false;
      row.countsAgainstCoreMax = false;
      continue;
    }
    const meta = laneMeta.get(row.postId);
    if (!meta || meta.lane === "reject") {
      row.decision = "skip";
      row.shouldUseInFinalSpotSet = false;
      row.selectionLane = "skipped";
      row.countsAgainstCoreMax = false;
      row.concerns = [
        ...row.concerns,
        meta?.lane === "reject"
          ? "Beyond extended context radius or wrong_place — not counted as publish."
          : "Could not assign selection lane — not counted as publish."
      ];
    }
  }

  const publishCandidates = out
    .filter((d) => d.decision === "publish")
    .sort((a, b) => compositeSortScore(b) - compositeSortScore(a) || a.postId.localeCompare(b.postId));

  const cores = publishCandidates.filter((d) => laneMeta.get(d.postId)?.lane === "core");
  const contexts = publishCandidates.filter((d) => laneMeta.get(d.postId)?.lane === "context");

  const picked = new Set<string>();

  for (const row of cores) {
    if (picked.size >= opts.maxTotalPostsPerSpot) break;
    if ([...picked].filter((id) => laneMeta.get(id)?.lane === "core").length >= opts.maxCorePostsPerSpot) break;
    picked.add(row.postId);
  }

  for (const row of contexts) {
    if (picked.size >= opts.maxTotalPostsPerSpot) break;
    const ctxCount = [...picked].filter((id) => laneMeta.get(id)?.lane === "context").length;
    if (ctxCount >= opts.maxContextPostsPerSpot) break;
    picked.add(row.postId);
  }

  for (const row of out) {
    if (row.decision !== "publish") continue;
    if (!picked.has(row.postId)) {
      row.decision = "skip";
      row.shouldUseInFinalSpotSet = false;
      row.selectionLane = "skipped";
      row.countsAgainstCoreMax = false;
      row.concerns = [
        ...row.concerns,
        "Not selected after core/context lane quotas and maxTotalPostsPerSpot (server selection)."
      ];
    } else {
      const meta = laneMeta.get(row.postId)!;
      const lane = meta.lane;
      if (lane === "core" || lane === "context") {
        row.selectionLane = lane;
        row.shouldUseInFinalSpotSet = true;
        row.countsAgainstCoreMax = lane === "core";
        if (lane === "context" && metersNeedsReason(meta.meters, row)) {
          row.reasons = [
            ...row.reasons,
            "Context lane: strong visuals that sell the wider visit experience even though the camera is farther from the spot anchor."
          ];
        }
      }
    }
  }

  return out;
}

function metersNeedsReason(meters: number | null, row: WikiSpotCuratorDecisionRow): boolean {
  if (meters == null) return false;
  const lr = row.locationRelation;
  return (
    meters > 1500 ||
    lr === "contextual_view" ||
    lr === "broader_area" ||
    lr === "extended_context" ||
    lr === "far_but_relevant"
  );
}

export function buildCurationInspectionWarnings(
  decisions: WikiSpotCuratorDecisionRow[],
  postsById: Map<string, WikiCuratorPromptCandidate>
): Array<{ postId: string; message: string }> {
  const warnings: Array<{ postId: string; message: string }> = [];
  const genericRe = /\bgeneric\b|\bdistant\b.*\bgeneric\b/i;
  for (const d of decisions) {
    const vm = typeof d.visualMagnetScore === "number" ? d.visualMagnetScore : 0;
    if (d.decision === "skip" && vm >= 8) {
      warnings.push({
        postId: d.postId,
        message: "High visual magnet skipped — inspect decision."
      });
    }
    const concernsJoined = (d.concerns || []).join(" ");
    if (d.decision === "skip" && genericRe.test(concernsJoined)) {
      const post = postsById.get(d.postId);
      const nMedia = post?.media?.length ?? 0;
      if (nMedia >= 2 || (post?.media?.length === 1 && (post.media[0]?.width ?? 0) >= 1200)) {
        warnings.push({
          postId: d.postId,
          message: 'Skip rationale mentions "generic" but candidate has rich media — inspect.'
        });
      }
    }
  }
  return dedupeWarn(warnings);
}

function dedupeWarn(w: Array<{ postId: string; message: string }>): Array<{ postId: string; message: string }> {
  const seen = new Set<string>();
  const out: Array<{ postId: string; message: string }> = [];
  for (const x of w) {
    const k = `${x.postId}:${x.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
