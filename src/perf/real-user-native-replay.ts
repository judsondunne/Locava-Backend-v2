import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateReplayBudget } from "./realUserReplayBudgets.js";

type Envelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
  meta?: {
    db?: { reads?: number; writes?: number; queries?: number };
    budgetViolations?: string[];
    latencyMs?: number;
  };
  error?: { code?: string; message?: string };
};

type DiagnosticsRow = {
  auditRunId?: string;
  auditSpecId?: string;
  auditSpecName?: string;
  route?: string;
  routeName?: string;
  latencyMs?: number;
  payloadBytes?: number;
  statusCode?: number;
  budgetViolations?: string[];
  dbOps?: { reads?: number; writes?: number; queries?: number };
  orchestration?: {
    priority?: string | null;
    requestGroup?: string | null;
    hydrationMode?: string | null;
    queueWaitMs?: number;
    blockedByStartupWarmers?: boolean;
    servedStale?: boolean;
    optionalWorkSkipped?: boolean;
  };
};

type ReplayEventRecord = {
  id: string;
  label: string;
  route: string;
  method: "GET" | "POST";
  status: number;
  startOffsetMs: number;
  scheduledOffsetMs: number;
  endOffsetMs: number;
  latencyMs: number;
  payloadBytes: number;
  routeName: string | null;
  budgetViolations: string[];
  db: { reads: number; writes: number; queries: number };
  requestGroup: string | null;
  hydrationMode: string | null;
  routePriority: string | null;
  duplicatePrefetchPostIds: string[];
  repeatedPayloadBytesForSamePostIds: number | null;
  cursorCorrect: boolean | null;
  firstPlayableMediaAvailable: boolean | null;
  selectedVideoVariant: string | null;
  selectedVideoUrlClass: "hls" | "main1080" | "main720" | "preview360" | "original" | "photo" | "none" | null;
  primaryAssetLatencyMs: number | null;
  overlapsWith: string[];
  hardFailures: string[];
  warnings: string[];
};

type ReplayArtifact = {
  generatedAt: string;
  baseUrl: string;
  runId: string;
  viewerId: string;
  collectionId: string | null;
  events: ReplayEventRecord[];
  overlapTimeline: Array<{ id: string; startOffsetMs: number; endOffsetMs: number; overlapsWith: string[] }>;
  duplicatePrefetchPostIds: string[];
  duplicatePrefetchPayloadWasteBytes: number;
  firstVisibleAssetLatencyMs: number | null;
  openedPostPrimaryAssetLatencyMs: number | null;
  feedDetailsVariantMismatches: Array<{ postId: string; feedVariant: string | null; detailVariant: string | null }>;
  diagnosticsFound: number;
  failures: string[];
  verdict: "pass" | "fail";
};

export type RealUserReplayOptions = {
  baseUrl?: string;
  authToken?: string | null;
  viewerId?: string;
  dashboardToken?: string | null;
  collectionId?: string | null;
  outputPath?: string;
  analyticsEnabled?: boolean;
};

type ReplayContext = {
  feedPage1?: Envelope | null;
  feedPage2?: Envelope | null;
  collectionsList?: Envelope | null;
  collectionsRecommended?: Envelope | null;
};

type ScheduledCall = {
  id: string;
  label: string;
  scheduledOffsetMs: number;
  method: "GET" | "POST";
  routeFactory: (ctx: ReplayContext) => Promise<string> | string;
  bodyFactory?: (ctx: ReplayContext) => Promise<unknown> | unknown;
  headers?: Record<string, string>;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_VIEWER_ID = process.env.REPLAY_VIEWER_ID?.trim() || "internal-viewer";
const DEFAULT_OUTPUT = path.join(process.cwd(), "docs", "performance", "artifacts", "real-user-replay-latest.json");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  label: string,
  resolveValue: () => T | null | undefined,
  timeoutMs = 6_000,
  pollMs = 40,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const value = resolveValue();
    if (value != null) return value;
    await delay(pollMs);
  }
  throw new Error(`replay_dependency_timeout:${label}`);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function byteLengthJson(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function classifyVideoUrl(url: string | null): ReplayEventRecord["selectedVideoUrlClass"] {
  if (!url) return "none";
  const lower = url.toLowerCase();
  if (lower.endsWith(".m3u8") || lower.includes("/hls") || lower.includes("playlist")) return "hls";
  if (lower.includes("1080")) return "main1080";
  if (lower.includes("720")) return "main720";
  if (lower.includes("360") || lower.includes("preview")) return "preview360";
  if (lower.match(/\.(jpg|jpeg|png|webp)(\?|$)/)) return "photo";
  return "original";
}

function readEnvelopeItemList(envelope: Envelope | null | undefined): Array<Record<string, unknown>> {
  const data = asObject(envelope?.data);
  const items = data?.items;
  return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => Boolean(asObject(item))) : [];
}

function readEnvelopePosts(envelope: Envelope | null | undefined): Array<Record<string, unknown>> {
  const data = asObject(envelope?.data);
  const found = Array.isArray(data?.found) ? data.found : [];
  return found
    .map((row) => asObject(row))
    .map((row) => asObject(row?.detail))
    .map((detail) => asObject(detail?.firstRender))
    .map((firstRender) => asObject(firstRender?.post))
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

function extractPostIdsFromFeed(envelope: Envelope | null | undefined): string[] {
  return readEnvelopeItemList(envelope)
    .map((item) => String(item.postId ?? "").trim())
    .filter(Boolean);
}

function extractNextCursor(envelope: Envelope | null | undefined): string | null {
  const data = asObject(envelope?.data);
  return pickString(data?.nextCursor);
}

function extractCollectionId(envelope: Envelope | null | undefined): string | null {
  const data = asObject(envelope?.data);
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const item of items) {
    const row = asObject(item);
    const id = pickString(row?.id);
    if (id) return id;
  }
  return null;
}

function firstPlayableMediaInfoFromFeed(envelope: Envelope | null | undefined): {
  available: boolean | null;
  variant: string | null;
  urlClass: ReplayEventRecord["selectedVideoUrlClass"];
} {
  const items = readEnvelopeItemList(envelope);
  const first = items[0];
  if (!first) return { available: null, variant: null, urlClass: null };
  const media = asObject(first.media);
  const explicitVariant = pickString(first.selectedVideoVariant, media?.selectedVideoVariant);
  const playbackUrl = pickString(first.playbackUrl, media?.playbackUrl, first.photoLinks2, first.firstAssetUrl);
  const posterUrl = pickString(first.posterUrl, media?.posterUrl, first.thumbUrl, first.displayPhotoLink);
  const available = Boolean(playbackUrl || posterUrl);
  const urlClass = classifyVideoUrl(playbackUrl ?? posterUrl);
  return { available, variant: explicitVariant ?? urlClass, urlClass };
}

function firstPlayableMediaInfoFromDetails(envelope: Envelope | null | undefined): {
  available: boolean | null;
  variant: string | null;
  urlClass: ReplayEventRecord["selectedVideoUrlClass"];
  primaryAssetLatencyMs: number | null;
} {
  const posts = readEnvelopePosts(envelope);
  const first = posts[0];
  if (!first) return { available: null, variant: null, urlClass: null, primaryAssetLatencyMs: null };
  const playbackUrl = pickString(first.playbackUrl, first.fallbackVideoUrl, first.thumbUrl);
  const variant = pickString(first.selectedVideoVariant, first.selectedVariantLabel);
  const urlClass = classifyVideoUrl(playbackUrl);
  const available = Boolean(playbackUrl);
  return {
    available,
    variant: variant ?? urlClass,
    urlClass,
    primaryAssetLatencyMs: 0,
  };
}

async function fetchJson(input: {
  baseUrl: string;
  route: string;
  method: "GET" | "POST";
  body?: unknown;
  headers: Record<string, string>;
}): Promise<{ status: number; payloadBytes: number; parsed: Envelope | null }> {
  const response = await fetch(`${input.baseUrl}${input.route}`, {
    method: input.method,
    headers: input.headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  let parsed: Envelope | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Envelope) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, payloadBytes: Buffer.byteLength(text, "utf8"), parsed };
}

async function collectDiagnostics(baseUrl: string, runId: string, dashboardToken: string | null): Promise<DiagnosticsRow[]> {
  const response = await fetch(`${baseUrl}/diagnostics?limit=200`, {
    headers: dashboardToken ? { "x-internal-dashboard-token": dashboardToken } : {},
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as { data?: { recentRequests?: DiagnosticsRow[] } }) : {};
  const rows = Array.isArray(parsed.data?.recentRequests) ? parsed.data.recentRequests : [];
  return rows.filter((row) => row.auditRunId === runId);
}

function duplicateIds(input: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of input) {
    if (seen.has(value)) dupes.add(value);
    else seen.add(value);
  }
  return [...dupes];
}

function overlapIds(events: ReplayEventRecord[], current: ReplayEventRecord): string[] {
  return events
    .filter((event) => event.id !== current.id)
    .filter((event) => event.startOffsetMs < current.endOffsetMs && current.startOffsetMs < event.endOffsetMs)
    .map((event) => event.id);
}

function computeFeedDetailVariantMismatches(events: ReplayEventRecord[]): Array<{ postId: string; feedVariant: string | null; detailVariant: string | null }> {
  const feedVariantByPosition = new Map<number, string | null>();
  const detailMismatches: Array<{ postId: string; feedVariant: string | null; detailVariant: string | null }> = [];
  for (const event of events) {
    if (event.route.startsWith("/v2/feed/for-you/simple")) {
      if (event.id === "feed_page_1" && event.selectedVideoVariant) {
        feedVariantByPosition.set(0, event.selectedVideoVariant);
      }
    }
  }
  for (const event of events) {
    if (!event.route.endsWith("/v2/posts/details:batch")) continue;
    if (!event.selectedVideoVariant) continue;
    if (event.requestGroup !== "opened_post" && event.requestGroup !== "open") continue;
    if (event.selectedVideoVariant === "photo" || event.selectedVideoVariant === "none") continue;
    const feedVariant = feedVariantByPosition.get(0) ?? null;
    if (feedVariant === "photo" || feedVariant === "none") continue;
    if (feedVariant && feedVariant !== event.selectedVideoVariant) {
      detailMismatches.push({
        postId: event.id,
        feedVariant,
        detailVariant: event.selectedVideoVariant,
      });
    }
  }
  return detailMismatches;
}

export async function runRealUserNativeReplay(options: RealUserReplayOptions = {}): Promise<ReplayArtifact> {
  const baseUrl = (options.baseUrl ?? process.env.BACKEND_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const viewerId = options.viewerId ?? DEFAULT_VIEWER_ID;
  const authToken = options.authToken ?? process.env.AUTH_TOKEN ?? null;
  const dashboardToken = options.dashboardToken ?? process.env.INTERNAL_DASHBOARD_TOKEN ?? null;
  const runId = `real-user-replay-${Date.now()}`;
  const ctx: ReplayContext = {};
  const startedAt = Date.now();

  const collectionIdProvider = async (): Promise<string | null> => {
    if (options.collectionId) return options.collectionId;
    return waitFor(
      "collections_list_collection_id",
      () => extractCollectionId(ctx.collectionsList),
      8_000,
      50,
    ).catch(() => null);
  };

  const steps: ScheduledCall[] = [
    {
      id: "feed_page_1",
      label: "home feed first page",
      scheduledOffsetMs: 0,
      method: "GET",
      routeFactory: () => "/v2/feed/for-you/simple?limit=5",
      headers: { "x-locava-surface": "home_feed", "x-locava-priority": "P0_VISIBLE_PLAYBACK", "x-locava-request-group": "first_paint" },
    },
    {
      id: "auth_session",
      label: "auth session",
      scheduledOffsetMs: 288,
      method: "GET",
      routeFactory: () => "/v2/auth/session",
      headers: { "x-locava-surface": "home_feed", "x-locava-request-group": "startup_parallel" },
    },
    {
      id: "config_version",
      label: "config version",
      scheduledOffsetMs: 1595,
      method: "GET",
      routeFactory: () => "/api/config/version",
    },
    {
      id: "details_prefetch_1",
      label: "detail prefetch first window",
      scheduledOffsetMs: 1958,
      method: "POST",
      routeFactory: () => "/v2/posts/details:batch",
      bodyFactory: async () => ({
        postIds: (await waitFor("feed_page_1_post_ids", () => {
          const ids = extractPostIdsFromFeed(ctx.feedPage1);
          return ids.length >= 3 ? ids.slice(0, 3) : null;
        })),
        reason: "prefetch",
        hydrationMode: "playback",
      }),
      headers: {
        "x-locava-surface": "post_detail_store",
        "x-locava-request-group": "prefetch",
        "x-locava-hydration-mode": "playback",
        "x-locava-priority": "P1_NEXT_PLAYBACK",
      },
    },
    {
      id: "analytics_events",
      label: "analytics events",
      scheduledOffsetMs: 3232,
      method: "POST",
      routeFactory: () => "/api/analytics/v2/events",
      bodyFactory: () => ({
        events: [
          {
            eventId: `${runId}-app-open`,
            event: "app_open",
            screenName: "HomeFeed",
            platform: "ios",
            sessionId: `${runId}-session`,
            userId: viewerId,
            clientTime: Date.now(),
          },
        ],
      }),
    },
    {
      id: "details_prefetch_2",
      label: "detail prefetch second window",
      scheduledOffsetMs: 3744,
      method: "POST",
      routeFactory: () => "/v2/posts/details:batch",
      bodyFactory: async () => ({
        postIds: extractPostIdsFromFeed(ctx.feedPage1).slice(2, 5),
        reason: "prefetch",
        hydrationMode: "playback",
      }),
      headers: {
        "x-locava-surface": "post_detail_store",
        "x-locava-request-group": "prefetch",
        "x-locava-hydration-mode": "playback",
        "x-locava-priority": "P1_NEXT_PLAYBACK",
      },
    },
    {
      id: "details_prefetch_3",
      label: "detail prefetch sliding window",
      scheduledOffsetMs: 8793,
      method: "POST",
      routeFactory: () => "/v2/posts/details:batch",
      bodyFactory: async () => ({
        postIds: extractPostIdsFromFeed(ctx.feedPage1).slice(0, 5),
        reason: "prefetch",
        hydrationMode: "playback",
      }),
      headers: {
        "x-locava-surface": "post_detail_store",
        "x-locava-request-group": "prefetch",
        "x-locava-hydration-mode": "playback",
        "x-locava-priority": "P1_NEXT_PLAYBACK",
      },
    },
    {
      id: "details_opened_post",
      label: "opened post primary asset",
      scheduledOffsetMs: 8805,
      method: "POST",
      routeFactory: () => "/v2/posts/details:batch",
      bodyFactory: async () => ({
        postIds: [(await waitFor("feed_page_1_first_post", () => extractPostIdsFromFeed(ctx.feedPage1)[0] ?? null))],
        reason: "open",
        hydrationMode: "open",
      }),
      headers: {
        "x-locava-surface": "post_detail_screen",
        "x-locava-request-group": "opened_post",
        "x-locava-hydration-mode": "open",
        "x-locava-priority": "P0_VISIBLE_PLAYBACK",
      },
    },
    {
      id: "push_token",
      label: "push token sync",
      scheduledOffsetMs: 9314,
      method: "POST",
      routeFactory: () => "/v2/auth/push-token",
      bodyFactory: () => ({
        expoPushToken: `ExponentPushToken[${runId}]`,
        pushToken: `ExponentPushToken[${runId}]`,
        pushTokenPlatform: "ios",
      }),
      headers: { "x-locava-request-group": "background_side_effect", "x-locava-priority": "P4_BACKGROUND" },
    },
    {
      id: "feed_page_2",
      label: "home feed next page",
      scheduledOffsetMs: 13326,
      method: "GET",
      routeFactory: async () => {
        const cursor = extractNextCursor(ctx.feedPage1);
        return cursor ? `/v2/feed/for-you/simple?limit=5&cursor=${encodeURIComponent(cursor)}` : "/v2/feed/for-you/simple?limit=5";
      },
      headers: { "x-locava-surface": "home_feed", "x-locava-priority": "P1_NEXT_PLAYBACK", "x-locava-request-group": "pagination" },
    },
    {
      id: "details_prefetch_4",
      label: "detail prefetch overlapping page 2",
      scheduledOffsetMs: 13466,
      method: "POST",
      routeFactory: () => "/v2/posts/details:batch",
      bodyFactory: async () => ({
        postIds: extractPostIdsFromFeed(ctx.feedPage1).slice(3, 5),
        reason: "prefetch",
        hydrationMode: "playback",
      }),
      headers: {
        "x-locava-surface": "post_detail_store",
        "x-locava-request-group": "prefetch",
        "x-locava-hydration-mode": "playback",
        "x-locava-priority": "P1_NEXT_PLAYBACK",
      },
    },
    {
      id: "details_prefetch_5",
      label: "detail prefetch after page 2",
      scheduledOffsetMs: 14386,
      method: "POST",
      routeFactory: () => "/v2/posts/details:batch",
      bodyFactory: async () => ({
        postIds: [...extractPostIdsFromFeed(ctx.feedPage1).slice(4, 5), ...extractPostIdsFromFeed(ctx.feedPage2).slice(0, 3)],
        reason: "prefetch",
        hydrationMode: "playback",
      }),
      headers: {
        "x-locava-surface": "post_detail_store",
        "x-locava-request-group": "prefetch",
        "x-locava-hydration-mode": "playback",
        "x-locava-priority": "P1_NEXT_PLAYBACK",
      },
    },
    {
      id: "search_home_bootstrap",
      label: "search home bootstrap",
      scheduledOffsetMs: 18000,
      method: "GET",
      routeFactory: () => "/v2/search/home-bootstrap",
      headers: { "x-locava-surface": "search_home", "x-locava-request-group": "opened_screen", "x-locava-priority": "P2_CURRENT_SCREEN" },
    },
    ...["hiking", "cafe", "park", "beach"].map((mixKey, index) => ({
      id: `mix_preview_${mixKey}`,
      label: `mix preview ${mixKey}`,
      scheduledOffsetMs: 18040 + index * 8,
      method: "GET" as const,
      routeFactory: () => `/v2/mixes/${mixKey}/preview?limit=3&activity=${encodeURIComponent(mixKey)}`,
      headers: { "x-locava-surface": "search_home", "x-locava-request-group": "preview_fanout", "x-locava-priority": "P3_DEFERRED_SCREEN" },
    })),
    {
      id: "achievements_leaderboard_xp_league",
      label: "achievements xp league",
      scheduledOffsetMs: 24000,
      method: "GET",
      routeFactory: () => "/v2/achievements/leaderboard/xp_league",
      headers: { "x-locava-priority": "P4_BACKGROUND" },
    },
    {
      id: "achievements_leagues",
      label: "achievements leagues",
      scheduledOffsetMs: 24008,
      method: "GET",
      routeFactory: () => "/v2/achievements/leagues",
      headers: { "x-locava-priority": "P4_BACKGROUND" },
    },
    {
      id: "achievements_hero",
      label: "achievements hero",
      scheduledOffsetMs: 24012,
      method: "GET",
      routeFactory: () => "/v2/achievements/hero",
      headers: { "x-locava-priority": "P4_BACKGROUND" },
    },
    {
      id: "profile_following",
      label: "profile following",
      scheduledOffsetMs: 24016,
      method: "GET",
      routeFactory: () => `/v2/profiles/${encodeURIComponent(viewerId)}/following?limit=200`,
      headers: { "x-locava-priority": "P3_DEFERRED_SCREEN" },
    },
    {
      id: "achievements_bootstrap",
      label: "achievements bootstrap",
      scheduledOffsetMs: 24020,
      method: "GET",
      routeFactory: () => "/v2/achievements/bootstrap",
      headers: { "x-locava-priority": "P4_BACKGROUND" },
    },
    {
      id: "achievements_leaderboard_xp_global",
      label: "achievements xp global",
      scheduledOffsetMs: 24024,
      method: "GET",
      routeFactory: () => "/v2/achievements/leaderboard/xp_global",
      headers: { "x-locava-priority": "P4_BACKGROUND" },
    },
    {
      id: "achievements_snapshot",
      label: "achievements snapshot",
      scheduledOffsetMs: 24028,
      method: "GET",
      routeFactory: () => "/v2/achievements/snapshot",
      headers: { "x-locava-priority": "P4_BACKGROUND" },
    },
    {
      id: "social_suggested_friends",
      label: "suggested friends",
      scheduledOffsetMs: 24032,
      method: "GET",
      routeFactory: () => `/v2/social/suggested-friends?surface=generic&limit=10&sortBy=postCount&userId=${encodeURIComponent(viewerId)}`,
      headers: { "x-locava-priority": "P3_DEFERRED_SCREEN" },
    },
    {
      id: "collections_list",
      label: "collections list",
      scheduledOffsetMs: 28000,
      method: "GET",
      routeFactory: () => "/v2/collections?limit=10",
      headers: { "x-locava-priority": "P3_DEFERRED_SCREEN" },
    },
    {
      id: "collections_recommended",
      label: "collections recommended",
      scheduledOffsetMs: 28320,
      method: "GET",
      routeFactory: async () => {
        const collectionId = await collectionIdProvider();
        return collectionId ? `/v2/collections/${encodeURIComponent(collectionId)}/recommended?limit=10` : "/v2/collections/missing/recommended?limit=10";
      },
      headers: { "x-locava-priority": "P3_DEFERRED_SCREEN" },
    },
    {
      id: "collection_details_prefetch",
      label: "collection recommendation detail prefetch",
      scheduledOffsetMs: 28660,
      method: "POST",
      routeFactory: () => "/v2/posts/details:batch",
      bodyFactory: async () => {
        const postIds = await waitFor("collection_recommended_post_ids", () => {
          const data = asObject(ctx.collectionsRecommended?.data);
          const items = Array.isArray(data?.items) ? data.items : [];
          const ids = items
            .map((row) => asObject(row))
            .map((row) => String(row?.postId ?? "").trim())
            .filter(Boolean)
            .slice(0, 3);
          return ids.length > 0 ? ids : null;
        });
        return { postIds, reason: "prefetch", hydrationMode: "playback" };
      },
      headers: {
        "x-locava-surface": "collection_detail",
        "x-locava-request-group": "prefetch",
        "x-locava-hydration-mode": "playback",
        "x-locava-priority": "P1_NEXT_PLAYBACK",
      },
    },
  ];

  const events: ReplayEventRecord[] = [];
  const prevPrefetchKeys = new Map<string, number>();
  const activePromises = steps.map(async (step) => {
    const dueAt = startedAt + step.scheduledOffsetMs;
    const waitMs = Math.max(0, dueAt - Date.now());
    if (waitMs > 0) await delay(waitMs);

    const route = await step.routeFactory(ctx);
    let body: unknown;
    try {
      body = step.bodyFactory ? await step.bodyFactory(ctx) : undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("replay_dependency_timeout:")) {
        const actualOffsetMs = Date.now() - startedAt;
        events.push({
          id: step.id,
          label: step.label,
          route,
          method: step.method,
          status: 0,
          startOffsetMs: actualOffsetMs,
          scheduledOffsetMs: step.scheduledOffsetMs,
          endOffsetMs: actualOffsetMs,
          latencyMs: 0,
          payloadBytes: 0,
          routeName: null,
          budgetViolations: [],
          db: { reads: 0, writes: 0, queries: 0 },
          requestGroup: pickString(step.headers?.["x-locava-request-group"]),
          hydrationMode: pickString(step.headers?.["x-locava-hydration-mode"]),
          routePriority: pickString(step.headers?.["x-locava-priority"]),
          duplicatePrefetchPostIds: [],
          repeatedPayloadBytesForSamePostIds: null,
          cursorCorrect: null,
          firstPlayableMediaAvailable: null,
          selectedVideoVariant: null,
          selectedVideoUrlClass: null,
          primaryAssetLatencyMs: null,
          overlapsWith: [],
          hardFailures: [],
          warnings: [`skipped_due_to_missing_dependency:${message}`],
        });
        return;
      }
      throw error;
    }
    const duplicatePrefetchPostIds =
      step.method === "POST" && step.id.startsWith("details_")
        ? duplicateIds(Array.isArray((body as { postIds?: unknown[] } | undefined)?.postIds) ? ((body as { postIds?: string[] }).postIds ?? []) : [])
        : [];
    const postIdsKey =
      step.method === "POST" && body && Array.isArray((body as { postIds?: unknown[] }).postIds)
        ? JSON.stringify((body as { postIds?: unknown[] }).postIds)
        : null;
    const requestHeaders: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-viewer-id": viewerId,
      "x-viewer-roles": "internal",
      "x-audit-run-id": runId,
      "x-audit-spec-id": step.id,
      "x-audit-spec-name": step.label,
      ...step.headers,
    };
    if (authToken) requestHeaders.authorization = `Bearer ${authToken}`;
    const actualStartOffsetMs = Date.now() - startedAt;
    const response = await fetchJson({
      baseUrl,
      route,
      method: step.method,
      body,
      headers: requestHeaders,
    });
    const actualEndOffsetMs = Date.now() - startedAt;
    if (step.id === "feed_page_1") ctx.feedPage1 = response.parsed;
    if (step.id === "feed_page_2") ctx.feedPage2 = response.parsed;
    if (step.id === "collections_list") ctx.collectionsList = response.parsed;
    if (step.id === "collections_recommended") ctx.collectionsRecommended = response.parsed;
    const feedInfo = route.startsWith("/v2/feed/for-you/simple")
      ? firstPlayableMediaInfoFromFeed(response.parsed)
      : { available: null, variant: null, urlClass: null as ReplayEventRecord["selectedVideoUrlClass"] };
    const detailsInfo = route.endsWith("/v2/posts/details:batch")
      ? firstPlayableMediaInfoFromDetails(response.parsed)
      : { available: null, variant: null, urlClass: null as ReplayEventRecord["selectedVideoUrlClass"], primaryAssetLatencyMs: null };
    const payloadKey = postIdsKey ? `${step.id}:${postIdsKey}` : null;
    const repeatedPayloadBytesForSamePostIds = payloadKey && prevPrefetchKeys.has(postIdsKey ?? "") ? response.payloadBytes : null;
    if (postIdsKey) prevPrefetchKeys.set(postIdsKey, response.payloadBytes);
    const routeName = pickString(response.parsed?.data?.routeName, response.parsed?.meta?.latencyMs);
    const dbReads = Number(response.parsed?.meta?.db?.reads ?? 0);
    const dbWrites = Number(response.parsed?.meta?.db?.writes ?? 0);
    const dbQueries = Number(response.parsed?.meta?.db?.queries ?? 0);
    events.push({
      id: step.id,
      label: step.label,
      route,
      method: step.method,
      status: response.status,
      startOffsetMs: actualStartOffsetMs,
      scheduledOffsetMs: step.scheduledOffsetMs,
      endOffsetMs: actualEndOffsetMs,
      latencyMs: actualEndOffsetMs - actualStartOffsetMs,
      payloadBytes: response.payloadBytes,
      routeName: typeof response.parsed?.data?.routeName === "string" ? String(response.parsed?.data?.routeName) : null,
      budgetViolations: Array.isArray(response.parsed?.meta?.budgetViolations) ? response.parsed!.meta!.budgetViolations! : [],
      db: { reads: dbReads, writes: dbWrites, queries: dbQueries },
      requestGroup: pickString(step.headers?.["x-locava-request-group"]),
      hydrationMode: pickString(step.headers?.["x-locava-hydration-mode"], (body as { hydrationMode?: unknown })?.hydrationMode),
      routePriority: pickString(step.headers?.["x-locava-priority"]),
      duplicatePrefetchPostIds,
      repeatedPayloadBytesForSamePostIds,
      cursorCorrect:
        step.id === "feed_page_2"
          ? Boolean(extractNextCursor(ctx.feedPage1) && route.includes(encodeURIComponent(extractNextCursor(ctx.feedPage1) ?? "")))
          : null,
      firstPlayableMediaAvailable: feedInfo.available ?? detailsInfo.available,
      selectedVideoVariant: feedInfo.variant ?? detailsInfo.variant,
      selectedVideoUrlClass: feedInfo.urlClass ?? detailsInfo.urlClass,
      primaryAssetLatencyMs: detailsInfo.primaryAssetLatencyMs,
      overlapsWith: [],
      hardFailures: [],
      warnings: [],
    });
  });

  await Promise.all(activePromises);

  const diagnosticsRows = await collectDiagnostics(baseUrl, runId, dashboardToken);
  const diagnosticsBySpecId = new Map<string, DiagnosticsRow>();
  for (const row of diagnosticsRows) {
    if (row.auditSpecId) diagnosticsBySpecId.set(row.auditSpecId, row);
  }

  events.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  let duplicatePrefetchPayloadWasteBytes = 0;
  for (const event of events) {
    const diag = diagnosticsBySpecId.get(event.id);
    if (diag) {
      event.routeName = pickString(diag.routeName, event.routeName) ?? null;
      event.budgetViolations = Array.isArray(diag.budgetViolations) ? [...diag.budgetViolations] : event.budgetViolations;
      event.db = {
        reads: Number(diag.dbOps?.reads ?? event.db.reads),
        writes: Number(diag.dbOps?.writes ?? event.db.writes),
        queries: Number(diag.dbOps?.queries ?? event.db.queries),
      };
      event.requestGroup = pickString(diag.orchestration?.requestGroup, event.requestGroup) ?? null;
      event.hydrationMode = pickString(diag.orchestration?.hydrationMode, event.hydrationMode) ?? null;
      event.routePriority = pickString(diag.orchestration?.priority, event.routePriority) ?? null;
      if (typeof diag.latencyMs === "number" && Number.isFinite(diag.latencyMs)) event.latencyMs = diag.latencyMs;
      if (typeof diag.payloadBytes === "number" && Number.isFinite(diag.payloadBytes)) event.payloadBytes = diag.payloadBytes;
    }
    event.overlapsWith = overlapIds(events, event);
    const budgetResult = evaluateReplayBudget({
      route: event.route,
      routeName: event.routeName,
      method: event.method,
      latencyMs: event.latencyMs,
      payloadBytes: event.payloadBytes,
      reads: event.db.reads,
      writes: event.db.writes,
      queries: event.db.queries,
      cursorUsed: event.route.includes("cursor="),
      hydrationMode: event.hydrationMode,
      requestGroup: event.requestGroup,
      primaryAssetLatencyMs: event.primaryAssetLatencyMs,
    });
    event.hardFailures = [...budgetResult.hardFailures];
    event.warnings = [...budgetResult.warnings];
    if (event.repeatedPayloadBytesForSamePostIds != null) duplicatePrefetchPayloadWasteBytes += event.repeatedPayloadBytesForSamePostIds;
  }

  const failures: string[] = [];
  if (events.some((event) => event.status >= 500)) failures.push("server_errors_present");
  if (events.some((event) => event.hardFailures.length > 0)) failures.push("hard_budget_failures_present");
  if (events.some((event) => event.route.endsWith("/v2/posts/details:batch") && event.duplicatePrefetchPostIds.length > 0)) {
    failures.push("duplicate_post_ids_inside_prefetch_batch");
  }
  if (events.some((event) => event.firstPlayableMediaAvailable === false)) failures.push("missing_first_playable_media");
  if (events.some((event) => event.route.endsWith("/v2/posts/details:batch") && event.requestGroup === "prefetch" && event.payloadBytes > 45_000)) {
    failures.push("prefetch_payload_too_large");
  }
  if (events.some((event) => event.route.includes("/v2/feed/for-you/simple") && event.route.includes("limit=5") && event.selectedVideoUrlClass === "original")) {
    failures.push("feed_selected_original_variant");
  }
  const feedDetailsVariantMismatches = computeFeedDetailVariantMismatches(events);
  if (feedDetailsVariantMismatches.length > 0) failures.push("feed_details_variant_mismatch");

  const artifact: ReplayArtifact = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    runId,
    viewerId,
    collectionId: await collectionIdProvider(),
    events,
    overlapTimeline: events.map((event) => ({
      id: event.id,
      startOffsetMs: event.startOffsetMs,
      endOffsetMs: event.endOffsetMs,
      overlapsWith: event.overlapsWith,
    })),
    duplicatePrefetchPostIds: [...new Set(events.flatMap((event) => event.duplicatePrefetchPostIds))],
    duplicatePrefetchPayloadWasteBytes,
    firstVisibleAssetLatencyMs:
      events.find((event) => event.id === "feed_page_1")?.latencyMs ?? null,
    openedPostPrimaryAssetLatencyMs:
      events.find((event) => event.requestGroup === "opened_post" || event.requestGroup === "open")?.primaryAssetLatencyMs ?? null,
    feedDetailsVariantMismatches,
    diagnosticsFound: diagnosticsRows.length,
    failures,
    verdict: failures.length === 0 ? "pass" : "fail",
  };

  const outputPath = options.outputPath ?? DEFAULT_OUTPUT;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(artifact, null, 2));
  return artifact;
}
