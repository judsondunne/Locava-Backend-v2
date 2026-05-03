import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  postingStagingPresignContract,
  PostingStagingPresignBodySchema
} from "../../contracts/surfaces/posting-staging-presign.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { recordIdempotencyHit, recordIdempotencyMiss, setRouteName } from "../../observability/request-context.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import {
  enrichPresignSlotsForLegacyCompat,
  presignPostSessionStagingBatch
} from "../../services/storage/wasabi-presign.service.js";

type CachedStagingPresign = {
  viewerId: string;
  clientStagingKey: string;
  mediaType: "photo" | "video";
  sessionId: string;
  createdAtMs: number;
  expiresAtMs: number;
  urls: Awaited<ReturnType<typeof enrichPresignSlotsForLegacyCompat>>;
  hitsWindow: number[];
};

const PRESIGN_CACHE_TTL_MS = 10 * 60_000;
const PRESIGN_LOOP_WINDOW_MS = 10_000;
const PRESIGN_LOOP_MAX_HITS = 5;
const presignByViewerAndKey = new Map<string, CachedStagingPresign>();

function buildCacheKey(viewerId: string, clientStagingKey: string): string {
  return `${viewerId}:${clientStagingKey}`;
}

function trimExpiredPresignCache(nowMs: number): void {
  for (const [key, row] of presignByViewerAndKey.entries()) {
    if (row.expiresAtMs <= nowMs) {
      presignByViewerAndKey.delete(key);
    }
  }
}

export async function registerV2PostingStagingPresignRoutes(app: FastifyInstance): Promise<void> {
  app.post(postingStagingPresignContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Posting v2 surface is not enabled for this viewer"));
    }
    if (!viewer.viewerId || viewer.viewerId === "anonymous") {
      return reply.status(401).send(failure("unauthorized", "Viewer required for staging presign"));
    }

    const body = PostingStagingPresignBodySchema.parse(request.body);
    setRouteName(postingStagingPresignContract.routeName);
    const nowMs = Date.now();
    trimExpiredPresignCache(nowMs);

    const cfg = readWasabiConfigFromEnv();
    if (!cfg) {
      return reply.status(503).send(failure("object_storage_unavailable", "Wasabi configuration unavailable"));
    }

    const normalized = body.items.map((it) => ({ index: it.index, assetType: it.assetType }));
    const urlsByIndex = new Map<number, (typeof normalized[number] & {
      uploadUrl: string;
      key: string;
      contentType: string;
      assetId: string;
      originalKey: string;
      originalUrl: string;
      posterKey?: string;
      posterUrl?: string;
    })>();
    const toPresign: typeof body.items = [];

    for (const item of body.items) {
      const clientStagingKey = item.clientStagingKey?.trim();
      if (!clientStagingKey) {
        toPresign.push(item);
        recordIdempotencyMiss();
        continue;
      }
      const key = buildCacheKey(viewer.viewerId, clientStagingKey);
      const cached = presignByViewerAndKey.get(key);
      if (!cached || cached.expiresAtMs <= nowMs) {
        toPresign.push(item);
        recordIdempotencyMiss();
        continue;
      }
      cached.hitsWindow = cached.hitsWindow.filter((ts) => nowMs - ts <= PRESIGN_LOOP_WINDOW_MS);
      cached.hitsWindow.push(nowMs);
      const loopGuardActive = cached.hitsWindow.length > PRESIGN_LOOP_MAX_HITS;
      if (loopGuardActive) {
        console.warn("[posting_staging_presign_loop_guard]", {
          userId: viewer.viewerId,
          clientStagingKeyPrefix: clientStagingKey.slice(0, 24),
          mediaType: item.assetType,
          hitsIn10s: cached.hitsWindow.length,
          sessionIdPrefix: body.sessionId.slice(0, 12),
        });
      }
      const cachedRow = cached.urls.find((row) => row.index === item.index);
      if (cachedRow) {
        urlsByIndex.set(item.index, { ...item, ...cachedRow });
        recordIdempotencyHit();
        console.info("[posting.staging.presign]", {
          userId: viewer.viewerId,
          mediaType: item.assetType,
          clientStagingKeyPrefix: clientStagingKey.slice(0, 24),
          reused: true,
          loopGuardActive,
        });
      } else {
        toPresign.push(item);
        recordIdempotencyMiss();
      }
    }

    if (toPresign.length > 0) {
      const signed = await presignPostSessionStagingBatch(
        toPresign.map((it) => ({
          index: it.index,
          assetType: it.assetType,
          ...(it.destinationKey ? { destinationKey: it.destinationKey } : {}),
          ...(it.clientStagingKey?.trim() ? { clientStagingKey: it.clientStagingKey.trim() } : {})
        })),
        body.sessionId,
      );
      if (!signed.ok) {
        const code = signed.code === "not_configured" ? "object_storage_unavailable" : "presign_failed";
        const status = signed.code === "not_configured" ? 503 : 500;
        return reply.status(status).send(failure(code, signed.message));
      }
      const signedUrls = enrichPresignSlotsForLegacyCompat(
        cfg,
        body.sessionId,
        signed.urls,
        toPresign.map((it) => ({
          index: it.index,
          assetType: it.assetType,
          ...(it.clientStagingKey?.trim() ? { clientStagingKey: it.clientStagingKey.trim() } : {})
        })),
      );
      for (const row of signedUrls) {
        urlsByIndex.set(row.index, {
          ...(toPresign.find((it) => it.index === row.index) ?? { index: row.index, assetType: "photo" as const }),
          ...row,
        });
      }
      for (const item of toPresign) {
        const clientStagingKey = item.clientStagingKey?.trim();
        if (!clientStagingKey) continue;
        const row = signedUrls.find((r) => r.index === item.index);
        if (!row) continue;
        presignByViewerAndKey.set(buildCacheKey(viewer.viewerId, clientStagingKey), {
          viewerId: viewer.viewerId,
          clientStagingKey,
          mediaType: item.assetType,
          sessionId: body.sessionId,
          createdAtMs: nowMs,
          expiresAtMs: nowMs + PRESIGN_CACHE_TTL_MS,
          urls: [{ ...row }],
          hitsWindow: [],
        });
        console.info("[posting.staging.presign]", {
          userId: viewer.viewerId,
          mediaType: item.assetType,
          clientStagingKeyPrefix: clientStagingKey.slice(0, 24),
          reused: false,
        });
      }
    }

    const urls = body.items
      .map((item) => urlsByIndex.get(item.index))
      .filter(Boolean) as Array<{
      index: number;
      uploadUrl: string;
      key: string;
      contentType: string;
      assetId: string;
      originalKey: string;
      originalUrl: string;
      posterKey?: string;
      posterUrl?: string;
    }>;

    return success({
      routeName: "posting.stagingpresign.post" as const,
      sessionId: body.sessionId,
      urls
    });
  });
}
