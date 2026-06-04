import { describe, expect, it } from "vitest";
import { LegendScopeDeriver } from "./legend-scope-deriver.js";
import {
  readPersistedDerivedScopes,
  resolveCommitDerivedScopes,
  filterSupportedLegendScopes
} from "./legend-stage-scopes.js";

describe("legend stage scope persistence", () => {
  const deriver = new LegendScopeDeriver({ maxScopesPerPost: 8, maxActivitiesPerPost: 3 });

  it("reads canonical derivedScopes and legacy aliases", () => {
    expect(readPersistedDerivedScopes({ derivedScopes: ["activity:hiking"] })).toEqual(["activity:hiking"]);
    expect(readPersistedDerivedScopes({ scopes: ["place:state:VT"] })).toEqual(["place:state:VT"]);
    expect(readPersistedDerivedScopes({ stagedScopes: ["place:country:US"] })).toEqual(["place:country:US"]);
    expect(readPersistedDerivedScopes({ scopeIds: ["placeActivity:state:VT:diving"] })).toEqual([
      "placeActivity:state:VT:diving"
    ]);
    expect(readPersistedDerivedScopes({ derivedScopes: [], scopes: ["activity:hiking"] })).toEqual(["activity:hiking"]);
  });

  it("prefers persisted scopes over recompute fallback", () => {
    const resolved = resolveCommitDerivedScopes({
      stageRaw: {
        derivedScopes: [
          "activity:hiking",
          "activity:diving",
          "place:state:VERMONT",
          "place:country:US",
          "placeActivity:state:VERMONT:hiking",
          "placeActivity:state:VERMONT:diving",
          "placeActivity:country:US:hiking",
          "placeActivity:country:US:diving"
        ],
        stageContext: {
          activityIds: ["hiking", "diving"],
          state: "Vermont",
          country: "US"
        }
      },
      legendPost: { postId: "p1", userId: "u1" },
      recompute: (post) =>
        deriver.deriveFromPost({
          activities: post.activities ?? [],
          state: post.state ?? null,
          country: post.country ?? null
        }).scopes
    });
    expect(resolved.scopeSource).toBe("persisted");
    expect(resolved.persistedScopeCount).toBe(8);
    expect(resolved.commitReadScopeCount).toBe(8);
    expect(resolved.fallbackRecomputeScopeCount).toBe(0);
    expect(resolved.derivedScopes.length).toBe(8);
  });

  it("recomputes Vermont hiking/diving scopes when persisted scopes are missing", () => {
    const resolved = resolveCommitDerivedScopes({
      stageRaw: {
        stageContext: {
          activityIds: ["hiking", "diving"],
          state: "Vermont",
          country: "US",
          city: "Town of Windsor"
        }
      },
      legendPost: { postId: "p1", userId: "u1" },
      recompute: (post) =>
        deriver.deriveFromPost({
          activities: post.activities ?? [],
          state: post.state ?? null,
          country: post.country ?? null
        }).scopes
    });
    expect(resolved.scopeSource).toBe("recomputed");
    expect(resolved.persistedScopeCount).toBe(0);
    expect(resolved.fallbackRecomputeScopeCount).toBeGreaterThanOrEqual(8);
    expect(resolved.derivedScopes.length).toBeGreaterThanOrEqual(8);
    expect(resolved.derivedScopes).toContain("activity:hiking");
    expect(resolved.derivedScopes).toContain("activity:diving");
    expect(resolved.derivedScopes.some((scopeId) => scopeId.startsWith("place:state:"))).toBe(true);
  });

  it("filters unsupported legacy cell scopes", () => {
    const filtered = filterSupportedLegendScopes([
      "cell:geohash6:dr5reg",
      "activity:hiking",
      "place:state:VT"
    ]);
    expect(filtered).toEqual(["activity:hiking", "place:state:VT"]);
  });
});
