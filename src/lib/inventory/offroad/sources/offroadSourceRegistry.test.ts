import { describe, expect, it } from "vitest";
import {
  OFFROAD_STATE_REGISTRY,
  buildStateCoverageDiagnostics,
  getOffroadStateRegistry,
} from "./offroadSourceRegistry.js";

describe("offroadSourceRegistry", () => {
  it("includes all 50 states plus DC", () => {
    const codes = OFFROAD_STATE_REGISTRY.map((s) => s.stateCode);
    expect(codes).toContain("VT");
    expect(codes).toContain("CA");
    expect(codes.filter((c) => c !== "DC").length).toBe(50);
  });

  it("every state has federal tier-1 sources", () => {
    for (const state of OFFROAD_STATE_REGISTRY) {
      expect(state.sources.some((s) => s.sourceId === "usfs_mvum")).toBe(true);
      expect(state.sources.some((s) => s.sourceId === "blm_gtlf")).toBe(true);
      expect(state.sources.some((s) => s.sourceId === "osm_offroad")).toBe(true);
      const federal = state.sources.filter((s) => s.tier === 1);
      expect(federal.every((s) => s.status === "active")).toBe(true);
    }
  });

  it("VT has active VTrans source", () => {
    const vt = getOffroadStateRegistry("VT");
    expect(vt?.sources.find((s) => s.sourceId === "vt_vtrans_public_highway_system")?.status).toBe("active");
  });

  it("CA BLM OHV is area context not route line source", () => {
    const ca = getOffroadStateRegistry("CA");
    const ohv = ca?.sources.find((s) => s.sourceId === "ca_blm_ohv_areas");
    expect(ohv?.areaContextOnly).toBe(true);
    expect(ohv?.sourceType).toBe("area_context");
  });

  it("unknown states use needs_source placeholder not fake active endpoints", () => {
    const tx = getOffroadStateRegistry("TX");
    const placeholder = tx?.sources.find((s) => s.sourceId === "state_offroad_source");
    expect(placeholder?.status).toBe("needs_source");
    expect(placeholder?.endpoint).toBeUndefined();
  });

  it("NH has active NHDOT Class VI source", () => {
    const nh = getOffroadStateRegistry("NH");
    const nhVi = nh?.sources.find((s) => s.sourceId === "nh_class_vi_roads");
    expect(nhVi?.status).toBe("active");
    expect(nhVi?.endpoint).toContain("maps.dot.nh.gov");
  });

  it("NH and ME validation status", () => {
    expect(getOffroadStateRegistry("ME")?.sources.find((s) => s.sourceId === "me_atv_trails")?.status).toBe(
      "needs_validation"
    );
  });

  it("stateCoverageDiagnostics totals", () => {
    const d = buildStateCoverageDiagnostics();
    expect(d.totalStates).toBe(50);
    expect(d.statesWithFederalCoverage).toBe(50);
    expect(d.sourceTotals.usfsMvumActiveStates).toBe(50);
  });
});
