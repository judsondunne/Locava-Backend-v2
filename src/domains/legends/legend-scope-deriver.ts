import {
  buildLegendScopeId,
  clampLegendMaxActivities,
  clampLegendMaxScopes,
  normalizeLegendActivityId,
  type LegendScopeId
} from "./legends.types.js";
import { normalizeUpperLocationKey } from "./legend-location-keys.js";

type LegendPostLike = {
  activities?: string[] | null;
  state?: string | null;
  country?: string | null;
};

export function buildLegendScopesForPost(input: LegendPostLike): { scopes: LegendScopeId[]; reasons: string[] } {
  const reasons: string[] = [];
  const normalizedActivities = (Array.isArray(input.activities) ? input.activities : [])
    .map((a) => normalizeLegendActivityId(a))
    .filter((a): a is string => Boolean(a));
  const activityIds = [...new Set(normalizedActivities)].slice(0, 3);
  if (normalizedActivities.length > activityIds.length) reasons.push("activities_capped");

  const state = normalizeUpperLocationKey(input.state);
  const country = normalizeUpperLocationKey(input.country);
  if (!state) reasons.push("missing_state");
  if (!country) reasons.push("missing_country");

  const scopes: LegendScopeId[] = [];
  for (const activityId of activityIds) {
    scopes.push(buildLegendScopeId(["activity", activityId]));
  }
  if (state) {
    scopes.push(buildLegendScopeId(["place", "state", state]));
    for (const activityId of activityIds) {
      scopes.push(buildLegendScopeId(["placeActivity", "state", state, activityId]));
    }
  }
  if (country) {
    scopes.push(buildLegendScopeId(["place", "country", country]));
    for (const activityId of activityIds) {
      scopes.push(buildLegendScopeId(["placeActivity", "country", country, activityId]));
    }
  }
  return { scopes: [...new Set(scopes)], reasons };
}

export class LegendScopeDeriver {
  constructor(
    private readonly config: {
      maxScopesPerPost?: number;
      maxActivitiesPerPost?: number;
      enablePlaceScopes?: boolean;
    } = {}
  ) {}

  deriveFromPost(input: {
    geohash?: string | null;
    activities?: string[] | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    region?: string | null;
  }): { scopes: LegendScopeId[]; reasons: string[] } {
    const maxScopes = clampLegendMaxScopes(this.config.maxScopesPerPost, 8);
    const maxActivities = clampLegendMaxActivities(this.config.maxActivitiesPerPost, 3);
    void input.geohash;
    void input.city;
    void input.region;
    const { scopes: baseScopes, reasons } = buildLegendScopesForPost({
      activities: input.activities,
      state: input.state,
      country: input.country
    });
    const placeEnabled = this.config.enablePlaceScopes !== false;
    const placeFiltered = placeEnabled
      ? baseScopes
      : baseScopes.filter((scopeId) => !scopeId.startsWith("place:") && !scopeId.startsWith("placeActivity:"));

    const cappedActivities = [...new Set((Array.isArray(input.activities) ? input.activities : [])
      .map((a) => normalizeLegendActivityId(a))
      .filter((a): a is string => Boolean(a)))].slice(0, maxActivities);
    const filtered = placeFiltered.filter((scopeId) => {
      if (!scopeId.startsWith("activity:") && !scopeId.startsWith("placeActivity:")) return true;
      return cappedActivities.some((activity) => scopeId.endsWith(`:${activity}`) || scopeId === `activity:${activity}`);
    });
    const unique = [...new Set(filtered)];
    if (unique.length > maxScopes) {
      reasons.push("scopes_capped");
    }

    return {
      scopes: unique.slice(0, maxScopes),
      reasons
    };
  }
}

