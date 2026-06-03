import { describe, expect, it } from "vitest";
import {
  dryRunPreviewCapFromQuotas,
  emptyQuotaProgress,
  matchesQuotaKey,
  parseDryRunQuotaText,
  quotaNeedsMoreRoutes,
  quotaNeedsMoreSpots,
  quotasAreMet,
  recordRouteForQuotas,
  recordSpotForQuotas,
  resolveDryRunStopMode,
} from "./pbfCopierDryRunQuotas.js";
import { canCollectRoutePreview, canCollectSpotPreview } from "./pbfCopierBalancedPreview.js";
import { DEFAULT_PBF_COPIER_CONFIG } from "./pbfCopierTypes.js";
import type { LocavaInventoryRoute, LocavaInventorySpot } from "../../../../lib/inventory/inventoryLocavaTypes.js";

describe("pbfCopierDryRunQuotas", () => {
  it("parses quota text", () => {
    expect(parseDryRunQuotaText("beach:10, hiking_route:5")).toEqual({ beach: 10, hiking_route: 5 });
    expect(parseDryRunQuotaText("5 beaches, 3 hiking routes")).toEqual({ beach: 5, hiking_route: 3 });
    expect(parseDryRunQuotaText("10 beaches and 2 waterfalls")).toEqual({ beach: 10, waterfall: 2 });
    expect(parseDryRunQuotaText("i want 20 hiking routes")).toEqual({ hiking_route: 20 });
    expect(parseDryRunQuotaText("20 hiking routes")).toEqual({ hiking_route: 20 });
  });

  it("forces quota stop mode when targets are present", () => {
    expect(
      resolveDryRunStopMode({ dryRunStopMode: "max_accepted", dryRunQuotas: { hiking_route: 20 } })
    ).toBe("quotas");
  });

  it("raises preview cap for large quota targets", () => {
    expect(dryRunPreviewCapFromQuotas({ hiking_route: 20 }, 20)).toBeGreaterThanOrEqual(20);
  });

  it("matches beach spots and hiking routes separately", () => {
    const beachMatcher = matchesQuotaKey({ primaryCategory: "beach", activities: ["beach", "swimming"], isRoute: false });
    const routeMatcher = matchesQuotaKey({ primaryCategory: "trail", activities: ["hiking", "walking"], isRoute: true });
    const pathRouteMatcher = matchesQuotaKey({
      primaryCategory: "hiking",
      activities: ["hiking"],
      isRoute: true,
      routeKind: "full_trail",
    });
    expect(beachMatcher("beach")).toBe(true);
    expect(routeMatcher("hiking_route")).toBe(true);
    expect(pathRouteMatcher("hiking_route")).toBe(true);
    expect(routeMatcher("beach")).toBe(false);
  });

  it("only collects route previews while hiking_route quota is unmet", () => {
    const config = {
      ...DEFAULT_PBF_COPIER_CONFIG,
      dryRunStopMode: "quotas" as const,
      maxAcceptedMode: false,
      dryRunQuotas: { hiking_route: 20 },
      dryRunLimit: 20,
    };
    const progress = { hiking_route: 5 };
    expect(quotaNeedsMoreRoutes(config.dryRunQuotas, progress)).toBe(true);
    expect(quotaNeedsMoreSpots(config.dryRunQuotas, progress)).toBe(false);
    expect(
      canCollectRoutePreview({
        config,
        mode: "dry_run_preview",
        previewState: { nodeSpotPreviews: 0, waySpotPreviews: 0, routePreviews: 0, wayCandidatesFound: 0, relationCandidatesFound: 0 },
        totalPreviewDocs: 0,
        quotaProgress: progress,
      })
    ).toBe(true);
    expect(
      canCollectSpotPreview({
        config,
        mode: "dry_run_preview",
        metrics: { waysScanned: 0 } as never,
        previewState: { nodeSpotPreviews: 0, waySpotPreviews: 0, routePreviews: 0, wayCandidatesFound: 0, relationCandidatesFound: 0 },
        osmType: "node",
        totalPreviewDocs: 0,
        quotaProgress: progress,
      })
    ).toBe(false);
  });

  it("tracks quota progress until all targets are met", () => {
    const quotas = { beach: 2, hiking_route: 1 };
    const progress = emptyQuotaProgress(quotas);
    recordSpotForQuotas(
      { category: "beach", activities: ["beach", "swimming"] } as LocavaInventorySpot,
      quotas,
      progress
    );
    expect(quotasAreMet(quotas, progress)).toBe(false);
    recordSpotForQuotas(
      { category: "beach", activities: ["beach"] } as LocavaInventorySpot,
      quotas,
      progress
    );
    expect(quotasAreMet(quotas, progress)).toBe(false);
    recordRouteForQuotas(
      { categories: ["hiking"], activities: ["hiking", "walking"], routeKind: "full_trail" } as LocavaInventoryRoute,
      quotas,
      progress
    );
    expect(quotasAreMet(quotas, progress)).toBe(true);
  });
});
