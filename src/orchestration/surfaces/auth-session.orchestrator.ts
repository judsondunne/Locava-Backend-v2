import type { ViewerContext } from "../../auth/viewer-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import { recordCacheHit, recordCacheMiss, recordFallback, recordTimeout } from "../../observability/request-context.js";
import { TimeoutError, withTimeout } from "../timeouts.js";
import type { AuthSessionResponse } from "../../contracts/surfaces/auth-session.contract.js";
import type { AuthBootstrapService } from "../../services/surfaces/auth-bootstrap.service.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";
import { FeedBootstrapOrchestrator } from "./feed-bootstrap.orchestrator.js";
import { NotificationsListOrchestrator } from "./notifications-list.orchestrator.js";
import { NotificationsService } from "../../services/surfaces/notifications.service.js";
import { notificationsRepository } from "../../repositories/surfaces/notifications.repository.js";
import { CollectionsFirestoreAdapter } from "../../repositories/source-of-truth/collections-firestore.adapter.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";

export class AuthSessionOrchestrator {
  private readonly feedService = new FeedService(new FeedRepository());
  private readonly feedBootstrapOrchestrator = new FeedBootstrapOrchestrator(this.feedService);
  private readonly notificationsListOrchestrator = new NotificationsListOrchestrator(
    new NotificationsService(notificationsRepository)
  );
  private readonly collectionsAdapter = new CollectionsFirestoreAdapter();

  constructor(private readonly service: AuthBootstrapService) {}

  private scheduleDetached(label: string, delayMs: number, work: () => Promise<void>): void {
    scheduleBackgroundWork(work, delayMs, { label: `auth-session:${label}` });
  }

  async run(viewer: ViewerContext, debugSlowDeferredMs: number): Promise<AuthSessionResponse> {
    const cacheKey = buildCacheKey("entity", ["session-v1", viewer.viewerId]);
    const cached = await globalCache.get<AuthSessionResponse>(cacheKey);

    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const base = await this.service.loadSession(viewer.viewerId);
    const fallbacks: string[] = [];

    let viewerSummary: { handle: string; badge: string } | null = null;
    try {
      viewerSummary = await withTimeout(
        this.service.loadViewerSummary(viewer.viewerId, debugSlowDeferredMs),
        debugSlowDeferredMs > 0 ? 280 : 140,
        "auth.session.viewer_summary"
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        fallbacks.push("viewer_summary_timeout");
        recordTimeout("auth.session.viewer_summary");
        recordFallback("viewer_summary_timeout");
      } else {
        fallbacks.push("viewer_summary_failed");
        recordFallback("viewer_summary_failed");
      }
    }

    const response: AuthSessionResponse = {
      routeName: "auth.session.get",
      firstRender: {
        authenticated: base.authenticated,
        viewer: {
          id: base.viewerId,
          role: base.role
        },
        session: {
          state: base.authenticated ? "active" : "anonymous",
          issuedAt: base.issuedAt,
          expiresAt: base.expiresAt
        }
      },
      deferred: {
        viewerSummary
      },
      background: {
        cacheWarmScheduled: true
      },
      degraded: fallbacks.length > 0,
      fallbacks
    };

    await globalCache.set(cacheKey, response, 5000);
    if (!viewerSummary) {
      this.scheduleDetached("viewer-summary", 1_000, async () => {
        await this.service.loadViewerSummary(viewer.viewerId, 0);
      });
    }
    // Keep auth/session lean: background warmers should never contend with
    // the next interactive route on cold start.
    this.scheduleDetached("feed-bootstrap", 4_000, async () => {
      await this.feedBootstrapOrchestrator.run({
        viewer,
        limit: 4,
        tab: "explore",
        debugSlowDeferredMs: 0
      });
    });
    // Notifications is commonly the first follow-up surface after auth/session,
    // so warm it quickly while still staying off the request critical path.
    this.scheduleDetached("notifications", 300, async () => {
      await this.notificationsListOrchestrator.run({
        viewerId: viewer.viewerId,
        cursor: null,
        limit: 10
      });
    });
    this.scheduleDetached("collections-and-saved", 6_000, async () => {
      await this.collectionsAdapter.listViewerCollections({
        viewerId: viewer.viewerId,
        limit: 10
      });
      await this.collectionsAdapter.ensureDefaultSavedCollection(viewer.viewerId);
      const page = await this.collectionsAdapter.listCollectionPostIds({
        viewerId: viewer.viewerId,
        collectionId: `saved-${viewer.viewerId}`,
        cursor: null,
        limit: 8
      });
      await this.feedService.loadPostCardSummaryBatch(viewer.viewerId, page.items.map((item) => item.postId));
    });
    return response;
  }
}
