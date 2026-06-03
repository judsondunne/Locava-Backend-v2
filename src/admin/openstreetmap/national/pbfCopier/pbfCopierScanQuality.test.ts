import { describe, expect, it } from "vitest";
import { computeScanQualityAssessment } from "./pbfCopierScanQuality.js";
import { emptyPbfCopierMetrics } from "./pbfCopierTypes.js";

describe("pbfCopierScanQuality", () => {
  it("warns when raw cap hit before ways were reached", () => {
    const assessment = computeScanQualityAssessment({
      metrics: {
        ...emptyPbfCopierMetrics(),
        rawObjectsScanned: 250000,
        nodesScanned: 250000,
        waysScanned: 0,
      },
      dryRunLimitReached: false,
      rawScanLimitReached: true,
      fileEnded: false,
      maxRawObjectsToScan: 250000,
      mode: "dry_run_preview",
    });
    expect(assessment.badgeId).toBe("shallow_node_only_scan");
    expect(assessment.warnings.some((w) => /before ways were reached/i.test(w))).toBe(true);
  });

  it("marks byte progress unavailable when objects scanned but bytes read is zero", () => {
    const assessment = computeScanQualityAssessment({
      metrics: {
        ...emptyPbfCopierMetrics(),
        fileBytesTotal: 45_000_000,
        fileBytesRead: 0,
        rawObjectsScanned: 1200,
        nodesScanned: 1200,
      },
      dryRunLimitReached: false,
      rawScanLimitReached: false,
      fileEnded: false,
      maxRawObjectsToScan: null,
      mode: "dry_run_preview",
    });
    expect(assessment.byteProgressUnavailable).toBe(true);
  });

  it("reports max accepted stop reason", () => {
    const assessment = computeScanQualityAssessment({
      metrics: {
        ...emptyPbfCopierMetrics(),
        rawObjectsScanned: 12000,
        nodesScanned: 12000,
        docsPreviewed: 100,
        rejectedByClassifier: 450,
      },
      dryRunLimitReached: true,
      rawScanLimitReached: false,
      fileEnded: false,
      maxRawObjectsToScan: null,
      mode: "dry_run_preview",
      maxAcceptedMode: true,
      dryRunLimit: 100,
    });
    expect(assessment.badgeId).toBe("accepted_limit_reached");
    expect(assessment.stopReason).toMatch(/100 accepted/);
    expect(assessment.stopReason).toMatch(/Rejection counts/);
  });

  it("reports accepted preview limit reached", () => {
    const assessment = computeScanQualityAssessment({
      metrics: {
        ...emptyPbfCopierMetrics(),
        rawObjectsScanned: 50000,
        nodesScanned: 40000,
        waysScanned: 10000,
        docsPreviewed: 50,
      },
      dryRunLimitReached: true,
      rawScanLimitReached: false,
      fileEnded: false,
      maxRawObjectsToScan: null,
      mode: "dry_run_preview",
    });
    expect(assessment.badgeId).toBe("accepted_limit_reached");
  });

  it("reports full file scan when ways were scanned and file ended", () => {
    const assessment = computeScanQualityAssessment({
      metrics: {
        ...emptyPbfCopierMetrics(),
        rawObjectsScanned: 90000,
        nodesScanned: 70000,
        waysScanned: 18000,
        relationsScanned: 2000,
      },
      dryRunLimitReached: false,
      rawScanLimitReached: false,
      fileEnded: true,
      maxRawObjectsToScan: null,
      mode: "dry_run_preview",
    });
    expect(assessment.badgeId).toBe("full_file_scan");
  });
});
