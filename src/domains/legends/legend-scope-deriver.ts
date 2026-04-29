import {
  buildLegendScopeId,
  clampLegendMaxActivities,
  clampLegendMaxScopes,
  geohash6,
  normalizeLegendActivityId,
  type LegendScopeId
} from "./legends.types.js";

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
    region?: string | null;
  }): { scopes: LegendScopeId[]; reasons: string[] } {
    const reasons: string[] = [];
    const maxScopes = clampLegendMaxScopes(this.config.maxScopesPerPost, 8);
    const maxActivities = clampLegendMaxActivities(this.config.maxActivitiesPerPost, 3);
    const enablePlace = this.config.enablePlaceScopes !== false;

    const hash6 = geohash6(input.geohash);
    const normalizedActivities = (Array.isArray(input.activities) ? input.activities : [])
      .map((a) => normalizeLegendActivityId(a))
      .filter((a): a is string => Boolean(a));

    const activityIds = [...new Set(normalizedActivities)].slice(0, maxActivities);
    if (normalizedActivities.length > activityIds.length) {
      reasons.push("activities_capped");
    }

    const scopes: LegendScopeId[] = [];
    if (hash6) {
      scopes.push(buildLegendScopeId(["cell", "geohash6", hash6]));
    } else {
      reasons.push("missing_geohash6");
    }

    for (const activityId of activityIds) {
      scopes.push(buildLegendScopeId(["activity", activityId]));
      if (hash6) {
        scopes.push(buildLegendScopeId(["cellActivity", "geohash6", hash6, activityId]));
      }
    }

    if (enablePlace) {
      const state = typeof input.state === "string" ? input.state.trim().toUpperCase() : "";
      if (state) {
        scopes.push(buildLegendScopeId(["place", "state", state]));
        for (const activityId of activityIds) {
          scopes.push(buildLegendScopeId(["placeActivity", "state", state, activityId]));
        }
      }
      // TODO(legends): add city/region/campus once reliably present in post metadata.
      if (!state) reasons.push("place_scopes_missing_state");
    }

    const unique = [...new Set(scopes)];
    if (unique.length > maxScopes) {
      reasons.push("scopes_capped");
    }

    return {
      scopes: unique.slice(0, maxScopes),
      reasons
    };
  }
}

