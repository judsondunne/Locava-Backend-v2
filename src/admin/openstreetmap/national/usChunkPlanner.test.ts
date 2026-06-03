import { describe, expect, it } from "vitest";
import { buildChunkId, planStateChunks, shouldSkipChunk } from "./usChunkPlanner.js";
import { estimateNationalPlan, planNationalRun } from "./osmNationalPlanner.service.js";
import { resetOsmNationalMemoryStore } from "./osmNationalMemoryStore.js";

describe("estimateNationalPlan", () => {
  it("VT test plan is small", () => {
    const est = estimateNationalPlan({ states: ["VT"], chunkSizeKm: 120 });
    expect(est.stateCount).toBe(1);
    expect(est.estimatedTotalChunks).toBeLessThan(20);
    expect(est.requiresLargePlanConfirmation).toBe(false);
  });

  it("contiguous US requires large plan confirmation", () => {
    const est = estimateNationalPlan({ regionPreset: "CONTIGUOUS", chunkSizeKm: 80 });
    expect(est.stateCount).toBeGreaterThan(40);
    expect(est.requiresLargePlanConfirmation).toBe(true);
  });
});

describe("planNationalRun large plan guard", () => {
  it("rejects contiguous plan without confirmLargePlan", async () => {
    resetOsmNationalMemoryStore();
    await expect(planNationalRun({ regionPreset: "CONTIGUOUS", chunkSizeKm: 80 })).rejects.toThrow(
      /large_plan_confirmation_required/
    );
  });
});

describe("usChunkPlanner", () => {
  it("creates deterministic chunks for Vermont", () => {
    const chunks = planStateChunks({ stateCode: "VT", chunkSizeKm: 80 });
    expect(chunks.length).toBeGreaterThan(0);
    const first = chunks[0]!;
    const again = planStateChunks({ stateCode: "VT", chunkSizeKm: 80 })[0]!;
    expect(first.chunkId).toBe(again.chunkId);
    expect(first.chunkId).toMatch(/^VT_r\d+_c\d+_[a-f0-9]{8}$/);
  });

  it("buildChunkId is stable for same bbox", () => {
    const bbox = { minLat: 43.7, minLng: -72.5, maxLat: 43.8, maxLng: -72.4 };
    expect(buildChunkId("VT", 0, 0, bbox)).toBe(buildChunkId("VT", 0, 0, bbox));
  });

  it("skipCompletedChunks works", () => {
    expect(
      shouldSkipChunk({ chunk: { status: "completed" }, skipCompletedChunks: true, forceReprocess: false })
    ).toBe(true);
    expect(
      shouldSkipChunk({ chunk: { status: "completed" }, skipCompletedChunks: true, forceReprocess: true })
    ).toBe(false);
  });
});
