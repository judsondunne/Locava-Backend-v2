import {
  dryRunPreviewCapFromQuotas,
  isQuotaMode,
  quotaNeedsMoreRoutes,
  quotaNeedsMoreSpots,
  shouldStopForDryRunQuotas,
} from "./pbfCopierDryRunQuotas.js";
import { isGeoFilterExhaustiveMode } from "./pbfCopierGeoFilter.js";
import type {
  PbfCopierConfig,
  PbfCopierMetrics,
  PbfCopierRun,
} from "./pbfCopierTypes.js";

export type BalancedPreviewState = {
  nodeSpotPreviews: number;
  waySpotPreviews: number;
  routePreviews: number;
  wayCandidatesFound: number;
  relationCandidatesFound: number;
};

export function emptyBalancedPreviewState(): BalancedPreviewState {
  return {
    nodeSpotPreviews: 0,
    waySpotPreviews: 0,
    routePreviews: 0,
    wayCandidatesFound: 0,
    relationCandidatesFound: 0,
  };
}

export function isBalancedPreviewMode(config: PbfCopierConfig, mode: PbfCopierRun["mode"]): boolean {
  if (mode === "fast_dry_run") return false;
  if (config.maxAcceptedMode !== false) return false;
  return config.balancedPreview !== false;
}

export function isMaxAcceptedMode(config: PbfCopierConfig): boolean {
  if (config.dryRunStopMode === "quotas") return false;
  return config.maxAcceptedMode !== false;
}

/** Route preview slots reserved in max-accepted mode so trails are not skipped. */
export function maxAcceptedRouteReserve(config: PbfCopierConfig): number {
  if (!config.includeRoutes) return 0;
  const limit = Math.max(1, config.dryRunLimit);
  const reserved = Math.max(1, Math.min(Math.floor(limit * 0.25), 250));
  return Math.min(reserved, Math.max(1, limit - 1));
}

export function maxAcceptedSpotBudget(config: PbfCopierConfig): number {
  return Math.max(0, config.dryRunLimit - maxAcceptedRouteReserve(config));
}

function spotPreviewCount(previewState: BalancedPreviewState): number {
  return previewState.nodeSpotPreviews + previewState.waySpotPreviews;
}

export function totalAcceptedPreviewCount(metrics: PbfCopierMetrics): number {
  return metrics.docsPreviewed;
}

export function hasReachedMaxAccepted(run: PbfCopierRun): boolean {
  return totalAcceptedPreviewCount(run.metrics) >= run.config.dryRunLimit;
}

/** Max node spot previews collected before ways section is reached. */
export function nodePhasePreviewCap(config: PbfCopierConfig): number {
  return config.dryRunNodePhaseCap ?? Math.min(15, Math.max(5, Math.floor(config.dryRunLimit * 0.2)));
}

export function canCollectSpotPreview(input: {
  config: PbfCopierConfig;
  mode: PbfCopierRun["mode"];
  metrics: PbfCopierMetrics;
  previewState: BalancedPreviewState;
  osmType: "node" | "way" | "relation";
  totalPreviewDocs: number;
  quotaProgress?: Record<string, number>;
}): boolean {
  const { config, mode, metrics, previewState, osmType, totalPreviewDocs } = input;
  if (isGeoFilterExhaustiveMode(config)) return true;

  if (isQuotaMode(config)) {
    const quotas = config.dryRunQuotas ?? {};
    const progress = input.quotaProgress ?? {};
    if (!quotaNeedsMoreSpots(quotas, progress)) return false;
    const previewCap = dryRunPreviewCapFromQuotas(quotas, config.dryRunLimit);
    if (totalPreviewDocs >= previewCap) return false;
    return true;
  }

  if (isMaxAcceptedMode(config)) {
    const spotBudget = maxAcceptedSpotBudget(config);
    if (spotPreviewCount(previewState) >= spotBudget) return false;
    if (totalPreviewDocs >= config.dryRunLimit) return false;
    if (metrics.waysScanned === 0 && osmType === "node") {
      const nodeCap = Math.min(nodePhasePreviewCap(config), spotBudget);
      return previewState.nodeSpotPreviews < nodeCap;
    }
    return true;
  }

  if (totalPreviewDocs >= config.dryRunLimit) return false;

  if (!isBalancedPreviewMode(config, mode)) return true;

  if (metrics.waysScanned === 0 && osmType === "node") {
    return previewState.nodeSpotPreviews < nodePhasePreviewCap(config);
  }

  if (osmType === "node") {
    const cap = config.dryRunNodeSpotLimit ?? Math.floor(config.dryRunLimit * 0.55);
    return previewState.nodeSpotPreviews < cap;
  }
  if (osmType === "way") {
    const cap = config.dryRunWaySpotLimit ?? Math.floor(config.dryRunLimit * 0.25);
    return previewState.waySpotPreviews < cap;
  }
  const cap = config.dryRunWaySpotLimit ?? Math.floor(config.dryRunLimit * 0.25);
  return previewState.waySpotPreviews < cap;
}

export function canCollectRoutePreview(input: {
  config: PbfCopierConfig;
  mode: PbfCopierRun["mode"];
  previewState: BalancedPreviewState;
  totalPreviewDocs: number;
  quotaProgress?: Record<string, number>;
}): boolean {
  const { config, mode, previewState, totalPreviewDocs } = input;
  if (isGeoFilterExhaustiveMode(config)) return true;

  if (isQuotaMode(config)) {
    const quotas = config.dryRunQuotas ?? {};
    const progress = input.quotaProgress ?? {};
    if (!quotaNeedsMoreRoutes(quotas, progress)) return false;
    const previewCap = dryRunPreviewCapFromQuotas(quotas, config.dryRunLimit);
    if (totalPreviewDocs >= previewCap) return false;
    return true;
  }

  if (isMaxAcceptedMode(config)) {
    const routeReserve = maxAcceptedRouteReserve(config);
    if (previewState.routePreviews >= routeReserve) return false;
    if (totalPreviewDocs >= config.dryRunLimit) return false;
    return true;
  }

  if (totalPreviewDocs >= config.dryRunLimit) return false;
  if (!isBalancedPreviewMode(config, mode)) return true;
  const cap = config.dryRunRouteLimit ?? Math.floor(config.dryRunLimit * 0.25);
  return previewState.routePreviews < cap;
}

export function shouldStopDryRunScan(
  run: PbfCopierRun,
  previewState: BalancedPreviewState,
  fileEnded = false,
  quotaProgress: Record<string, number> = {}
): boolean {
  if (run.mode !== "dry_run_preview" && run.mode !== "fast_dry_run") return false;

  // Region bbox mode: scan the entire file and collect every accepted feature in the viewport.
  if (isGeoFilterExhaustiveMode(run.config)) return false;

  if (isQuotaMode(run.config)) {
    return shouldStopForDryRunQuotas(run, quotaProgress);
  }

  if (isMaxAcceptedMode(run.config)) {
    if (!fileEnded) return false;
    return hasReachedMaxAccepted(run);
  }

  if (!isBalancedPreviewMode(run.config, run.mode)) {
    return hasReachedMaxAccepted(run);
  }

  const requireWays = run.config.requireWaysBeforeStop !== false;
  const minWayCandidates = run.config.minWayCandidatesBeforeStop ?? 5;

  if (requireWays && run.metrics.waysScanned === 0 && !fileEnded) return false;
  if (requireWays && previewState.wayCandidatesFound < minWayCandidates && !fileEnded) return false;

  return run.previewDocs.length >= run.config.dryRunLimit;
}
