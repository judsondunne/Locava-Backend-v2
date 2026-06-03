import type { PbfCopierMetrics, PbfCopierRun } from "./pbfCopierTypes.js";

export type ScanQualityBadgeId =
  | "shallow_node_only_scan"
  | "partial_scan_reached_ways"
  | "full_file_scan"
  | "accepted_limit_reached"
  | "scan_cap_hit"
  | "file_ended";

export type ScanQualityAssessment = {
  badgeId: ScanQualityBadgeId;
  badgeLabel: string;
  stopReason: string;
  warnings: string[];
  /** True when byte progress from the parser should not be shown as 0%. */
  byteProgressUnavailable: boolean;
};

const BADGE_LABELS: Record<ScanQualityBadgeId, string> = {
  shallow_node_only_scan: "Shallow node-only scan",
  partial_scan_reached_ways: "Partial scan reached ways",
  full_file_scan: "Full file scan",
  accepted_limit_reached: "Accepted preview limit reached",
  scan_cap_hit: "Scan cap hit",
  file_ended: "File ended",
};

export function computeScanQualityAssessment(input: {
  metrics: PbfCopierMetrics;
  dryRunLimitReached: boolean;
  rawScanLimitReached: boolean;
  fileEnded: boolean;
  maxRawObjectsToScan: number | null;
  mode: PbfCopierRun["mode"];
  maxAcceptedMode?: boolean;
  dryRunLimit?: number;
  dryRunStopMode?: PbfCopierRun["config"]["dryRunStopMode"];
}): ScanQualityAssessment {
  const { metrics } = input;
  const warnings: string[] = [];
  const byteProgressUnavailable =
    metrics.fileBytesTotal <= 0 ||
    (metrics.rawObjectsScanned > 0 && metrics.fileBytesRead <= 0);

  if (input.rawScanLimitReached && metrics.waysScanned === 0) {
    warnings.push(
      "Node scan cap hit before ways were reached. The scan is still reading forward through remaining nodes to reach trails and routes. Clear the cap for a faster full scan."
    );
  } else if (input.rawScanLimitReached) {
    warnings.push(
      "Node scan cap was hit; only the first " +
        (input.maxRawObjectsToScan != null ? input.maxRawObjectsToScan.toLocaleString() : "N") +
        " nodes were evaluated. Ways and relations were still scanned."
    );
  }

  if (metrics.waysScanned === 0 && metrics.rawObjectsScanned > 0) {
    warnings.push(
      "Warning: no ways scanned. Parks, beaches, waterfalls, trails, roads, and route geometry may not have been reached."
    );
  } else if (metrics.relationsScanned === 0 && metrics.waysScanned > 0) {
    warnings.push(
      "No relations scanned yet. Some route/network features may not have been reached."
    );
  }

  let badgeId: ScanQualityBadgeId;
  let stopReason: string;

  if (input.dryRunLimitReached) {
    badgeId = "accepted_limit_reached";
    if (input.dryRunStopMode === "quotas") {
      stopReason = "Stopped after filling all activity/category quotas. Rejection counts reflect everything scanned before stop.";
    } else if (input.maxAcceptedMode) {
      stopReason = `Stopped after finding ${(input.dryRunLimit ?? 0).toLocaleString()} accepted spot(s)/route(s). Rejection counts reflect everything scanned before stop.`;
    } else {
      stopReason = "Stopped after reaching the dry-run accepted preview limit.";
    }
  } else if (input.rawScanLimitReached) {
    badgeId = metrics.waysScanned === 0 ? "shallow_node_only_scan" : "scan_cap_hit";
    stopReason =
      metrics.waysScanned === 0
        ? "Node scan cap hit before ways were reached — still reading forward to ways."
        : input.maxRawObjectsToScan != null
          ? `Node scan cap hit after ${input.maxRawObjectsToScan.toLocaleString()} nodes; ways/relations still scanned.`
          : "Node scan cap hit; ways/relations still scanned.";
  } else if (input.fileEnded) {
    badgeId = metrics.waysScanned > 0 ? "full_file_scan" : "shallow_node_only_scan";
    stopReason = "Reached end of PBF file.";
    if (metrics.waysScanned === 0) {
      badgeId = "shallow_node_only_scan";
      stopReason = "Reached end of file but only node records were present in this extract.";
    } else if (metrics.relationsScanned === 0) {
      badgeId = "partial_scan_reached_ways";
    } else {
      badgeId = "full_file_scan";
    }
  } else {
    badgeId = metrics.waysScanned > 0 ? "partial_scan_reached_ways" : "shallow_node_only_scan";
    stopReason = "Scan stopped before end of file.";
  }

  // Prefer the most specific shallow warning when ways never appeared.
  if (metrics.waysScanned === 0 && input.rawScanLimitReached) {
    badgeId = "shallow_node_only_scan";
  }

  if (input.mode === "fast_dry_run") {
    stopReason += " (fast smoke test — not a quality preview).";
  }

  return {
    badgeId,
    badgeLabel: BADGE_LABELS[badgeId],
    stopReason,
    warnings,
    byteProgressUnavailable,
  };
}
