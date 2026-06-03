import type { PbfCopierConfig, PbfCopierMode } from "./pbfCopierTypes.js";
import { DEFAULT_PBF_COPIER_CONFIG } from "./pbfCopierTypes.js";
import {
  DEFAULT_GEO_FILTER_RADIUS_KM,
  HARTLAND_VT_CENTER,
} from "./pbfCopierGeoFilter.js";
import {
  DEFAULT_VERMONT_PBF_PATH,
  inferStateCodeFromFilePath,
} from "./pbfCopierPathHelpers.js";

/** Matches the admin page initial form state at /admin/openstreetmap/pbf-copier. */
export const PBF_COPIER_ADMIN_PAGE_DEFAULTS = {
  filePath: DEFAULT_VERMONT_PBF_PATH,
  dryRunStopMode: "max_accepted" as const,
  dryRunLimit: 100,
  maxRawObjectsToScan: null as number | null,
  classifyBatchSize: 1000,
  stateCode: "VT",
  includeSpots: true,
  includeRoutes: true,
  includePublicOnly: true,
  includeReviewDocs: false,
  skipExisting: true,
  fastSmokeRawCap: 250_000,
  fastSmokeAcceptedLimit: 5,
};

/** Matches "Run Vermont Full Dry-Run Preview" on the admin page. */
export const PBF_COPIER_VERMONT_FULL_DRY_RUN_DEFAULTS = {
  ...PBF_COPIER_ADMIN_PAGE_DEFAULTS,
  skipExisting: false,
};

/** Local review preset — up to 1,000 accepted preview docs, zero writes. */
export const PBF_COPIER_VERMONT_REVIEW_1000_DEFAULTS = {
  ...PBF_COPIER_VERMONT_FULL_DRY_RUN_DEFAULTS,
  dryRunLimit: 1000,
};

export type PublicPbfDryRunRequest = {
  filePath: string;
  acceptedLimit: number;
  maxRawObjectsToScan: number | null;
  mode: PbfCopierMode;
  config: Partial<PbfCopierConfig>;
};

export function buildPublicPbfDryRunRequest(input?: {
  preset?: "admin_page" | "vermont_full" | "vermont_review_1000" | "fast_smoke";
  filePath?: string;
  acceptedLimit?: number;
  maxAccepted?: number;
  maxRawObjectsToScan?: number | null;
  fast?: boolean;
  stateCode?: string;
  includeSpots?: boolean;
  includeRoutes?: boolean;
  includePublicOnly?: boolean;
  includeReviewDocs?: boolean;
  skipExisting?: boolean;
  classifyBatchSize?: number;
  geoFilterEnabled?: boolean;
  geoFilterCenterLat?: number | null;
  geoFilterCenterLng?: number | null;
  geoFilterRadiusKm?: number;
  geoFilterRadiusMiles?: number;
}): PublicPbfDryRunRequest {
  const preset = input?.preset ?? "vermont_full";
  const base =
    preset === "admin_page"
      ? PBF_COPIER_ADMIN_PAGE_DEFAULTS
      : preset === "vermont_review_1000"
        ? PBF_COPIER_VERMONT_REVIEW_1000_DEFAULTS
        : preset === "fast_smoke"
          ? {
              ...PBF_COPIER_ADMIN_PAGE_DEFAULTS,
              dryRunLimit: PBF_COPIER_ADMIN_PAGE_DEFAULTS.fastSmokeAcceptedLimit,
              maxRawObjectsToScan: PBF_COPIER_ADMIN_PAGE_DEFAULTS.fastSmokeRawCap,
            }
          : PBF_COPIER_VERMONT_FULL_DRY_RUN_DEFAULTS;

  const filePath = input?.filePath?.trim() || base.filePath;
  const acceptedLimit = input?.acceptedLimit ?? input?.maxAccepted ?? base.dryRunLimit;
  const geoFilterEnabled = input?.geoFilterEnabled ?? DEFAULT_PBF_COPIER_CONFIG.geoFilterEnabled;
  const geoFilterCenterLat =
    input?.geoFilterCenterLat !== undefined && input?.geoFilterCenterLat !== null
      ? input.geoFilterCenterLat
      : geoFilterEnabled
        ? HARTLAND_VT_CENTER.lat
        : null;
  const geoFilterCenterLng =
    input?.geoFilterCenterLng !== undefined && input?.geoFilterCenterLng !== null
      ? input.geoFilterCenterLng
      : geoFilterEnabled
        ? HARTLAND_VT_CENTER.lng
        : null;
  const geoFilterRadiusKm =
    input?.geoFilterRadiusKm ??
    (input?.geoFilterRadiusMiles != null ? input.geoFilterRadiusMiles * 1.609344 : DEFAULT_GEO_FILTER_RADIUS_KM);
  const geoFilterRadiusMiles = input?.geoFilterRadiusMiles ?? geoFilterRadiusKm / 1.609344;
  const maxRawObjectsToScan =
    input?.maxRawObjectsToScan !== undefined
      ? input.maxRawObjectsToScan
      : input?.fast
        ? base.maxRawObjectsToScan ?? PBF_COPIER_ADMIN_PAGE_DEFAULTS.fastSmokeRawCap
        : base.maxRawObjectsToScan;

  const mode: PbfCopierMode = input?.fast ? "fast_dry_run" : "dry_run_preview";

  return {
    filePath,
    acceptedLimit,
    maxRawObjectsToScan,
    mode,
    config: {
      filePath,
      dryRunLimit: acceptedLimit,
      dryRunStopMode: "max_accepted",
      maxAcceptedMode: true,
      maxRawObjectsToScan,
      classifyBatchSize: input?.classifyBatchSize ?? base.classifyBatchSize,
      includeSpots: input?.includeSpots ?? base.includeSpots,
      includeRoutes: input?.includeRoutes ?? base.includeRoutes,
      includePublicOnly: input?.includePublicOnly ?? base.includePublicOnly,
      includeReviewDocs: input?.includeReviewDocs ?? base.includeReviewDocs,
      skipExisting: input?.skipExisting ?? base.skipExisting,
      stateCode: input?.stateCode?.trim() || inferStateCodeFromFilePath(filePath) || base.stateCode,
      balancedPreview: DEFAULT_PBF_COPIER_CONFIG.balancedPreview,
      requireWaysBeforeStop: DEFAULT_PBF_COPIER_CONFIG.requireWaysBeforeStop,
      minWayCandidatesBeforeStop: DEFAULT_PBF_COPIER_CONFIG.minWayCandidatesBeforeStop,
      dryRunNodePhaseCap: DEFAULT_PBF_COPIER_CONFIG.dryRunNodePhaseCap,
      dryRunNodeSpotLimit: DEFAULT_PBF_COPIER_CONFIG.dryRunNodeSpotLimit,
      dryRunWaySpotLimit: DEFAULT_PBF_COPIER_CONFIG.dryRunWaySpotLimit,
      dryRunRouteLimit: DEFAULT_PBF_COPIER_CONFIG.dryRunRouteLimit,
      geoFilterEnabled,
      geoFilterCenterLat,
      geoFilterCenterLng,
      geoFilterRadiusKm,
      geoFilterRadiusMiles,
    },
  };
}
