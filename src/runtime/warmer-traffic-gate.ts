import type { PriorityLane } from "../observability/route-policies.js";
import { serverAgeMs } from "./server-boot.js";

/**
 * Coordinates background Firestore warmers with interactive traffic (P0/P1/P2 lanes).
 * Full / heavy warmer passes should not compete with first-open request bursts.
 */

/** 0 = no interactive traffic observed yet (treat as quiet for unit tests / pre-boot). */
let lastP1P2RequestAtMs = 0;
let activeCriticalRequests = 0;
const activeBackgroundWarmers = new Set<string>();
const deferredBackgroundWarmers = new Map<string, { reason: WarmerGateReason; atMs: number }>();

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Read on each check so tests can stub `process.env` without reloading the module. */
export function warmerQuietPeriodMs(): number {
  return intEnv("WARMER_QUIET_PERIOD_MS", 8_000, 40, 120_000);
}

export function warmerFullBackoffMs(): number {
  return intEnv("WARMER_FULL_BACKOFF_MS", 120_000, 1_000, 3_600_000);
}

export function warmerCriticalWindowMs(): number {
  return intEnv("WARMER_CRITICAL_WINDOW_MS", 20_000, 40, 300_000);
}

/** Boot timestamp: treat as "recent traffic" so full warmers do not start instantly. */
export function markProcessBoot(): void {
  lastP1P2RequestAtMs = Date.now();
}

export function markP1P2InteractiveRequest(): void {
  lastP1P2RequestAtMs = Date.now();
}

function isCriticalInteractiveLane(lane: PriorityLane | null | undefined): boolean {
  return lane === "P0_VISIBLE_PLAYBACK" || lane === "P1_NEXT_PLAYBACK" || lane === "P2_CURRENT_SCREEN";
}

export function beginCriticalInteractiveRequest(lane: PriorityLane | null | undefined): boolean {
  if (!isCriticalInteractiveLane(lane)) return false;
  activeCriticalRequests += 1;
  lastP1P2RequestAtMs = Date.now();
  return true;
}

export function endCriticalInteractiveRequest(lane: PriorityLane | null | undefined): void {
  if (!isCriticalInteractiveLane(lane)) return;
  activeCriticalRequests = Math.max(0, activeCriticalRequests - 1);
  lastP1P2RequestAtMs = Date.now();
}

export function activeCriticalRequestCount(): number {
  return activeCriticalRequests;
}

export function isStartupCriticalWindowActive(): boolean {
  return serverAgeMs() < warmerCriticalWindowMs();
}

export function msSinceLastP1P2Request(): number {
  if (lastP1P2RequestAtMs === 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - lastP1P2RequestAtMs);
}

export function isWarmerQuietPeriodSatisfied(): boolean {
  return msSinceLastP1P2Request() >= warmerQuietPeriodMs();
}

export type WarmerGateDecision =
  | { ok: true }
  | { ok: false; reason: "active_traffic" | "recent_full_refresh" | "singleflight_busy" | "startup_critical_window" };

export type WarmerGateReason = Exclude<WarmerGateDecision, { ok: true }>["reason"];

let lastFullWarmerCompletedAtMs = 0;
let fullWarmerInFlight = false;

export function beginFullWarmerPass(): boolean {
  if (fullWarmerInFlight) return false;
  fullWarmerInFlight = true;
  return true;
}

export function endFullWarmerPass(): void {
  fullWarmerInFlight = false;
  lastFullWarmerCompletedAtMs = Date.now();
}

export function isFullWarmerInFlight(): boolean {
  return fullWarmerInFlight;
}

export function beginBackgroundWarmer(name: string): void {
  activeBackgroundWarmers.add(name);
}

export function endBackgroundWarmer(name: string): void {
  activeBackgroundWarmers.delete(name);
}

export function isBackgroundWarmerActive(): boolean {
  return activeBackgroundWarmers.size > 0;
}

export function noteBackgroundWorkDeferred(name: string, reason: WarmerGateReason): void {
  deferredBackgroundWarmers.set(name, { reason, atMs: Date.now() });
}

export function consumeDeferredBackgroundWork(name: string): { reason: WarmerGateReason; deferredForMs: number } | null {
  const row = deferredBackgroundWarmers.get(name);
  if (!row) return null;
  deferredBackgroundWarmers.delete(name);
  return {
    reason: row.reason,
    deferredForMs: Math.max(0, Date.now() - row.atMs),
  };
}

export function shouldSkipFullWarmerDueToRecentRefresh(): boolean {
  if (lastFullWarmerCompletedAtMs === 0) return false;
  return Date.now() - lastFullWarmerCompletedAtMs < warmerFullBackoffMs();
}

/** Vitest / isolated runs: clears cross-test leakage from other suites in the same worker. */
export function resetWarmerTrafficGateForTests(): void {
  lastP1P2RequestAtMs = 0;
  activeCriticalRequests = 0;
  lastFullWarmerCompletedAtMs = 0;
  fullWarmerInFlight = false;
  activeBackgroundWarmers.clear();
  deferredBackgroundWarmers.clear();
}

/**
 * Another suite may call `endFullWarmerPass()` while this file's test is mid-flight (Vitest file parallelism).
 * Clear only the backoff clock so quiet-period assertions stay deterministic.
 */
export function clearRecentFullWarmerBackoffForTests(): void {
  lastFullWarmerCompletedAtMs = 0;
}

export function evaluateFullWarmerGate(input: { force: boolean; mode: string }): WarmerGateDecision {
  if (input.force) return { ok: true };
  if (fullWarmerInFlight) return { ok: false, reason: "singleflight_busy" };
  if (activeCriticalRequests > 0) return { ok: false, reason: "active_traffic" };
  if (isStartupCriticalWindowActive()) return { ok: false, reason: "startup_critical_window" };
  if (!isWarmerQuietPeriodSatisfied()) return { ok: false, reason: "active_traffic" };
  if (shouldSkipFullWarmerDueToRecentRefresh()) return { ok: false, reason: "recent_full_refresh" };
  return { ok: true };
}

export function evaluateQuickWarmerGate(input: { force: boolean; mode: string }): WarmerGateDecision {
  if (input.force) return { ok: true };
  if (activeCriticalRequests > 0) return { ok: false, reason: "active_traffic" };
  if (isStartupCriticalWindowActive()) return { ok: false, reason: "startup_critical_window" };
  return { ok: true };
}
