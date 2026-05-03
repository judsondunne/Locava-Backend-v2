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

function logAuthSessionEvent(event: Record<string, unknown>): void {
  if (process.env.BACKENDV2_TRACE_AUTH_SESSION !== "1") return;
  console.log(JSON.stringify(event));
}

type ViewerSummaryWire = Awaited<ReturnType<AuthBootstrapService["loadViewerSummary"]>>;
type AuthSessionBaseWire = Awaited<ReturnType<AuthBootstrapService["loadSession"]>>;

const AUTH_SESSION_CACHE_TTL_MS = 5_000;

function toFallbackViewerSummary(viewerId: string): ViewerSummaryWire {
  return {
    uid: viewerId,
    canonicalUserId: viewerId,
    viewerReady: false,
    profileHydrationStatus: "minimal_fallback",
    email: null,
    handle: "",
    name: null,
    profilePic: null,
    profilePicSmallPath: null,
    profilePicMediumPath: null,
    profilePicLargePath: null,
    badge: "standard",
    onboardingComplete: null
  };
}

function buildAuthSessionResponse(input: {
  base: AuthSessionBaseWire;
  viewerSummary: ViewerSummaryWire | null;
  fallbacks: string[];
}): AuthSessionResponse {
  const fallbackReason = input.fallbacks.find((f) => f === "viewer_summary_timeout") ?? null;
  const effectiveSummary =
    input.viewerSummary ??
    (input.base.authenticated ? toFallbackViewerSummary(input.base.viewerId) : null);
  const summaryReady = effectiveSummary?.viewerReady === true;
  const profileHydrationStatus = summaryReady ? "ready" : input.base.authenticated ? "minimal_fallback" : "ready";
  return {
    routeName: "auth.session.get",
    firstRender: {
      authenticated: input.base.authenticated,
      viewer: {
        id: input.base.viewerId,
        uid: effectiveSummary?.uid ?? input.base.viewerId,
        canonicalUserId: effectiveSummary?.canonicalUserId ?? input.base.viewerId,
        role: input.base.role,
        email: effectiveSummary?.email ?? null,
        handle: effectiveSummary?.handle || null,
        name: effectiveSummary?.name ?? null,
        photoUrl: effectiveSummary?.profilePic ?? null,
        profilePicSmallPath: effectiveSummary?.profilePicSmallPath ?? null,
        profilePicMediumPath: effectiveSummary?.profilePicMediumPath ?? null,
        profilePicLargePath: effectiveSummary?.profilePicLargePath ?? null
      },
      session: {
        state: input.base.authenticated ? "active" : "anonymous",
        issuedAt: input.base.issuedAt,
        expiresAt: input.base.expiresAt
      },
      account: {
        status:
          !input.base.authenticated
            ? null
            : !summaryReady
              ? null
              : effectiveSummary?.onboardingComplete === false
                ? "existing_incomplete"
                : "existing_complete",
        onboardingComplete: effectiveSummary?.onboardingComplete ?? (input.base.authenticated ? null : true),
        viewerReady: summaryReady || !input.base.authenticated,
        profileHydrationStatus,
        retryAfterMs: profileHydrationStatus === "minimal_fallback" ? 250 : null,
        reason: profileHydrationStatus === "minimal_fallback" ? fallbackReason ?? "viewer_summary_timeout" : null
      }
    },
    deferred: {
      viewerSummary: effectiveSummary
    },
    background: {
      cacheWarmScheduled: true
    },
    degraded: input.fallbacks.some((f) => f !== "viewer_summary_timeout"),
    fallbacks: input.fallbacks
  };
}

export async function primeAuthSessionCacheFromSignin(input: {
  viewerId: string;
  provider: "google" | "apple" | "email_password";
  viewerSummary: ViewerSummaryWire;
}): Promise<void> {
  const cacheKey = buildCacheKey("entity", ["session-v1", input.viewerId]);
  const now = new Date().toISOString();
  const primed = buildAuthSessionResponse({
    base: {
      viewerId: input.viewerId,
      role: "member",
      authenticated: true,
      issuedAt: now,
      expiresAt: now
    },
    viewerSummary: input.viewerSummary,
    fallbacks: []
  });
  await globalCache.set(cacheKey, primed, AUTH_SESSION_CACHE_TTL_MS);
  logAuthSessionEvent({
    event: "AUTH_SESSION_PRIMED_FROM_SIGNIN",
    ts: Date.now(),
    viewerId: input.viewerId,
    canonicalUserId: input.viewerSummary.canonicalUserId,
    provider: input.provider,
    profilePicPresent: Boolean(input.viewerSummary.profilePic),
    handlePresent: Boolean(input.viewerSummary.handle),
    emailPresent: Boolean(input.viewerSummary.email),
    cacheKey,
    ttlMs: AUTH_SESSION_CACHE_TTL_MS
  });
}

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
      logAuthSessionEvent({
        event: "AUTH_SESSION_VIEWER_HYDRATION",
        ts: Date.now(),
        viewerId: viewer.viewerId,
        canonicalUserId: cached.firstRender.viewer.canonicalUserId ?? cached.firstRender.viewer.uid ?? viewer.viewerId,
        viewerSummaryPresent: Boolean(cached.deferred.viewerSummary),
        viewerReady: cached.firstRender.account.viewerReady,
        profileHydrationStatus: cached.firstRender.account.profileHydrationStatus,
        profilePicPresent: Boolean(cached.firstRender.viewer.photoUrl),
        handlePresent: Boolean(cached.firstRender.viewer.handle),
        emailPresent: Boolean(cached.firstRender.viewer.email),
        source: "session_cache",
        cacheHit: true,
        cacheMiss: false,
        minimalViewerPresent: Boolean(cached.firstRender.viewer.id),
      });
      return cached;
    }
    recordCacheMiss();

    const base = await this.service.loadSession(viewer.viewerId);
    const fallbacks: string[] = [];

    let viewerSummary: ViewerSummaryWire | null = null;
    try {
      viewerSummary = await withTimeout(
        this.service.loadViewerSummary(viewer.viewerId, debugSlowDeferredMs),
        debugSlowDeferredMs > 0 ? 900 : 650,
        "auth.session.viewer_summary"
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        fallbacks.push("viewer_summary_timeout");
        recordTimeout("auth.session.viewer_summary");
        recordFallback("viewer_summary_timeout");
        logAuthSessionEvent({
          event: "AUTH_SESSION_VIEWER_SUMMARY_TIMEOUT",
          ts: Date.now(),
          viewerId: viewer.viewerId,
          fallback: "viewer_summary_timeout",
        });
      } else {
        fallbacks.push("viewer_summary_failed");
        recordFallback("viewer_summary_failed");
        logAuthSessionEvent({
          event: "AUTH_SESSION_VIEWER_SUMMARY_FAILED",
          ts: Date.now(),
          viewerId: viewer.viewerId,
          fallback: "viewer_summary_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const client = viewer.clientProfile;
    if (!viewerSummary && base.authenticated) {
      try {
        const direct = await this.service.loadViewerSummary(viewer.viewerId, 0);
        if (direct.viewerReady) {
          viewerSummary = direct;
        }
      } catch {
        // last-resort fallback below
      }
    }

    const response = buildAuthSessionResponse({
      base,
      viewerSummary: viewerSummary
        ? {
            ...viewerSummary,
            email: viewerSummary.email ?? client?.email ?? null,
            handle: viewerSummary.handle || client?.handle || "",
            name: viewerSummary.name ?? client?.name ?? null,
            profilePic: viewerSummary.profilePic ?? client?.photoUrl ?? null
          }
        : null,
      fallbacks
    });
    logAuthSessionEvent({
      event: "AUTH_SESSION_VIEWER_HYDRATION",
      ts: Date.now(),
      viewerId: viewer.viewerId,
      canonicalUserId: response.firstRender.viewer.canonicalUserId ?? null,
      degraded: response.degraded,
      fallbacks: response.fallbacks,
      viewerSummaryPresent: Boolean(response.deferred.viewerSummary),
      viewerReady: response.firstRender.account.viewerReady,
      profileHydrationStatus: response.firstRender.account.profileHydrationStatus,
      profilePicPresent: Boolean(response.firstRender.viewer.photoUrl),
      handlePresent: Boolean(response.firstRender.viewer.handle),
      emailPresent: Boolean(response.firstRender.viewer.email),
      source: "session_live",
      cacheHit: false,
      cacheMiss: true,
      minimalViewerPresent: Boolean(response.firstRender.viewer.id),
    });
    const canCache = Boolean(response.deferred.viewerSummary?.viewerReady);
    if (canCache) {
      await globalCache.set(cacheKey, response, AUTH_SESSION_CACHE_TTL_MS);
    } else {
      logAuthSessionEvent({
        event: "AUTH_SESSION_MINIMAL_FALLBACK_NOT_CACHED",
        ts: Date.now(),
        viewerId: viewer.viewerId,
        canonicalUserId: response.firstRender.viewer.canonicalUserId ?? null,
        viewerSummaryPresent: Boolean(response.deferred.viewerSummary),
        viewerReady: response.firstRender.account.viewerReady,
        profileHydrationStatus: response.firstRender.account.profileHydrationStatus,
        source: "session_live",
        cacheHit: false,
        cacheMiss: true
      });
    }
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
