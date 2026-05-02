import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  clearRecentFullWarmerBackoffForTests,
  endFullWarmerPass,
  evaluateFullWarmerGate,
  markP1P2InteractiveRequest,
  markProcessBoot,
  resetWarmerTrafficGateForTests,
  warmerQuietPeriodMs,
} from "./warmer-traffic-gate.js";

describe("warmer traffic gate", () => {
  beforeEach(() => {
    process.env.WARMER_QUIET_PERIOD_MS = "40";
    process.env.WARMER_FULL_BACKOFF_MS = "1000";
    resetWarmerTrafficGateForTests();
  });

  afterEach(() => {
    resetWarmerTrafficGateForTests();
  });

  it("blocks full warmers immediately after boot traffic marker until quiet period elapses", () => {
    markProcessBoot();
    const gate = evaluateFullWarmerGate({ force: false, mode: "test" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("active_traffic");
    }
  });

  it("allows full warmers after quiet period with force env not set", async () => {
    const quiet = warmerQuietPeriodMs();
    expect(quiet).toBe(40);
    markProcessBoot();
    await new Promise((r) => setTimeout(r, quiet + 25));
    clearRecentFullWarmerBackoffForTests();
    const gate = evaluateFullWarmerGate({ force: false, mode: "test" });
    expect(gate).toEqual({ ok: true });
  });

  it("marks P1/P2 activity to extend the quiet window", async () => {
    markProcessBoot();
    await new Promise((r) => setTimeout(r, 10));
    markP1P2InteractiveRequest();
    const gate = evaluateFullWarmerGate({ force: false, mode: "test" });
    expect(gate.ok).toBe(false);
  });

  it("skips when a full warmer completed recently (backoff)", async () => {
    markProcessBoot();
    await new Promise((r) => setTimeout(r, warmerQuietPeriodMs() + 25));
    clearRecentFullWarmerBackoffForTests();
    expect(evaluateFullWarmerGate({ force: false, mode: "test" }).ok).toBe(true);
    endFullWarmerPass();
    const gate = evaluateFullWarmerGate({ force: false, mode: "test" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("recent_full_refresh");
    }
  });
});
