import { describe, expect, it } from "vitest";
import { buildStateCoverageDiagnostics, listOffroadStateRegistries } from "../../lib/inventory/offroad/sources/offroadSourceRegistry.js";
import { getOffroadMasterPanelSnapshot, runBatchOffroadDryRun } from "./offroadNationalImport.service.js";
import { setStateEnabled } from "./offroadNationalRunStore.js";

describe("offroad national admin", () => {
  it("master panel lists all states", () => {
    const snap = getOffroadMasterPanelSnapshot();
    expect(snap.states.length).toBe(listOffroadStateRegistries().length);
    expect(snap.productionWritesBlocked).toBe(true);
  });

  it("toggle state enabled works in store", () => {
    setStateEnabled("CO", true);
    const snap = getOffroadMasterPanelSnapshot();
    const co = snap.states.find((s) => s.stateCode === "CO");
    expect(co?.enabled).toBe(true);
  });

  it("batch dry run refuses all-50 without explicit confirm", async () => {
    const all = listOffroadStateRegistries().filter((s) => s.stateCode !== "DC").map((s) => s.stateCode);
    await expect(
      runBatchOffroadDryRun({ stateCodes: all, sourceFilter: "federal" })
    ).rejects.toThrow(/confirmAllStates/);
  });

  it("result diagnostics includes stateCoverageDiagnostics shape", () => {
    const d = buildStateCoverageDiagnostics();
    expect(d.byState.VT).toBeDefined();
    expect(d.sourceTotals.osmActiveStates).toBe(50);
  });
});
