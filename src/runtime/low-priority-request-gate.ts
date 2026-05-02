import type { FastifyRequest } from "fastify";
import type { RouteBudgetPolicy } from "../observability/route-policies.js";
import { getRequestContext, recordFallback, setOrchestrationMetadata } from "../observability/request-context.js";
import { isStartupGracePeriod, startupGraceMs } from "./server-boot.js";

/**
 * During the startup grace window, cap concurrent deferred/background route handlers so
 * Firestore-heavy P3/P4 work cannot starve P1/P2 feed/map/near-me/profile paths.
 */
class LowPriorityStartupGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  private maxConcurrent(): number {
    const raw = process.env.BACKENDV2_STARTUP_LOW_PRIORITY_MAX_CONCURRENCY;
    if (raw != null && raw !== "") {
      const n = Number.parseInt(String(raw), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 16) return n;
    }
    return 2;
  }

  private isGatedPolicy(policy: RouteBudgetPolicy | undefined): boolean {
    if (!policy) return false;
    return policy.priority === "deferred_interactive" || policy.priority === "background";
  }

  async acquire(policy: RouteBudgetPolicy | undefined): Promise<{ waitedMs: number; release: (() => void) | null }> {
    if (!isStartupGracePeriod() || !this.isGatedPolicy(policy)) {
      return { waitedMs: 0, release: null };
    }
    const start = Date.now();
    while (this.active >= this.maxConcurrent()) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    const waitedMs = Math.max(0, Date.now() - start);
    return {
      waitedMs,
      release: () => {
        this.active = Math.max(0, this.active - 1);
        const next = this.waiters.shift();
        next?.();
      }
    };
  }
}

const gate = new LowPriorityStartupGate();

const releaseByRequest = new WeakMap<FastifyRequest, () => void>();

export async function enterLowPriorityStartupGateIfNeeded(
  request: FastifyRequest,
  policy: RouteBudgetPolicy | undefined
): Promise<void> {
  const { waitedMs, release } = await gate.acquire(policy);
  const ctx = getRequestContext();
  if (ctx?.orchestration) {
    ctx.orchestration.queueWaitMs = (ctx.orchestration.queueWaitMs ?? 0) + waitedMs;
    if (waitedMs > 0) {
      ctx.orchestration.blockedByStartupWarmers = true;
    }
  } else if (waitedMs > 0) {
    setOrchestrationMetadata({
      queueWaitMs: waitedMs,
      blockedByStartupWarmers: true
    });
  }
  if (waitedMs > 0) {
    recordFallback(`startup_low_priority_gate_wait_${waitedMs}ms`);
  }
  if (release) {
    releaseByRequest.set(request, release);
  }
}

export function releaseLowPriorityStartupGate(request: FastifyRequest): void {
  const fn = releaseByRequest.get(request);
  if (fn) {
    releaseByRequest.delete(request);
    fn();
  }
}
