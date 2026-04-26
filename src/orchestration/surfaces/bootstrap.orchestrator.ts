import type { ViewerContext } from "../../auth/viewer-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import { recordCacheHit, recordCacheMiss, recordFallback, recordTimeout } from "../../observability/request-context.js";
import { TimeoutError, withTimeout } from "../timeouts.js";
import type { BootstrapResponse } from "../../contracts/surfaces/bootstrap.contract.js";
import type { AuthBootstrapService } from "../../services/surfaces/auth-bootstrap.service.js";

export class BootstrapOrchestrator {
  constructor(private readonly service: AuthBootstrapService) {}

  async run(viewer: ViewerContext, debugSlowDeferredMs: number): Promise<BootstrapResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["init-v1", viewer.viewerId]);
    const cached = await globalCache.get<BootstrapResponse>(cacheKey);

    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const session = await this.service.loadSession(viewer.viewerId);
    const fallbacks: string[] = [];

    let seed = {
      shellVersion: "2026.04.v2-alpha",
      unreadCount: 0,
      experiments: [] as string[]
    };

    try {
      seed = await withTimeout(
        this.service.loadBootstrapSeed(viewer.viewerId, debugSlowDeferredMs),
        150,
        "bootstrap.seed"
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        fallbacks.push("bootstrap_seed_timeout");
        recordTimeout("bootstrap.seed");
        recordFallback("bootstrap_seed_timeout");
      } else {
        fallbacks.push("bootstrap_seed_failed");
        recordFallback("bootstrap_seed_failed");
      }
    }

    const response: BootstrapResponse = {
      routeName: "bootstrap.init.get",
      firstRender: {
        app: {
          apiVersion: "v2",
          serverTime: new Date().toISOString()
        },
        viewer: {
          id: session.viewerId,
          role: session.role,
          authenticated: session.authenticated
        },
        bootstrap: {
          shellVersion: seed.shellVersion,
          unreadCount: seed.unreadCount
        }
      },
      deferred: {
        experiments: seed.experiments
      },
      background: {
        cacheWarmScheduled: true
      },
      degraded: fallbacks.length > 0,
      fallbacks
    };

    await globalCache.set(cacheKey, response, 5000);
    return response;
  }
}
