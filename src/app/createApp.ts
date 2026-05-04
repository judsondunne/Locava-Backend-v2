import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import Fastify, { type FastifyInstance } from "fastify";
import { context, trace } from "@opentelemetry/api";
import { ZodError } from "zod";
import { type AppEnv, loadEnv } from "../config/env.js";
import { legacyProxyLoopsToBackendTargets } from "../lib/firebase-identity-toolkit.js";
import { failure } from "../lib/response.js";
import { diagnosticsStore } from "../observability/diagnostics-store.js";
import { requestMetricsCollector } from "../observability/request-metrics.collector.js";
import {
  getRequestContext,
  recordPayloadBytes,
  runWithRequestContext
} from "../observability/request-context.js";
import { getRoutePolicy } from "../observability/route-policies.js";
import { inferRouteNameFromRequest } from "../runtime/infer-route-name.js";
import {
  enterLowPriorityStartupGateIfNeeded,
  releaseLowPriorityStartupGate
} from "../runtime/low-priority-request-gate.js";
import { logStartupTimeline, startupGraceMs } from "../runtime/server-boot.js";
import { searchPlacesIndexService } from "../services/surfaces/search-places-index.service.js";
import { attachErrorBufferToLogger } from "../observability/error-ring-buffer.js";
import { cacheMetricsCollector } from "../observability/cache-metrics.collector.js";
import { registerAdminRoutes } from "../routes/admin.routes.js";
import { registerInternalHealthDashboardRoutes } from "../routes/internal/health-dashboard.routes.js";
import { registerInternalOpsRoutes } from "../routes/internal/internal-ops.routes.js";
import { registerSystemRoutes } from "../routes/system.routes.js";
import { registerTestRoutes } from "../routes/test.routes.js";
import { registerV2AuthBootstrapRoutes } from "../routes/v2/auth-bootstrap.routes.js";
import { registerV2AuthMutationRoutes } from "../routes/v2/auth-mutations.routes.js";
import { registerV2AuthPushTokenRoutes } from "../routes/v2/auth-push-token.routes.js";
import { registerProfilePictureUploadRoutes } from "../routes/v2/profile-picture-upload.routes.js";
import { registerV2FeedBootstrapRoutes } from "../routes/v2/feed-bootstrap.routes.js";
import { registerV2FeedForYouRoutes } from "../routes/v2/feed-for-you.routes.js";
import { registerV2FeedForYouSimpleRoutes } from "../routes/v2/feed-for-you-simple.routes.js";
import { registerV2FeedItemDetailRoutes } from "../routes/v2/feed-item-detail.routes.js";
import { registerV2FeedPageRoutes } from "../routes/v2/feed-page.routes.js";
import { registerV2ProfileRoutes } from "../routes/v2/profile.routes.js";
import { registerV2ProfileGridRoutes } from "../routes/v2/profile-grid.routes.js";
import { registerV2ProfilePostDetailRoutes } from "../routes/v2/profile-post-detail.routes.js";
import { registerV2SearchResultsRoutes } from "../routes/v2/search-results.routes.js";
import { registerV2SearchUsersRoutes } from "../routes/v2/search-users.routes.js";
import { registerV2SearchDiscoveryRoutes } from "../routes/v2/search-discovery.routes.js";
import { registerV2SearchMixesRoutes } from "../routes/v2/search-mixes.routes.js";
import { registerV2SearchHomeV1Routes } from "../routes/v2/search-home-v1.routes.js";
import { registerV2MixesRoutes } from "../routes/v2/mixes.routes.js";
import { registerV2PlacesReverseGeocodeRoutes } from "../routes/v2/places-reverse-geocode.routes.js";
import { registerV2SocialBatchRoutes } from "../routes/v2/social-batch.routes.js";
import { registerV2PostLikeRoutes } from "../routes/v2/post-like.routes.js";
import { registerV2PostLikesRoutes } from "../routes/v2/post-likes.routes.js";
import { registerV2UserFollowRoutes } from "../routes/v2/user-follow.routes.js";
import { registerV2PostUnlikeRoutes } from "../routes/v2/post-unlike.routes.js";
import { registerV2UserUnfollowRoutes } from "../routes/v2/user-unfollow.routes.js";
import { registerV2PostDeleteRoutes } from "../routes/v2/post-delete.routes.js";
import { registerV2PostsPublishRoutes } from "../routes/v2/posts-publish.routes.js";
import { registerV2PostingStagingPresignRoutes } from "../routes/v2/posting-staging-presign.routes.js";
import { registerV2PostingUploadSessionRoutes } from "../routes/v2/posting-upload-session.routes.js";
import { registerV2PostingFinalizeRoutes } from "../routes/v2/posting-finalize.routes.js";
import { registerV2PostingOperationStatusRoutes } from "../routes/v2/posting-operation-status.routes.js";
import { registerV2PostingOperationCancelRoutes } from "../routes/v2/posting-operation-cancel.routes.js";
import { registerV2PostingOperationRetryRoutes } from "../routes/v2/posting-operation-retry.routes.js";
import { registerV2PostingMediaRegisterRoutes } from "../routes/v2/posting-media-register.routes.js";
import { registerV2PostingMediaMarkUploadedRoutes } from "../routes/v2/posting-media-mark-uploaded.routes.js";
import { registerV2PostingMediaStatusRoutes } from "../routes/v2/posting-media-status.routes.js";
import { registerV2PostingLocationSuggestRoutes } from "../routes/v2/posting-location-suggest.routes.js";
import { registerV2PostingSongsRoutes } from "../routes/v2/posting-songs.routes.js";
import { registerV2LegendsStagePostRoutes } from "../routes/v2/legends-stage-post.routes.js";
import { registerV2LegendsStagePostCancelRoutes } from "../routes/v2/legends-stage-post-cancel.routes.js";
import { registerV2LegendsMeBootstrapRoutes } from "../routes/v2/legends-me-bootstrap.routes.js";
import { registerV2LegendsScopeDetailRoutes } from "../routes/v2/legends-scope-detail.routes.js";
import { registerV2LegendsAfterPostRoutes } from "../routes/v2/legends-after-post.routes.js";
import { registerV2LegendsEventsRoutes } from "../routes/v2/legends-events.routes.js";
import { registerV2CommentsListRoutes } from "../routes/v2/comments-list.routes.js";
import { registerV2CommentsCreateRoutes } from "../routes/v2/comments-create.routes.js";
import { registerV2AnalyticsEventsRoutes } from "../routes/v2/analytics-events.routes.js";
import { registerV2CommentsLikeRoutes } from "../routes/v2/comments-like.routes.js";
import { registerV2CommentsDeleteRoutes } from "../routes/v2/comments-delete.routes.js";
import { registerV2NotificationsListRoutes } from "../routes/v2/notifications-list.routes.js";
import { registerV2NotificationsMarkReadRoutes } from "../routes/v2/notifications-mark-read.routes.js";
import { registerV2NotificationsMarkAllReadRoutes } from "../routes/v2/notifications-mark-all-read.routes.js";
import { registerV2ChatsInboxRoutes } from "../routes/v2/chats-inbox.routes.js";
import { registerV2ChatsConversationRoutes } from "../routes/v2/chats-conversation.routes.js";
import { registerV2ChatsMarkReadRoutes } from "../routes/v2/chats-mark-read.routes.js";
import { registerV2ChatsThreadRoutes } from "../routes/v2/chats-thread.routes.js";
import { registerV2ChatsSendMessageRoutes } from "../routes/v2/chats-send-message.routes.js";
import { registerV2ChatsMarkUnreadRoutes } from "../routes/v2/chats-mark-unread.routes.js";
import { registerV2ChatsCreateRoutes } from "../routes/v2/chats-create.routes.js";
import { registerV2ChatsGroupMediaRoutes } from "../routes/v2/chats-group-media.routes.js";
import { registerV2ChatsManageRoutes } from "../routes/v2/chats-manage.routes.js";
import { registerV2ChatsMessageReactionRoutes } from "../routes/v2/chats-message-reaction.routes.js";
import { registerV2UsersLastActiveRoutes } from "../routes/v2/users-last-active.routes.js";
import { registerV2GroupsRoutes } from "../routes/v2/groups.routes.js";
import { registerV2InvitesRoutes } from "../routes/v2/invites.routes.js";
import { registerLegacyApiStubRoutes } from "../routes/compat/legacy-api-stubs.routes.js";
import { registerLaunchCompatRoutes } from "../routes/compat/launch-compat.routes.js";
import { registerLegacyMonolithProductProxyRoutes } from "../routes/compat/legacy-monolith-product-proxy.routes.js";
import { registerLegacyMonolithAuthProxyRoutes } from "../routes/compat/legacy-monolith-auth-proxy.routes.js";
import { registerLegacyMonolithUploadProxyRoutes } from "../routes/compat/legacy-monolith-upload-proxy.routes.js";
import { registerLegacyMonolithNotificationsProxyRoutes } from "../routes/compat/legacy-monolith-notifications-proxy.routes.js";
import { registerLegacyReelsNearMeRoutes } from "../routes/compat/legacy-reels-near-me.routes.js";
import { registerVideoProcessorRoutes } from "../routes/compat/video-processor.routes.js";
import { registerLegacyProductUploadRoutes } from "../routes/compat/legacy-product-upload.routes.js";
import { registerLegacyBootstrapCompatRoutes } from "../routes/compat/legacy-bootstrap.routes.js";
import { registerNativeEssentialCompatRoutes } from "../routes/compat/native-essential-compat.routes.js";
import { registerCompatQrCodeRoutes } from "../routes/compat/qr-code.routes.js";
import { registerV2CollectionsSavedRoutes } from "../routes/v2/collections-saved.routes.js";
import { registerV2CollectionsRoutes } from "../routes/v2/collections-v2.routes.js";
import { registerV2PostsDetailRoutes } from "../routes/v2/posts-detail.routes.js";
import { registerV2AchievementsHeroRoutes } from "../routes/v2/achievements-hero.routes.js";
import { registerV2AchievementsBootstrapRoutes } from "../routes/v2/achievements-bootstrap.routes.js";
import { registerV2AchievementsSnapshotRoutes } from "../routes/v2/achievements-snapshot.routes.js";
import { registerV2AchievementsPendingDeltaRoutes } from "../routes/v2/achievements-pending-delta.routes.js";
import { registerV2AchievementsPendingCelebrationsRoutes } from "../routes/v2/achievements-pending-celebrations.routes.js";
import { registerV2AchievementsStatusRoutes } from "../routes/v2/achievements-status.routes.js";
import { registerV2AchievementsBadgesRoutes } from "../routes/v2/achievements-badges.routes.js";
import { registerV2AchievementsClaimablesRoutes } from "../routes/v2/achievements-claimables.routes.js";
import { registerV2AchievementsScreenOpenedRoutes } from "../routes/v2/achievements-screen-opened.routes.js";
import { registerV2AchievementsLeaguesRoutes } from "../routes/v2/achievements-leagues.routes.js";
import { registerV2AchievementsLeaderboardRoutes } from "../routes/v2/achievements-leaderboard.routes.js";
import { registerV2AchievementsLeaderboardViewerRankRoutes } from "../routes/v2/achievements-leaderboard-viewer-rank.routes.js";
import { registerV2AchievementsLeaderboardAckRoutes } from "../routes/v2/achievements-leaderboard-ack.routes.js";
import { registerV2AchievementsClaimRoutes } from "../routes/v2/achievements-claim.routes.js";
import { registerV2AchievementsConsumeCelebrationRoutes } from "../routes/v2/achievements-consume-celebration.routes.js";
import { registerV2AchievementsClaimWeeklyCaptureRoutes } from "../routes/v2/achievements-claim-weekly-capture.routes.js";
import { registerV2AchievementsClaimBadgeRoutes } from "../routes/v2/achievements-claim-badge.routes.js";
import { registerV2AchievementsClaimChallengeRoutes } from "../routes/v2/achievements-claim-challenge.routes.js";
import { registerV2AchievementsClaimIntroBonusRoutes } from "../routes/v2/achievements-claim-intro-bonus.routes.js";
import { registerV2MapBootstrapRoutes } from "../routes/v2/map-bootstrap.routes.js";
import { registerV2MapMarkersRoutes } from "../routes/v2/map-markers.routes.js";
import { registerV2DirectoryUsersRoutes } from "../routes/v2/directory-users.routes.js";
import { registerV2SocialSuggestedFriendsRoutes } from "../routes/v2/social-suggested-friends.routes.js";
import { registerV2SocialContactsSyncRoutes } from "../routes/v2/social-contacts-sync.routes.js";
import { registerV2UsersSuggestedRoutes } from "../routes/v2/users-suggested.routes.js";
import { registerLocalDebugRoutes } from "../routes/debug/local-debug.routes.js";
import { registerPublicFirestoreProbeRoutes } from "../routes/debug/public-firestore-probe.routes.js";
import { registerPostRebuilderRoutes } from "../routes/debug/post-rebuilder.routes.js";
import { registerPublicExpoPushRoutes } from "../routes/public/expo-push.routes.js";
import { SourceOfTruthRequiredError } from "../repositories/source-of-truth/strict-mode.js";
import {
  getFirestoreAdminIdentity,
  getFirestoreSourceClient,
  primeFirestoreMutationChannel,
  primeFirestoreSourceClient
} from "../repositories/source-of-truth/firestore-client.js";
import { isLocalDevIdentityModeEnabled, resolveLocalDebugViewerId } from "../lib/local-dev-identity.js";
import { registerNativeProductShimRoutes } from "../routes/compat/native-product-shim.routes.js";
import {
  markP1P2InteractiveRequest,
  markProcessBoot
} from "../runtime/warmer-traffic-gate.js";
import { globalCache } from "../cache/global-cache.js";
import type { MapMarkersResponse } from "../contracts/surfaces/map-markers.contract.js";
import { MapMarkersFirestoreAdapter } from "../repositories/source-of-truth/map-markers-firestore.adapter.js";
import { primeCoherenceProvider } from "../runtime/coherence-provider.js";
import { runFirebaseAdminPermissionProbe } from "../lib/firebase-admin.js";

function classifyError(error: unknown): { code: string; statusCode: number; details?: unknown } {
  if (error instanceof ZodError) {
    return { code: "validation_error", statusCode: 400, details: error.flatten() };
  }

  if (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE"
  ) {
    return { code: "payload_too_large", statusCode: 413 };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return { code: "timeout", statusCode: 408 };
  }
  if (error instanceof Error && error.message === "mutation_lock_timeout") {
    return { code: "mutation_lock_timeout", statusCode: 503 };
  }
  if (error instanceof SourceOfTruthRequiredError) {
    return {
      code: "source_of_truth_required",
      statusCode: 503,
      details: { source: error.sourceLabel }
    };
  }

  return { code: "internal_error", statusCode: 500 };
}

let eventLoopDelayHistogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
try {
  eventLoopDelayHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelayHistogram.enable();
} catch {
  eventLoopDelayHistogram = null;
}

export function createApp(overrides?: Partial<AppEnv>): FastifyInstance {
  const env = { ...loadEnv(), ...overrides };
  markProcessBoot();
  const mapMarkersAdapter = new MapMarkersFirestoreAdapter();
  const shouldPrimeFirestoreOnReady = process.env.VITEST !== "true";

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: { translateTime: true, ignore: "pid,hostname" }
            }
          : undefined
    },
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    disableRequestLogging: true
  });

  app.decorate("config", env);
  attachErrorBufferToLogger(app.log as unknown as Record<string, unknown>);
  cacheMetricsCollector.setStatsProvider(() => globalCache.getRuntimeStats?.() ?? null);

  if (shouldPrimeFirestoreOnReady) {
    app.addHook("onReady", async () => {
      if (env.NODE_ENV !== "production") {
        await primeCoherenceProvider();
      }
      await primeFirestoreSourceClient();
      if (env.NODE_ENV !== "production") {
        await primeFirestoreMutationChannel();
      }
      if (env.NODE_ENV !== "production") {
        await primeMapMarkersRouteCache({
          adapter: mapMarkersAdapter,
          maxDocs: env.MAP_MARKERS_MAX_DOCS,
          ttlMs: env.MAP_MARKERS_CACHE_TTL_MS,
          log: app.log
        });
      }
    });
  }

  app.addHook("onRequest", (request, _reply, done) => {
    request.requestStartNs = process.hrtime.bigint();
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
    request.requestIdValue = requestId;

    const span = trace.getSpan(context.active());
    span?.setAttribute("http.request_id", requestId);

    request.log = request.log.child({ requestId, method: request.method, url: request.url });
    attachErrorBufferToLogger(request.log as unknown as Record<string, unknown>, () => ({
      requestId,
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      routeName: getRequestContext()?.routeName ?? null
    }));

    return runWithRequestContext(
      {
        requestId,
        route: request.url,
        method: request.method,
        startNs: request.requestStartNs,
        payloadBytes: 0,
        dbOps: { reads: 0, writes: 0, queries: 0 },
        cache: { hits: 0, misses: 0 },
        dedupe: { hits: 0, misses: 0 },
        concurrency: { waits: 0 },
        entityCache: { hits: 0, misses: 0 },
        entityConstruction: { total: 0, types: {} },
        idempotency: { hits: 0, misses: 0 },
        invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
        fallbacks: [],
        timeouts: [],
        surfaceTimings: {},
        orchestration: {
          surface: request.headers["x-locava-surface"]?.toString() ?? null,
          priority: request.headers["x-locava-priority"]?.toString() ?? null,
          requestGroup: request.headers["x-locava-request-group"]?.toString() ?? null,
          visiblePostId: request.headers["x-locava-visible-post-id"]?.toString() ?? null,
          screenInstanceId: request.headers["x-locava-screen-instance-id"]?.toString() ?? null,
          clientRequestId: request.headers["x-locava-client-request-id"]?.toString() ?? null,
          hydrationMode: request.headers["x-locava-hydration-mode"]?.toString() ?? null,
          stale: false,
          canceled: false,
          deduped: false,
          queueWaitMs: 0,
          blockedByStartupWarmers: false,
          eventLoopDelayMs: undefined,
          servedStale: false,
          optionalWorkSkipped: false
        },
        audit: {
          auditRunId: request.headers["x-audit-run-id"]?.toString(),
          auditSpecId: request.headers["x-audit-spec-id"]?.toString(),
          auditSpecName: request.headers["x-audit-spec-name"]?.toString()
        }
      },
      () => {
        const ctx = getRequestContext();
        if (ctx?.orchestration && eventLoopDelayHistogram) {
          ctx.orchestration.eventLoopDelayMs = Math.round(eventLoopDelayHistogram.mean / 1e6);
        }
        request.log.info({ event: "request_start" }, "incoming request");
        done();
      }
    );
  });

  app.addHook("preHandler", async (request) => {
    const inferred = inferRouteNameFromRequest(request.method, request.url);
    const policy = inferred ? getRoutePolicy(inferred) : undefined;
    await enterLowPriorityStartupGateIfNeeded(request, policy);
  });

  app.addHook("onSend", async (_request, _reply, payload) => {
    if (typeof payload === "string") {
      recordPayloadBytes(Buffer.byteLength(payload, "utf8"));
      return payload;
    }
    if (Buffer.isBuffer(payload)) {
      recordPayloadBytes(payload.byteLength);
      return payload;
    }
    if (payload == null) {
      recordPayloadBytes(0);
      return payload;
    }
    const serialized = JSON.stringify(payload);
    recordPayloadBytes(Buffer.byteLength(serialized, "utf8"));
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    releaseLowPriorityStartupGate(request);
    const latencyMs = Number(process.hrtime.bigint() - request.requestStartNs) / 1_000_000;
    const ctx = getRequestContext();
    const lane = ctx?.routePolicy?.lane;
    if (lane === "P1_NEXT_PLAYBACK" || lane === "P2_CURRENT_SCREEN") {
      markP1P2InteractiveRequest();
    }
    const budgetViolations: string[] = [];
    const policy = ctx?.routePolicy;
    if (policy) {
      if (latencyMs > policy.budgets.latency.p95Ms) {
        budgetViolations.push("latency_p95_exceeded");
      }
      if ((ctx?.dbOps.reads ?? 0) > policy.budgets.dbOps.maxReadsCold) {
        budgetViolations.push("db_reads_exceeded");
      }
      if ((ctx?.dbOps.queries ?? 0) > policy.budgets.dbOps.maxQueriesCold) {
        budgetViolations.push("db_queries_exceeded");
      }
      if ((ctx?.payloadBytes ?? 0) > policy.budgets.payload.maxBytes) {
        budgetViolations.push("payload_bytes_exceeded");
      }
    }
    const dbOps = ctx ? { ...ctx.dbOps } : { reads: 0, writes: 0, queries: 0 };
    const cache = ctx ? { ...ctx.cache } : { hits: 0, misses: 0 };
    const dedupe = ctx ? { ...ctx.dedupe } : { hits: 0, misses: 0 };
    const concurrency = ctx ? { ...ctx.concurrency } : { waits: 0 };
    const entityCache = ctx ? { ...ctx.entityCache } : { hits: 0, misses: 0 };
    const entityConstruction = ctx
      ? { total: ctx.entityConstruction.total, types: { ...ctx.entityConstruction.types } }
      : { total: 0, types: {} };
    const idempotency = ctx ? { ...ctx.idempotency } : { hits: 0, misses: 0 };
    const invalidation = ctx
      ? {
          keys: ctx.invalidation.keys,
          entityKeys: ctx.invalidation.entityKeys,
          routeKeys: ctx.invalidation.routeKeys,
          types: { ...ctx.invalidation.types }
        }
      : { keys: 0, entityKeys: 0, routeKeys: 0, types: {} };
    const fallbacks = ctx ? [...ctx.fallbacks] : [];
    const timeouts = ctx ? [...ctx.timeouts] : [];
    const surfaceTimings = ctx ? { ...ctx.surfaceTimings } : {};

    const requestDiagnostic = {
      requestId: request.requestIdValue,
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      routeName: ctx?.routeName,
      auditRunId: ctx?.audit?.auditRunId,
      auditSpecId: ctx?.audit?.auditSpecId,
      auditSpecName: ctx?.audit?.auditSpecName,
      routePolicy: ctx?.routePolicy,
      budgetViolations,
      statusCode: reply.statusCode,
      latencyMs: Number(latencyMs.toFixed(2)),
      payloadBytes: ctx?.payloadBytes ?? 0,
      dbOps,
      cache,
      dedupe,
      concurrency,
      entityCache,
      entityConstruction,
      idempotency,
      invalidation,
      fallbacks,
      timeouts,
      surfaceTimings,
      orchestration: ctx?.orchestration,
      timestamp: new Date().toISOString()
    };
    diagnosticsStore.addRequest(requestDiagnostic);
    requestMetricsCollector.record(requestDiagnostic);

    const verboseRequestLogs = process.env.BACKENDV2_VERBOSE_REQUEST_LOGS === "1";
    if (verboseRequestLogs) {
      request.log.info(
        {
          event: "request_complete",
          routeName: ctx?.routeName,
          statusCode: reply.statusCode,
          latencyMs: Number(latencyMs.toFixed(2)),
          payloadBytes: ctx?.payloadBytes ?? 0,
          routePriority: ctx?.orchestration?.priority ?? ctx?.routePolicy?.lane ?? ctx?.routePolicy?.priority ?? null,
          surface: ctx?.orchestration?.surface ?? null,
          requestGroup: ctx?.orchestration?.requestGroup ?? null,
          hydrationMode: ctx?.orchestration?.hydrationMode ?? null,
          stale: ctx?.orchestration?.stale ?? false,
          canceled: ctx?.orchestration?.canceled ?? false,
          deduped: ctx?.orchestration?.deduped ?? false,
          queueWaitMs: ctx?.orchestration?.queueWaitMs ?? 0,
          budgetViolations,
          dbOps: ctx?.dbOps ?? { reads: 0, writes: 0, queries: 0 },
          cache: ctx?.cache ?? { hits: 0, misses: 0 },
          dedupe: ctx?.dedupe ?? { hits: 0, misses: 0 },
          concurrency: ctx?.concurrency ?? { waits: 0 },
          entityCache: ctx?.entityCache ?? { hits: 0, misses: 0 },
          entityConstruction: ctx?.entityConstruction ?? { total: 0, types: {} },
          idempotency: ctx?.idempotency ?? { hits: 0, misses: 0 },
          invalidation: ctx?.invalidation ?? { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
          fallbacks: ctx?.fallbacks ?? [],
          timeouts: ctx?.timeouts ?? []
        },
        "request complete"
      );
    } else {
      request.log.info(
        {
          event: "request_complete",
          routeName: ctx?.routeName,
          routePolicyPriority: ctx?.routePolicy?.priority ?? null,
          routePolicyLane: ctx?.routePolicy?.lane ?? null,
          statusCode: reply.statusCode,
          latencyMs: Number(latencyMs.toFixed(2)),
          payloadBytes: ctx?.payloadBytes ?? 0,
          routePriority: ctx?.orchestration?.priority ?? ctx?.routePolicy?.lane ?? ctx?.routePolicy?.priority ?? null,
          surface: ctx?.orchestration?.surface ?? null,
          requestGroup: ctx?.orchestration?.requestGroup ?? null,
          hydrationMode: ctx?.orchestration?.hydrationMode ?? null,
          blockedByStartupWarmers: ctx?.orchestration?.blockedByStartupWarmers ?? false,
          schedulerQueueWaitMs: ctx?.orchestration?.queueWaitMs ?? 0,
          eventLoopDelayMs: ctx?.orchestration?.eventLoopDelayMs ?? null,
          cacheHit: (ctx?.cache?.hits ?? 0) > 0,
          cacheMiss: (ctx?.cache?.misses ?? 0) > 0,
          servedStale: ctx?.orchestration?.servedStale ?? false,
          optionalWorkSkipped: ctx?.orchestration?.optionalWorkSkipped ?? false,
          budgetViolations,
          dbOps: ctx?.dbOps ?? { reads: 0, writes: 0, queries: 0 },
          fallbacks: (ctx?.fallbacks ?? []).length,
          timeouts: (ctx?.timeouts ?? []).length
        },
        "request complete"
      );
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const classification = classifyError(error);
    request.analyticsErrorCode = classification.code;
    const errorCause =
      error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;

    request.log.error(
      {
        event: "request_error",
        code: classification.code,
        err: error,
        ...(errorCause !== undefined ? { errorCause } : {}),
        statusCode: classification.statusCode
      },
      "request failed"
    );

    const message = error instanceof Error ? error.message : "Unexpected error";
    return reply.status(classification.statusCode).send(failure(classification.code, message, classification.details));
  });

  app.register(registerSystemRoutes);
  app.register(registerTestRoutes);
  app.register(registerV2AuthBootstrapRoutes);
  app.register(registerV2AuthMutationRoutes);
  app.register(registerV2AuthPushTokenRoutes);
  app.register(registerV2AnalyticsEventsRoutes);
  app.register(async (instance) => {
    await registerProfilePictureUploadRoutes(instance, env);
  });
  app.register(registerV2FeedBootstrapRoutes);
  app.register(registerV2FeedForYouRoutes);
  app.register(registerV2FeedForYouSimpleRoutes);
  app.register(registerV2FeedPageRoutes);
  app.register(registerV2FeedItemDetailRoutes);
  app.register(registerV2ProfileRoutes);
  app.register(registerV2ProfileGridRoutes);
  app.register(registerV2ProfilePostDetailRoutes);
  app.register(registerV2SearchResultsRoutes);
  app.register(registerV2SearchUsersRoutes);
  app.register(registerV2SearchDiscoveryRoutes);
  app.register(registerV2SearchMixesRoutes);
  app.register(registerV2SearchHomeV1Routes);
  app.register(registerV2MixesRoutes);
  app.register(registerV2PlacesReverseGeocodeRoutes);
  app.register(registerV2SocialBatchRoutes);
  app.register(registerV2PostLikeRoutes);
  app.register(registerV2PostLikesRoutes);
  app.register(registerV2PostUnlikeRoutes);
  app.register(registerV2PostDeleteRoutes);
  app.register(registerV2PostsPublishRoutes);
  app.register(registerV2UserFollowRoutes);
  app.register(registerV2UserUnfollowRoutes);
  app.register(registerV2PostingUploadSessionRoutes);
  app.register(registerV2PostingStagingPresignRoutes);
  app.register(registerV2PostingFinalizeRoutes);
  app.register(registerV2PostingOperationStatusRoutes);
  app.register(registerV2PostingOperationCancelRoutes);
  app.register(registerV2PostingOperationRetryRoutes);
  app.register(registerV2PostingMediaRegisterRoutes);
  app.register(registerV2PostingMediaMarkUploadedRoutes);
  app.register(registerV2PostingMediaStatusRoutes);
  app.register(registerV2PostingLocationSuggestRoutes);
  app.register(registerV2PostingSongsRoutes);
  app.register(registerV2LegendsStagePostRoutes);
  app.register(registerV2LegendsStagePostCancelRoutes);
  app.register(registerV2LegendsMeBootstrapRoutes);
  app.register(registerV2LegendsScopeDetailRoutes);
  app.register(registerV2LegendsAfterPostRoutes);
  app.register(registerV2LegendsEventsRoutes);
  app.register(registerV2CommentsListRoutes);
  app.register(registerV2CommentsCreateRoutes);
  app.register(registerV2CommentsLikeRoutes);
  app.register(registerV2CommentsDeleteRoutes);
  app.register(registerV2NotificationsListRoutes);
  app.register(registerV2NotificationsMarkReadRoutes);
  app.register(registerV2NotificationsMarkAllReadRoutes);
  app.register(registerV2ChatsInboxRoutes);
  app.register(registerV2ChatsConversationRoutes);
  app.register(registerV2ChatsThreadRoutes);
  app.register(registerV2ChatsSendMessageRoutes);
  app.register(registerV2ChatsMarkReadRoutes);
  app.register(registerV2UsersLastActiveRoutes);
  app.register(registerV2ChatsMarkUnreadRoutes);
  app.register(registerV2ChatsCreateRoutes);
  app.register(async (instance) => {
    await registerV2ChatsGroupMediaRoutes(instance, env);
  });
  app.register(registerV2ChatsManageRoutes);
  app.register(registerV2ChatsMessageReactionRoutes);
  app.register(registerV2GroupsRoutes);
  app.register(registerV2InvitesRoutes);
  app.register(registerLaunchCompatRoutes);
  app.register(registerNativeProductShimRoutes);
  app.register(registerNativeEssentialCompatRoutes);
  app.register(registerCompatQrCodeRoutes);
  if (env.ENABLE_LEGACY_COMPAT_ROUTES) {
    app.register(async (instance) => {
      await registerLegacyProductUploadRoutes(instance, env);
      await registerLegacyMonolithUploadProxyRoutes(instance, env);
    });
    app.register(async (instance) => {
      registerLegacyMonolithAuthProxyRoutes(instance, env);
      await registerLegacyMonolithProductProxyRoutes(instance, env);
      await registerLegacyMonolithNotificationsProxyRoutes(instance, env);
    });
    app.register(async (instance) => {
      await registerLegacyApiStubRoutes(instance, env);
    });
    app.register(registerLegacyBootstrapCompatRoutes);
  }
  app.register(registerV2CollectionsSavedRoutes);
  app.register(registerV2CollectionsRoutes);
  app.register(registerV2PostsDetailRoutes);
  app.register(registerV2AchievementsHeroRoutes);
  app.register(registerV2AchievementsBootstrapRoutes);
  app.register(registerV2AchievementsSnapshotRoutes);
  app.register(registerV2AchievementsPendingDeltaRoutes);
  app.register(registerV2AchievementsPendingCelebrationsRoutes);
  app.register(registerV2AchievementsStatusRoutes);
  app.register(registerV2AchievementsBadgesRoutes);
  app.register(registerV2AchievementsClaimablesRoutes);
  app.register(registerV2AchievementsScreenOpenedRoutes);
  app.register(registerV2AchievementsLeaguesRoutes);
  app.register(registerV2AchievementsLeaderboardRoutes);
  app.register(registerV2AchievementsLeaderboardViewerRankRoutes);
  app.register(registerV2AchievementsLeaderboardAckRoutes);
  app.register(registerV2AchievementsClaimRoutes);
  app.register(registerV2AchievementsConsumeCelebrationRoutes);
  app.register(registerV2AchievementsClaimWeeklyCaptureRoutes);
  app.register(registerV2AchievementsClaimBadgeRoutes);
  app.register(registerV2AchievementsClaimChallengeRoutes);
  app.register(registerV2AchievementsClaimIntroBonusRoutes);
  app.register(registerV2MapBootstrapRoutes);
  app.register(registerV2MapMarkersRoutes);
  app.register(registerV2DirectoryUsersRoutes);
  app.register(registerV2SocialSuggestedFriendsRoutes);
  app.register(registerV2SocialContactsSyncRoutes);
  app.register(registerV2UsersSuggestedRoutes);
  app.register(registerLegacyReelsNearMeRoutes);
  app.register(registerVideoProcessorRoutes);
  app.register(registerInternalOpsRoutes);
  app.register(registerInternalHealthDashboardRoutes);
  app.register(registerAdminRoutes);
  app.register(registerPublicExpoPushRoutes);
  if (isLocalDevIdentityModeEnabled()) {
    app.register(registerLocalDebugRoutes);
    app.register(registerPublicFirestoreProbeRoutes);
  }
  app.register(registerPostRebuilderRoutes);

  app.addHook("onReady", async () => {
    const db = getFirestoreSourceClient();
    const identity = getFirestoreAdminIdentity();
    const safeIdentity =
      env.NODE_ENV === "production"
        ? {
            event: "firestore_admin_identity" as const,
            firestoreEnabled: db !== null,
            projectId: identity.projectId,
            credentialType: identity.credentialType,
            credentialsLoaded: identity.credentialsLoaded,
            hasServiceAccountEmail: Boolean(identity.serviceAccountEmail),
            credentialPathPresent: Boolean(identity.credentialPath)
          }
        : {
            event: "firestore_admin_identity" as const,
            firestoreEnabled: db !== null,
            projectId: identity.projectId,
            credentialType: identity.credentialType,
            serviceAccountEmail: identity.serviceAccountEmail,
            credentialsLoaded: identity.credentialsLoaded,
            credentialPath: identity.credentialPath
          };
    app.log.info(safeIdentity, "firestore admin runtime identity");
    app.log.info(
      {
        event: "local_dev_identity_mode",
        enabled: isLocalDevIdentityModeEnabled(),
        nodeEnv: env.NODE_ENV,
        debugViewerId: isLocalDevIdentityModeEnabled() ? resolveLocalDebugViewerId() : null
      },
      "local dev identity harness status"
    );
    if (env.NODE_ENV !== "production") {
      await runFirebaseAdminPermissionProbe().catch((error) => {
        app.log.error(
          {
            event: "firebase_admin_permission_probe_failed",
            message: error instanceof Error ? error.message : String(error)
          },
          "firebase admin permission probe failed"
        );
      });
    }

    const legacyCollide = legacyProxyLoopsToBackendTargets({
      legacyBaseUrl: env.LEGACY_MONOLITH_PROXY_BASE_URL,
      backendPublicUrls: [env.BACKEND_PUBLIC_BASE_URL]
    });
    if (legacyCollide) {
      app.log.error(
        {
          event: "legacy_monolith_proxy_target_matches_backend_public_url",
          detail:
            `LEGACY_MONOLITH_PROXY_BASE_URL origin matches BACKEND_PUBLIC_BASE_URL (${legacyCollide}). Misconfiguration routes classic proxy traffic back into Backendv2.`,
          enableLegacyCompat: env.ENABLE_LEGACY_COMPAT_ROUTES
        },
        "legacy_proxy_target_collision"
      );
    }
    logStartupTimeline("server_on_ready_complete", { nodeEnv: env.NODE_ENV });

    // Warm GeoNames places index in the background so first /v2/search/suggest hits are not seeds-only.
    searchPlacesIndexService.scheduleDeferredIdleLoad(Math.min(Math.max(startupGraceMs() + 500, 2000), 25_000));
  });

  return app;
}

async function primeMapMarkersRouteCache(input: {
  adapter: MapMarkersFirestoreAdapter;
  maxDocs: number;
  ttlMs: number;
  log: FastifyInstance["log"];
}): Promise<void> {
  const cacheKey = "map:markers:v2:all";
  const existing = await globalCache.get<MapMarkersResponse>(cacheKey);
  if (existing) return;
  try {
    const dataset = await input.adapter.fetchAll({ maxDocs: input.maxDocs });
    const cacheSource = dataset.queryCount > 0 || dataset.readCount > 0 ? "miss" : "hit";
    const payload: MapMarkersResponse = {
      routeName: "map.markers.get",
      markers: dataset.markers,
      count: dataset.count,
      generatedAt: dataset.generatedAt,
      version: dataset.version,
      etag: dataset.etag,
      diagnostics: {
        queryCount: dataset.queryCount,
        readCount: dataset.readCount,
        payloadBytes: Buffer.byteLength(JSON.stringify(dataset.markers), "utf8"),
        invalidCoordinateDrops: dataset.invalidCoordinateDrops,
        cacheSource
      }
    };
    await globalCache.set(cacheKey, payload, input.ttlMs);
  } catch (error) {
    input.log.warn(
      { reason: error instanceof Error ? error.message : String(error), routeName: "map.markers.get" },
      "map markers route cache prewarm skipped"
    );
  }
}
