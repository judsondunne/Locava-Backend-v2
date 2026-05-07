import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  activeCriticalRequestCount,
  beginBackgroundWarmer,
  beginCriticalInteractiveRequest,
  consumeDeferredBackgroundWork,
  endBackgroundWarmer,
  endCriticalInteractiveRequest,
  clearRecentFullWarmerBackoffForTests,
  endFullWarmerPass,
  evaluateFullWarmerGate,
  evaluateQuickWarmerGate,
  isBackgroundWarmerActive,
  markP1P2InteractiveRequest,
  markProcessBoot,
  noteBackgroundWorkDeferred,
  resetWarmerTrafficGateForTests,
  warmerQuietPeriodMs,
} from "./warmer-traffic-gate.js";

describe("warmer traffic gate", () => {
  beforeEach(() => {
    process.env.WARMER_QUIET_PERIOD_MS = "40";
    process.env.WARMER_FULL_BACKOFF_MS = "1000";
    process.env.WARMER_CRITICAL_WINDOW_MS = "40";
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
      expect(gate.reason).toBe("startup_critical_window");
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

  it("blocks quick warmers during the startup critical window", () => {
    process.env.WARMER_CRITICAL_WINDOW_MS = "100000";
    markProcessBoot();
    const gate = evaluateQuickWarmerGate({ force: false, mode: "quick_test" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("startup_critical_window");
    }
  });

  it("blocks full warmers while a critical interactive request is in flight", async () => {
    await new Promise((r) => setTimeout(r, warmerQuietPeriodMs() + 25));
    expect(beginCriticalInteractiveRequest("P0_VISIBLE_PLAYBACK")).toBe(true);
    expect(activeCriticalRequestCount()).toBe(1);
    const gate = evaluateFullWarmerGate({ force: false, mode: "test" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("active_traffic");
    }
    endCriticalInteractiveRequest("P0_VISIBLE_PLAYBACK");
    expect(activeCriticalRequestCount()).toBe(0);
  });

  it("tracks active background warmers and clears deferred markers after resume", () => {
    beginBackgroundWarmer("near_me_quick");
    expect(isBackgroundWarmerActive()).toBe(true);
    endBackgroundWarmer("near_me_quick");
    expect(isBackgroundWarmerActive()).toBe(false);

    process.env.WARMER_CRITICAL_WINDOW_MS = "100000";
    markProcessBoot();
    const gate = evaluateQuickWarmerGate({ force: false, mode: "quick_test" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      noteBackgroundWorkDeferred("near_me_quick", gate.reason);
    }
    const resumed = consumeDeferredBackgroundWork("near_me_quick");
    expect(resumed).not.toBeNull();
    expect(consumeDeferredBackgroundWork("near_me_quick")).toBeNull();
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
