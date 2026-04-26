import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { diagnosticsStore, type RequestDiagnostic } from "../../observability/diagnostics-store.js";
import { isLocalDevIdentityModeEnabled, resolveLocalDevIdentityContext } from "../../lib/local-dev-identity.js";

const LocalViewerQuerySchema = z.object({
  viewerId: z.string().min(1).optional(),
  internal: z.coerce.boolean().optional().default(true)
});

/** Subset of HTTP verbs supported by `app.inject` typings (excludes e.g. TRACE). */
type LocalDebugHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

type DebugRouteCall = {
  method: LocalDebugHttpMethod;
  path: string;
  body?: unknown;
  explicitViewerId?: string;
  internal: boolean;
};

type LocalDebugRouteResult = {
  canonicalRoute: string;
  statusCode: number;
  ok: boolean;
  envelopeOk: boolean | null;
  usedRealFirestoreData: boolean;
  ids: string[];
  counts: Record<string, number>;
  timingMs: { total: number; routeLatency: number | null };
  fallbackUsage: string[];
  timeoutUsage: string[];
  legacyPathUsage: boolean;
  verificationNotes: string[];
  envelopeMeta: unknown;
  responseData: unknown;
  responseError: unknown;
  effectiveViewerId: string;
  localDevIdentityModeUsed: boolean;
  usedDefaultViewerId: boolean;
};

type InjectLiteReply = { statusCode: number; payload: string };

type ParsedEnvelope = {
  ok?: boolean;
  data?: unknown;
  error?: unknown;
  meta?: { requestId?: string; latencyMs?: number; db?: unknown };
};

function parseJsonPayload(payload: string): ParsedEnvelope | null {
  if (!payload || payload.length === 0) {
    return null;
  }
  try {
    return JSON.parse(payload) as ParsedEnvelope;
  } catch {
    return null;
  }
}

function findDiagnostic(requestId: string | undefined): RequestDiagnostic | null {
  if (!requestId) return null;
  const recent = diagnosticsStore.getRecentRequests(200);
  return recent.find((row) => row.requestId === requestId) ?? null;
}

function summarizePayload(payload: unknown): { counts: Record<string, number>; ids: string[] } {
  const counts: Record<string, number> = {};
  const ids: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      counts.arrayItems = (counts.arrayItems ?? 0) + value.length;
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (Array.isArray(nested)) {
        counts[key] = nested.length;
      } else if (typeof nested === "string" && /(id|Id|ID)$/.test(key)) {
        ids.push(nested);
      } else if (nested && typeof nested === "object") {
        visit(nested);
      }
    }
  };

  visit(payload);
  return { counts, ids: [...new Set(ids)].slice(0, 20) };
}

async function callCanonicalRoute(app: FastifyInstance, input: DebugRouteCall): Promise<LocalDebugRouteResult> {
  const startedAtMs = Date.now();
  const identity = resolveLocalDevIdentityContext(input.explicitViewerId);
  const headers: Record<string, string> = {
    "x-viewer-id": identity.viewerId,
    "x-viewer-roles": input.internal ? "internal" : ""
  };
  if (input.body !== undefined) headers["content-type"] = "application/json";
  const payloadStr =
    input.body === undefined ? undefined : typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  const response = (await app.inject({
    method: input.method,
    url: input.path,
    headers,
    ...(payloadStr !== undefined ? { payload: payloadStr } : {})
  })) as InjectLiteReply;
  const elapsedMs = Date.now() - startedAtMs;
  const envelope = parseJsonPayload(response.payload);
  const diagnostic = findDiagnostic(envelope?.meta?.requestId);
  const payloadSummary = summarizePayload(envelope?.data);
  const legacyPathUsed = input.path.startsWith("/api/");
  app.log.info(
    { debugRoutePath: input.path, effectiveViewerId: identity.viewerId, localDevIdentityModeUsed: identity.localDevIdentityModeEnabled },
    "local debug identity applied"
  );

  return {
    canonicalRoute: `${input.method} ${input.path}`,
    statusCode: response.statusCode,
    ok: response.statusCode >= 200 && response.statusCode < 300,
    envelopeOk: envelope?.ok ?? null,
    usedRealFirestoreData: Boolean(diagnostic && (diagnostic.dbOps.reads > 0 || diagnostic.dbOps.queries > 0)),
    ids: payloadSummary.ids,
    counts: payloadSummary.counts,
    timingMs: {
      total: elapsedMs,
      routeLatency: diagnostic?.latencyMs ?? null
    },
    fallbackUsage: diagnostic?.fallbacks ?? [],
    timeoutUsage: diagnostic?.timeouts ?? [],
    legacyPathUsage: legacyPathUsed,
    verificationNotes: [
      diagnostic?.routeName ? `routeName=${diagnostic.routeName}` : "routeName=unknown",
      `requestId=${envelope?.meta?.requestId ?? "unknown"}`
    ],
    envelopeMeta: envelope?.meta ?? null,
    responseData: envelope?.data ?? null,
    responseError: envelope?.error ?? null,
    effectiveViewerId: identity.viewerId,
    localDevIdentityModeUsed: identity.localDevIdentityModeEnabled,
    usedDefaultViewerId: identity.usedDefaultViewerId
  };
}

export async function registerLocalDebugRoutes(app: FastifyInstance): Promise<void> {
  if (!isLocalDevIdentityModeEnabled()) {
    app.log.info({ routeFamily: "/debug/local/*" }, "local debug routes disabled (ENABLE_LOCAL_DEV_IDENTITY!=1)");
    return;
  }

  app.get("/debug/local/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/bootstrap",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/auth/session", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/auth/session",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/auth/check-handle", async (request) => {
    const query = LocalViewerQuerySchema.extend({ handle: z.string().min(1).default("locava_debug_handle") }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/auth/check-handle?handle=${encodeURIComponent(query.handle)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/auth/check-user-exists", async (request) => {
    const query = LocalViewerQuerySchema.extend({ email: z.string().email() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/auth/check-user-exists?email=${encodeURIComponent(query.email)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/profile/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap`,
      explicitViewerId: viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/profile/grid/:userId", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(24).optional(), cursor: z.string().optional() }).parse(
      request.query
    );
    const q = new URLSearchParams();
    q.set("limit", String(query.limit ?? 12));
    if (query.cursor) q.set("cursor", query.cursor);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/profiles/${encodeURIComponent(params.userId)}/grid?${q.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/profile/post-detail/:userId/:postId", async (request) => {
    const params = z.object({ userId: z.string().min(1), postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/profiles/${encodeURIComponent(params.userId)}/posts/${encodeURIComponent(params.postId)}/detail`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/chats/inbox", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    const limit = query.limit ?? 20;
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/chats/inbox?limit=${String(limit)}`,
      explicitViewerId: viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/chats/thread/:conversationId", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(50).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/messages?limit=${String(query.limit ?? 30)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/search/users", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("a"), limit: z.coerce.number().int().min(1).max(20).optional() }).parse(
      request.query
    );
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/search/users?q=${encodeURIComponent(query.q)}&limit=${String(query.limit ?? 12)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/search/results", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("jo"), limit: z.coerce.number().int().min(4).max(12).optional() }).parse(
      request.query
    );
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/search/results?q=${encodeURIComponent(query.q)}&limit=${String(query.limit ?? 8)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/collections/list", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/collections?limit=${String(query.limit ?? 20)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/collections/detail/:collectionId", async (request) => {
    const params = z.object({ collectionId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/collections/${encodeURIComponent(params.collectionId)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/collections", async (request) => {
    const query = LocalViewerQuerySchema.extend({
      limit: z.coerce.number().int().min(1).max(20).optional(),
      postId: z.string().optional()
    }).parse(request.query);
    const created = await callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/collections",
      body: { name: `Debug Collection ${Date.now()}` },
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
    const list = await callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/collections?limit=${String(query.limit ?? 12)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
    let save: LocalDebugRouteResult | null = null;
    let posts: LocalDebugRouteResult | null = null;
    if (query.postId && created.ok && created.responseData && typeof created.responseData === "object") {
      save = await callCanonicalRoute(app, {
        method: "POST",
        path: `/v2/posts/${encodeURIComponent(query.postId)}/save`,
        explicitViewerId: query.viewerId,
        internal: query.internal
      });
      const createdItem = (created.responseData as { item?: { id?: string } }).item;
      if (createdItem?.id) {
        posts = await callCanonicalRoute(app, {
          method: "GET",
          path: `/v2/collections/${encodeURIComponent(createdItem.id)}/posts?limit=${String(query.limit ?? 12)}`,
          explicitViewerId: query.viewerId,
          internal: query.internal
        });
      }
    }
    return {
      canonicalRoute: "aggregate collections flow",
      usedRealFirestoreData: Boolean(created.usedRealFirestoreData || list.usedRealFirestoreData || save?.usedRealFirestoreData || posts?.usedRealFirestoreData),
      legacyPathUsage: false,
      counts: { createdStatus: created.statusCode, listStatus: list.statusCode },
      ids: [...created.ids, ...list.ids],
      timingMs: { total: (created.timingMs.total ?? 0) + (list.timingMs.total ?? 0) + (save?.timingMs.total ?? 0) + (posts?.timingMs.total ?? 0) },
      fallbackUsage: [...created.fallbackUsage, ...list.fallbackUsage, ...(save?.fallbackUsage ?? []), ...(posts?.fallbackUsage ?? [])],
      effectiveViewerId: created.effectiveViewerId,
      localDevIdentityModeUsed: created.localDevIdentityModeUsed,
      usedDefaultViewerId: created.usedDefaultViewerId,
      verificationNotes: ["create -> list -> optional save -> optional list posts"],
      created,
      list,
      save,
      posts
    };
  });

  app.get("/debug/local/achievements/snapshot", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/snapshot",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/hero", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/hero",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/pending-delta", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/pending-delta",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/status", async (request) => {
    const query = LocalViewerQuerySchema.extend({ lat: z.string().optional(), long: z.string().optional() }).parse(request.query);
    const params = new URLSearchParams();
    if (query.lat) params.set("lat", query.lat);
    if (query.long) params.set("long", query.long);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/achievements/status${params.size ? `?${params.toString()}` : ""}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/badges", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/badges",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/leagues", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/achievements/leagues",
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/achievements/leaderboard/:scope", async (request) => {
    const params = z.object({ scope: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ leagueId: z.string().optional() }).parse(request.query);
    const suffix = query.leagueId ? `?leagueId=${encodeURIComponent(query.leagueId)}` : "";
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/achievements/leaderboard/${encodeURIComponent(params.scope)}${suffix}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/notifications/list", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/notifications?limit=${String(query.limit ?? 20)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/directory/users", async (request) => {
    const query = LocalViewerQuerySchema.extend({
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(20).optional(),
      excludeUserIds: z.string().optional()
    }).parse(request.query);
    const params = new URLSearchParams();
    params.set("limit", String(query.limit ?? 10));
    if (query.q) params.set("q", query.q);
    if (query.excludeUserIds) params.set("excludeUserIds", query.excludeUserIds);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/directory/users?${params.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/map/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.extend({
      bbox: z.string().optional(),
      limit: z.coerce.number().int().min(20).max(300).optional()
    }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/map/bootstrap?bbox=${encodeURIComponent(query.bbox ?? "-122.55,37.68,-122.30,37.84")}&limit=${String(query.limit ?? 120)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/feed/bootstrap", async (request) => {
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(4).max(12).optional() }).parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/feed/bootstrap?limit=${String(query.limit ?? 8)}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/feed/page", async (request) => {
    const query = LocalViewerQuerySchema.extend({ cursor: z.string().optional(), limit: z.coerce.number().int().min(4).max(12).optional() }).parse(
      request.query
    );
    const params = new URLSearchParams();
    params.set("limit", String(query.limit ?? 8));
    if (query.cursor) params.set("cursor", query.cursor);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/feed/page?${params.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/feed/item-detail/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/feed/items/${encodeURIComponent(params.postId)}/detail`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/posts/detail/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.parse(request.query);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/detail`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.get("/debug/local/viewer/account-state", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const identity = resolveLocalDevIdentityContext(query.viewerId);
    const viewerId = identity.viewerId;
    const authSession = await callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/auth/session",
      explicitViewerId: viewerId,
      internal: query.internal
    });
    const bootstrap = await callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/bootstrap",
      explicitViewerId: viewerId,
      internal: query.internal
    });
    const authSessionSecondRead = await callCanonicalRoute(app, {
      method: "GET",
      path: "/v2/auth/session",
      explicitViewerId: viewerId,
      internal: query.internal
    });
    return {
      canonicalRoute: "aggregate viewer/account-state",
      explicitViewerId: viewerId,
      usedRealFirestoreData:
        Boolean(authSession.usedRealFirestoreData) ||
        Boolean(bootstrap.usedRealFirestoreData) ||
        Boolean(authSessionSecondRead.usedRealFirestoreData),
      timingMs: {
        total: Number(
          (
            Number(authSession.timingMs?.total ?? 0) +
            Number(bootstrap.timingMs?.total ?? 0) +
            Number(authSessionSecondRead.timingMs?.total ?? 0)
          ).toFixed(2)
        )
      },
      fallbackUsage: [
        ...(Array.isArray(authSession.fallbackUsage) ? authSession.fallbackUsage : []),
        ...(Array.isArray(bootstrap.fallbackUsage) ? bootstrap.fallbackUsage : []),
        ...(Array.isArray(authSessionSecondRead.fallbackUsage) ? authSessionSecondRead.fallbackUsage : [])
      ],
      legacyPathUsage: false,
      effectiveViewerId: identity.viewerId,
      localDevIdentityModeUsed: identity.localDevIdentityModeEnabled,
      usedDefaultViewerId: identity.usedDefaultViewerId,
      verificationNotes: ["Verifies v2 auth session/bootstrap consistency across consecutive reads"],
      authSession,
      bootstrap,
      authSessionSecondRead
    };
  });

  app.get("/debug/local/rails/legacy-usage", async () => {
    const identity = resolveLocalDevIdentityContext();
    const contracts = (await app.inject({ method: "GET", url: "/routes" })) as InjectLiteReply;
    const routesPayload = parseJsonPayload(contracts.payload);
    const rows = Array.isArray((routesPayload?.data as { routes?: unknown[] } | undefined)?.routes)
      ? (((routesPayload?.data as { routes?: unknown[] }).routes ?? []) as Array<{ path?: string }>)
      : [];
    const legacyRoutesFromContract = rows
      .map((row) => row.path ?? "")
      .filter((path) => path.startsWith("/api/") || path.startsWith("/api/v1/product/"));
    const knownCompatCandidates = [
      { method: "GET", url: "/api/v1/product/session/bootstrap" },
      { method: "GET", url: "/api/v1/product/profile/bootstrap" },
      { method: "PATCH", url: "/api/v1/product/viewer" },
      { method: "PUT", url: "/api/users/:userId" }
    ] as const;
    const registeredCompat = knownCompatCandidates
      .filter((candidate) => app.hasRoute({ method: candidate.method, url: candidate.url }))
      .map((candidate) => candidate.url);
    const legacyRoutes = [...new Set([...legacyRoutesFromContract, ...registeredCompat])];
    return {
      canonicalRoute: "GET /routes",
      usedRealFirestoreData: false,
      legacyPathUsage: legacyRoutes.length > 0,
      counts: { legacyRouteCount: legacyRoutes.length },
      ids: [],
      timingMs: { total: 0 },
      fallbackUsage: [],
      effectiveViewerId: identity.viewerId,
      localDevIdentityModeUsed: identity.localDevIdentityModeEnabled,
      usedDefaultViewerId: identity.usedDefaultViewerId,
      verificationNotes: ["Route registry scan for legacy namespaces"],
      legacyRoutes
    };
  });

  app.post("/debug/local/chats/create-direct", async (request) => {
    const body = z.object({ otherUserId: z.string().min(1), viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/chats/create-or-get",
      body: { otherUserId: body.otherUserId },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/chats/:conversationId/send", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        viewerId: z.string().min(1).optional(),
        messageType: z.enum(["text", "photo", "gif"]).optional(),
        text: z.string().optional(),
        photoUrl: z.string().url().optional(),
        gifUrl: z.string().url().optional(),
        clientMessageId: z.string().min(8).max(128).optional()
      })
      .parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/messages`,
      body: {
        messageType: body.messageType ?? "text",
        text: body.text ?? `debug-harness-message-${Date.now()}`,
        photoUrl: body.photoUrl,
        gifUrl: body.gifUrl,
        clientMessageId: body.clientMessageId ?? `debug-${Date.now()}`
      },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/chats/:conversationId/mark-read", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/mark-read`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/chats/:conversationId/mark-unread", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/mark-unread`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.put("/debug/local/chats/:conversationId/typing-status", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional(), isTyping: z.boolean().optional().default(true) }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "PUT",
      path: `/v2/chats/${encodeURIComponent(params.conversationId)}/typing-status`,
      body: { isTyping: body.isTyping },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/collections/create", async (request) => {
    const body = z
      .object({
        viewerId: z.string().min(1).optional(),
        name: z.string().min(1).default(`Debug Collection ${new Date().toISOString()}`),
        description: z.string().optional().default("Created by local debug harness"),
        privacy: z.enum(["public", "private"]).optional().default("private")
      })
      .parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/collections",
      body: {
        name: body.name,
        description: body.description,
        privacy: body.privacy,
        collaborators: [],
        items: []
      },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  

  app.post("/debug/local/posts/:postId/like", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/like`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/posts/:postId/unlike", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/unlike`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/posts/:postId/save", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/save`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/posts/:postId/unsave", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/unsave`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.get("/debug/local/comments/list/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const query = LocalViewerQuerySchema.extend({ limit: z.coerce.number().int().min(5).max(20).optional(), cursor: z.string().optional() }).parse(
      request.query
    );
    const q = new URLSearchParams();
    q.set("limit", String(query.limit ?? 10));
    if (query.cursor) q.set("cursor", query.cursor);
    return callCanonicalRoute(app, {
      method: "GET",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/comments?${q.toString()}`,
      explicitViewerId: query.viewerId,
      internal: query.internal
    });
  });

  app.post("/debug/local/comments/create/:postId", async (request) => {
    const params = z.object({ postId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional(), text: z.string().min(1).max(400).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/posts/${encodeURIComponent(params.postId)}/comments`,
      body: { text: body.text ?? `debug comment ${new Date().toISOString()}`, clientMutationKey: `debug-comment-${Date.now()}` },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/comments/like/:commentId", async (request) => {
    const params = z.object({ commentId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/comments/${encodeURIComponent(params.commentId)}/like`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/users/:userId/follow", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/users/${encodeURIComponent(params.userId)}/follow`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/users/:userId/unfollow", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: `/v2/users/${encodeURIComponent(params.userId)}/unfollow`,
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/notifications/mark-read", async (request) => {
    const body = z
      .object({
        viewerId: z.string().min(1).optional(),
        notificationIds: z.array(z.string().min(1)).min(1).max(20)
      })
      .parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/notifications/mark-read",
      body: { notificationIds: body.notificationIds },
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/notifications/mark-all-read", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/notifications/mark-all-read",
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/achievements/screen-opened", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/achievements/screen-opened",
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.post("/debug/local/achievements/ack-leaderboard-event", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional() }).parse(request.body ?? {});
    return callCanonicalRoute(app, {
      method: "POST",
      path: "/v2/achievements/ack-leaderboard-event",
      explicitViewerId: body.viewerId,
      internal: true
    });
  });

  app.get("/debug/local-run/feed", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const startedAt = Date.now();
    const bootstrap = await callCanonicalRoute(app, { method: "GET", path: "/v2/feed/bootstrap?limit=8", explicitViewerId: query.viewerId, internal: query.internal });
    const page = await callCanonicalRoute(app, { method: "GET", path: "/v2/feed/page?limit=8", explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "feed", ok: Boolean(bootstrap.ok) && Boolean(page.ok), timingMs: Date.now() - startedAt, effectiveViewerId: bootstrap.effectiveViewerId, checks: [bootstrap, page] };
  });

  app.get("/debug/local-run/profile", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const startedAt = Date.now();
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    const profile = await callCanonicalRoute(app, { method: "GET", path: `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap`, explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "profile", ok: Boolean(profile.ok), timingMs: Date.now() - startedAt, effectiveViewerId: profile.effectiveViewerId, checks: [profile] };
  });

  app.get("/debug/local-run/chats", async (request) => {
    const query = LocalViewerQuerySchema.parse(request.query);
    const startedAt = Date.now();
    const inbox = await callCanonicalRoute(app, { method: "GET", path: "/v2/chats/inbox?limit=10", explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "chats", ok: Boolean(inbox.ok), timingMs: Date.now() - startedAt, effectiveViewerId: inbox.effectiveViewerId, checks: [inbox] };
  });

  app.get("/debug/local-run/search", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("jo") }).parse(request.query);
    const startedAt = Date.now();
    const users = await callCanonicalRoute(app, { method: "GET", path: `/v2/search/users?q=${encodeURIComponent(query.q)}&limit=10`, explicitViewerId: query.viewerId, internal: query.internal });
    const results = await callCanonicalRoute(app, { method: "GET", path: `/v2/search/results?q=${encodeURIComponent(query.q)}&limit=8`, explicitViewerId: query.viewerId, internal: query.internal });
    return { run: "search", ok: Boolean(users.ok) && Boolean(results.ok), timingMs: Date.now() - startedAt, effectiveViewerId: users.effectiveViewerId, checks: [users, results] };
  });

  app.get("/debug/local-run/full-app", async (request) => {
    const query = LocalViewerQuerySchema.extend({ q: z.string().min(2).default("jo") }).parse(request.query);
    const startedAt = Date.now();
    const viewerId = resolveLocalDevIdentityContext(query.viewerId).viewerId;
    const feed = await callCanonicalRoute(app, { method: "GET", path: "/v2/feed/bootstrap?limit=8", explicitViewerId: query.viewerId, internal: query.internal });
    const profile = await callCanonicalRoute(app, { method: "GET", path: `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap`, explicitViewerId: query.viewerId, internal: query.internal });
    const chats = await callCanonicalRoute(app, { method: "GET", path: "/v2/chats/inbox?limit=10", explicitViewerId: query.viewerId, internal: query.internal });
    const search = await callCanonicalRoute(app, { method: "GET", path: `/v2/search/users?q=${encodeURIComponent(query.q)}&limit=10`, explicitViewerId: query.viewerId, internal: query.internal });
    const checks = [feed, profile, chats, search];
    return { run: "full-app", ok: checks.every((row) => Boolean(row.ok)), timingMs: Date.now() - startedAt, effectiveViewerId: feed.effectiveViewerId, checks };
  });
}
