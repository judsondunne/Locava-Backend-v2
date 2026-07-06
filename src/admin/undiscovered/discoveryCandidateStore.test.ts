import { describe, it, expect, beforeEach } from "vitest";
import { DiscoveryCandidateStore } from "./discoveryCandidateStore.js";
import { buildVermontSampleCandidates } from "../../lib/undiscovered/vermontSampleCandidates.js";
import { canTransitionDiscoveryStatus } from "../../contracts/surfaces/undiscovered-candidate.contract.js";

describe("DiscoveryCandidateStore", () => {
  let store: DiscoveryCandidateStore;
  beforeEach(() => {
    store = new DiscoveryCandidateStore();
    store.upsertMany(buildVermontSampleCandidates("2026-06-25T00:00:00.000Z"));
  });

  function firstId(): string {
    const items = store.list({ region: "VT" });
    const first = items[0];
    expect(first).toBeDefined();
    return first!.id;
  }

  it("seeds Vermont candidates and counts them", () => {
    expect(store.size()).toBe(10);
    expect(store.counts({ region: "VT" }).candidate).toBe(10);
  });

  it("orders quality-passing candidates first", () => {
    const items = store.list({ region: "VT" });
    expect(items[0]!.qualityGate.passed).toBe(true);
    expect(items[items.length - 1]!.qualityGate.passed).toBe(false);
  });

  it("re-seed preserves review progress", () => {
    const id = firstId();
    store.setStatus(id, "approved", { reviewedBy: "tester" });
    store.upsertMany(buildVermontSampleCandidates()); // re-seed
    expect(store.get(id)?.reviewStatus).toBe("approved");
    expect(store.get(id)?.reviewedBy).toBe("tester");
  });

  it("allows valid transitions and rejects invalid ones", () => {
    const id = firstId();
    const ok = store.setStatus(id, "reviewed");
    expect(ok.ok).toBe(true);

    // candidate -> written is not allowed directly
    store.setStatus(id, "candidate");
    const bad = store.setStatus(id, "written");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid_transition");
  });

  it("returns not_found for unknown id", () => {
    const res = store.setStatus("nope", "reviewed");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
  });

  it("full happy path candidate -> written", () => {
    const id = firstId();
    for (const to of ["reviewed", "approved", "written"] as const) {
      const r = store.setStatus(id, to);
      expect(r.ok).toBe(true);
    }
    expect(store.get(id)?.reviewStatus).toBe("written");
  });

  it("state machine helper matches store behavior", () => {
    expect(canTransitionDiscoveryStatus("candidate", "approved")).toBe(true);
    expect(canTransitionDiscoveryStatus("candidate", "written")).toBe(false);
    expect(canTransitionDiscoveryStatus("approved", "written")).toBe(true);
    expect(canTransitionDiscoveryStatus("written", "candidate")).toBe(false);
  });
});
