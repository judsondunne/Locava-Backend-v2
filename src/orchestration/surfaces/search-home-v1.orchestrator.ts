import { getRequestContext } from "../../observability/request-context.js";
import { MixPostsRepository } from "../../repositories/mixPosts.repository.js";
import { globalCache } from "../../cache/global-cache.js";
import { SearchHomeV1Service } from "../../services/surfaces/search-home-v1.service.js";
import {
  normalizeActivityTagForSearchHome,
  resolveSearchHomeV1ActivityAliases,
  resolveSearchHomeV1MixCanonicalKey,
} from "../../services/surfaces/search-home-v1.activity-aliases.js";
import { filterPreviewRowsForActivity } from "../../services/surfaces/search-home-v1.projection.js";
import type { SearchHomeV1BuildResult } from "../../services/surfaces/search-home-v1.service.js";

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

type HomeCore = {
  version: 1;
  viewerId: string;
  generatedAt: string;
  suggestedUsers: SearchHomeV1BuildResult["suggestedUsers"];
  activityMixes: SearchHomeV1BuildResult["activityMixes"];
};

function decodeMixCursor(cursor: string | null): { lastTime: number; lastId: string } | null {
  if (!cursor || typeof cursor !== "string") return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const o = JSON.parse(raw) as { t?: unknown; i?: unknown };
    const lastTime = Number(o.t);
    const lastId = String(o.i ?? "").trim();
    if (!Number.isFinite(lastTime) || !lastId) return null;
    return { lastTime, lastId };
  } catch {
    return null;
  }
}

function encodeMixCursor(c: { lastTime: number; lastId: string } | null): string | null {
  if (!c?.lastId) return null;
  return Buffer.from(JSON.stringify({ t: c.lastTime, i: c.lastId }), "utf8").toString("base64url");
}

function debugBlock(input: {
  cacheStatus: "hit" | "miss" | "bypass";
  started: number;
  readsBefore: number;
  data: HomeCore;
}): Omit<
  {
    routeName: "search.home_bootstrap.v1";
    cacheStatus: "hit" | "miss" | "bypass";
    latencyMs: number;
    readCount: number;
    payloadBytes: number;
    suggestedUserCount: number;
    suggestedUsersWithFirstPostCount: number;
    activityMixCount: number;
    postsPerMix: number[];
  },
  "payloadBytes"
> {
  return {
    routeName: "search.home_bootstrap.v1",
    cacheStatus: input.cacheStatus,
    latencyMs: Date.now() - input.started,
    readCount: (getRequestContext()?.dbOps.reads ?? 0) - input.readsBefore,
    suggestedUserCount: input.data.suggestedUsers.length,
    suggestedUsersWithFirstPostCount: input.data.suggestedUsers.filter((s) => s.firstPost != null).length,
    activityMixCount: input.data.activityMixes.length,
    postsPerMix: input.data.activityMixes.map((m) => m.posts.length),
  };
}

export class SearchHomeV1Orchestrator {
  private readonly service = new SearchHomeV1Service();
  private readonly postsRepo = new MixPostsRepository();

  async homeBootstrap(input: { viewerId: string; includeDebug: boolean; bypassCache?: boolean }) {
    const started = Date.now();
    const readsBefore = getRequestContext()?.dbOps.reads ?? 0;
    const cacheKey = `search:home-bootstrap:v1:${input.viewerId}`;
    const cacheEnabled = !input.bypassCache;

    if (cacheEnabled) {
      const cached = await globalCache.get<HomeCore>(cacheKey);
      if (cached) {
        if (!input.includeDebug) return { ...cached };
        const dbgBase = debugBlock({ cacheStatus: "hit", started, readsBefore, data: cached });
        const debug = { ...dbgBase, payloadBytes: bytes({ ...cached, debug: dbgBase }) };
        return { ...cached, debug };
      }
    }

    const built = await this.service.build(input.viewerId, {
      bypassSuggestedFriendsCache: Boolean(input.bypassCache),
    });
    const data: HomeCore = {
      version: built.version,
      viewerId: built.viewerId,
      generatedAt: built.generatedAt,
      suggestedUsers: built.suggestedUsers,
      activityMixes: built.activityMixes,
    };
    if (cacheEnabled) {
      void globalCache.set(cacheKey, data, 30_000).catch(() => undefined);
    }

    if (!input.includeDebug) return { ...data };

    const dbgBase = debugBlock({ cacheStatus: cacheEnabled ? "miss" : "bypass", started, readsBefore, data });
    const debug = { ...dbgBase, payloadBytes: bytes({ ...data, debug: dbgBase }) };
    return { ...data, debug };
  }

  async activityMixPage(input: {
    viewerId: string;
    activityKeyRaw: string;
    cursor: string | null;
    limit: number;
    includeDebug: boolean;
  }) {
    const started = Date.now();
    const readsBefore = getRequestContext()?.dbOps.reads ?? 0;
    let activity = String(input.activityKeyRaw ?? "").trim().toLowerCase();
    if (activity.startsWith("activity:")) activity = activity.slice("activity:".length).trim();

    const limit = Math.max(4, Math.min(36, Math.floor(input.limit || 18)));
    const cursorDecoded = decodeMixCursor(input.cursor);

    const aliases = resolveSearchHomeV1ActivityAliases(activity);
    const page = await this.postsRepo.pageByActivityAliases({
      aliases: [...aliases],
      limit,
      cursor: cursorDecoded,
    });

    const posts = filterPreviewRowsForActivity(page.items, activity, limit);
    const wireActivityKey =
      resolveSearchHomeV1MixCanonicalKey(activity) ??
      (normalizeActivityTagForSearchHome(activity) || activity);
    const core = {
      version: 1 as const,
      activityKey: wireActivityKey,
      posts,
      nextCursor: encodeMixCursor(page.nextCursor),
      hasMore: page.hasMore,
    };

    if (!input.includeDebug) return core;

    return {
      ...core,
      debug: {
        routeName: "search.mixes.activity.page.get" as const,
        latencyMs: Date.now() - started,
        readCount: (getRequestContext()?.dbOps.reads ?? 0) - readsBefore,
      },
    };
  }
}
