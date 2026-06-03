import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { INVENTORY_PRODUCTION_ENV_VAR } from "../inventory/inventoryWriteGuard.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  exportVermontBrowserCache,
  getVermontImportConfig,
  restoreVermontOffroadFromBrowserCache,
  searchVermontOffroadRoutes,
  startVermontOffroadScan,
  startVermontOffroadWrite,
  VERMONT_BROWSER_CACHE_VERSION,
} from "./vermontOffroadUndiscoveredImport.service.js";
import { getVermontImportSession } from "./vermontOffroadImportSessionStore.js";

type AdminGuard = (request: FastifyRequest, reply: FastifyReply, env: AppEnv) => Promise<boolean>;

const apiBase = "/admin/openstreetmap/api/vermont-offroad-import";

export async function registerVermontOffroadImportRoutes(
  app: FastifyInstance,
  requireAdmin: AdminGuard
): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${apiBase}/config`, async (request, reply) => {
    setRouteName("admin.openstreetmap.vermont_offroad_import.config.get");
    if (!(await requireAdmin(request, reply, env))) return;
    try {
      const config = getVermontImportConfig();
      return success({
        routeName: "admin.openstreetmap.vermont_offroad_import.config.get" as const,
        config,
        inventoryProductionEnvVar: INVENTORY_PRODUCTION_ENV_VAR,
        scanBlockedWhenInventoryProdUnlocked: process.env[INVENTORY_PRODUCTION_ENV_VAR] === "true",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send(failure("vermont_import_config_failed", message));
    }
  });

  app.post(`${apiBase}/scan`, async (request, reply) => {
    setRouteName("admin.openstreetmap.vermont_offroad_import.scan.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const body = z
      .object({
        reuseCachedRun: z.boolean().optional(),
        includeOsmSupplemental: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    try {
      const session = startVermontOffroadScan({
        reuseCachedRun: body.reuseCachedRun,
        includeOsmSupplemental: body.includeOsmSupplemental,
      });
      return success({
        routeName: "admin.openstreetmap.vermont_offroad_import.scan.post" as const,
        sessionId: session.sessionId,
        phase: session.phase,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("vermont_import_scan_failed", message));
    }
  });

  app.get(`${apiBase}/session/:sessionId`, async (request, reply) => {
    setRouteName("admin.openstreetmap.vermont_offroad_import.session.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const { sessionId } = request.params as { sessionId: string };
    const session = getVermontImportSession(sessionId);
    if (!session) {
      return reply.status(404).send(failure("session_not_found", `No session ${sessionId}`));
    }
    return success({
      routeName: "admin.openstreetmap.vermont_offroad_import.session.get" as const,
      session,
    });
  });

  app.get(`${apiBase}/browser-cache-export`, async (request, reply) => {
    setRouteName("admin.openstreetmap.vermont_offroad_import.browser_cache_export.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const q = request.query as Record<string, string | undefined>;
    const sessionId = q.sessionId;
    if (!sessionId) {
      return reply.status(400).send(failure("session_id_required", "sessionId query param is required"));
    }
    try {
      const payload = exportVermontBrowserCache(sessionId);
      return success({
        routeName: "admin.openstreetmap.vermont_offroad_import.browser_cache_export.get" as const,
        ...payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("vermont_browser_cache_export_failed", message));
    }
  });

  app.post(`${apiBase}/restore-from-browser-cache`, async (request, reply) => {
    setRouteName("admin.openstreetmap.vermont_offroad_import.restore_from_browser_cache.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const body = z
      .object({
        version: z.literal(VERMONT_BROWSER_CACHE_VERSION),
        savedAt: z.string(),
        includeOsmSupplemental: z.boolean().optional(),
        run: z.object({
          runId: z.string(),
          stateCode: z.literal("VT"),
          sourceIds: z.array(z.string()),
          sourceFilter: z.enum(["all", "federal", "state", "osm"]).optional(),
          bbox: z
            .object({
              minLat: z.number(),
              minLng: z.number(),
              maxLat: z.number(),
              maxLng: z.number(),
            })
            .optional(),
          chunkCount: z.number().optional(),
          routesBounds: z
            .object({
              minLat: z.number(),
              minLng: z.number(),
              maxLat: z.number(),
              maxLng: z.number(),
            })
            .optional(),
          routesFilteredOutOfState: z.number().optional(),
          sourceCounts: z.array(
            z.object({
              sourceId: z.string(),
              rawFeatures: z.number(),
              routesAccepted: z.number(),
              rejected: z.number(),
              errors: z.array(z.string()),
            })
          ),
          routes: z.array(z.record(z.unknown())),
          areaContexts: z.array(z.unknown()).optional(),
          rejectedCount: z.number(),
          startedAt: z.string(),
          completedAt: z.string().optional(),
        }),
        preview: z.object({
          totalRoutesFetched: z.number(),
          eligibleUndiscoveredPosts: z.number(),
          filteredOutByPublicOnly: z.number(),
          byMapReadiness: z.record(z.number()),
          bySourcePrefix: z.record(z.number()),
          sourceCounts: z.array(
            z.object({
              sourceId: z.string(),
              rawFeatures: z.number(),
              routesAccepted: z.number(),
              rejected: z.number(),
              errors: z.array(z.string()),
            })
          ),
        }),
      })
      .parse(request.body ?? {});

    try {
      const session = restoreVermontOffroadFromBrowserCache(body);
      return success({
        routeName: "admin.openstreetmap.vermont_offroad_import.restore_from_browser_cache.post" as const,
        sessionId: session.sessionId,
        session,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("vermont_browser_cache_restore_failed", message));
    }
  });

  app.get(`${apiBase}/routes`, async (request, reply) => {
    setRouteName("admin.openstreetmap.vermont_offroad_import.routes.get");
    if (!(await requireAdmin(request, reply, env))) return;
    const q = request.query as Record<string, string | undefined>;
    const sessionId = q.sessionId;
    if (!sessionId) {
      return reply.status(400).send(failure("session_id_required", "sessionId query param is required"));
    }
    const session = getVermontImportSession(sessionId);
    if (!session?.runId) {
      return reply.status(404).send(failure("session_not_ready", "Scan not complete — no runId on session"));
    }

    try {
      const result = searchVermontOffroadRoutes({
        runId: session.runId,
        q: q.q,
        sourceId: q.sourceId,
        mapReadiness: q.mapReadiness,
        offroadCategory: q.offroadCategory,
        eligibleOnly: q.eligibleOnly === "true",
        includePublicOnly: q.includePublicOnly !== "false",
        includeReviewItems: q.includeReviewItems === "true",
        limit: q.limit ? Number(q.limit) : 200,
        offset: q.offset ? Number(q.offset) : 0,
      });
      return success({
        routeName: "admin.openstreetmap.vermont_offroad_import.routes.get" as const,
        sessionId,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("vermont_import_search_failed", message));
    }
  });

  app.post(`${apiBase}/write`, async (request, reply) => {
    setRouteName("admin.openstreetmap.vermont_offroad_import.write.post");
    if (!(await requireAdmin(request, reply, env))) return;
    const body = z
      .object({
        sessionId: z.string().min(1),
        limit: z.union([z.literal("all"), z.number().int().positive()]).optional(),
        writeTarget: z.enum(["emulator", "production"]),
        confirmProductionWrite: z.string().optional(),
        includePublicOnly: z.boolean().optional(),
        includeReviewItems: z.boolean().optional(),
        writeTiles: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    try {
      const session = startVermontOffroadWrite({
        sessionId: body.sessionId,
        limit: body.limit ?? "all",
        writeTarget: body.writeTarget,
        confirmProductionWrite: body.confirmProductionWrite,
        includePublicOnly: body.includePublicOnly,
        includeReviewItems: body.includeReviewItems,
        writeTiles: body.writeTiles,
      });
      return success({
        routeName: "admin.openstreetmap.vermont_offroad_import.write.post" as const,
        sessionId: session.sessionId,
        phase: session.phase,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("vermont_import_write_failed", message));
    }
  });
}
