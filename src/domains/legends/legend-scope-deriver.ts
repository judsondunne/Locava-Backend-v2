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
    country?: string | null;
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
      const country = normalizeUpperLocationKey(input.country);
      const state = normalizeUpperLocationKey(input.state);
      const cityRaw = typeof input.city === "string" ? input.city.trim() : "";
      const city = cityRaw ? normalizeLowerLocationKey(cityRaw) : "";
      if (country) {
        scopes.push(buildLegendScopeId(["place", "country", country]));
        for (const activityId of activityIds) {
          scopes.push(buildLegendScopeId(["placeActivity", "country", country, activityId]));
        }
      }
      if (state) {
        scopes.push(buildLegendScopeId(["place", "state", state]));
        for (const activityId of activityIds) {
          scopes.push(buildLegendScopeId(["placeActivity", "state", state, activityId]));
        }
      }
      if (state && city) {
        const cityKey = `${state}_${city}`;
        scopes.push(buildLegendScopeId(["place", "city", cityKey]));
        for (const activityId of activityIds) {
          scopes.push(buildLegendScopeId(["placeActivity", "city", cityKey, activityId]));
        }
      }
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

function normalizeUpperLocationKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function normalizeLowerLocationKey(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

