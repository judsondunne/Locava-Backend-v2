import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../auth/admin-access.js";
import type { AppEnv } from "../../config/env.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../../lib/inventory/inventoryBbox.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { loadHartlandOpenStreetMapFeatures, classifyHartlandOpenStreetMapFeatures } from "./openstreetmap.service.js";
import { searchOpenStreetMapClassification, buildPresetSearch } from "./openstreetmap.search.service.js";

const base = "/admin/openstreetmap/api";

async function requireOpenStreetMapAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  env: AppEnv
): Promise<boolean> {
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return true;
  }
  try {
    const auth = await verifyViewerAuthHeader(request.headers.authorization);
    if (!auth || !hasAdminAccess(auth)) {
      reply.status(403).send(failure("admin_required", "Admin access required for OpenStreetMap explorer"));
      return false;
    }
    return true;
  } catch {
    reply.status(401).send(failure("auth_required", "Authorization required for OpenStreetMap explorer"));
    return false;
  }
}

export async function registerOpenStreetMapAdminRoutes(app: FastifyInstance): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${base}/health`, async (request, reply) => {
    setRouteName("admin.openstreetmap.health.get");
    if (!(await requireOpenStreetMapAdmin(request, reply, env))) return;
    return success({
      routeName: "admin.openstreetmap.health.get" as const,
      ok: true,
      defaultViewport: INVENTORY_MVP_DEFAULT_VIEWPORT,
    });
  });

  app.get(`${base}/hartland/features`, async (request, reply) => {
    setRouteName("admin.openstreetmap.hartland.features.get");
    if (!(await requireOpenStreetMapAdmin(request, reply, env))) return;

    const query = z
      .object({
        source: z.enum(["overpass", "fixture"]).optional(),
        mode: z.enum(["raw", "classify"]).optional(),
        foodMode: z.enum(["local_only", "all_named_food"]).optional(),
        trailMode: z.enum(["recreation_only", "all_paths"]).optional(),
        natureMode: z.enum(["named_or_recreational", "broad_natural"]).optional(),
      })
      .parse(request.query ?? {});

    try {
      if (query.mode === "classify") {
        const result = await classifyHartlandOpenStreetMapFeatures({
          source: query.source,
          config: {
            foodMode: query.foodMode,
            trailMode: query.trailMode,
            natureMode: query.natureMode,
          },
        });
        return success({
          routeName: "admin.openstreetmap.hartland.classify.get" as const,
          result,
        });
      }

      const result = await loadHartlandOpenStreetMapFeatures({ source: query.source });
      return success({
        routeName: "admin.openstreetmap.hartland.features.get" as const,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(502).send(failure("openstreetmap_fetch_failed", message));
    }
  });

  app.get(`${base}/search`, async (request, reply) => {
    setRouteName("admin.openstreetmap.search.get");
    if (!(await requireOpenStreetMapAdmin(request, reply, env))) return;

    const q = request.query as Record<string, string | undefined>;
    const preset = q.preset as "trail_debug" | "suspicious_accepted" | "possible_misses" | undefined;
    if (preset) {
      const presetResult = buildPresetSearch(preset, q.runId);
      if (!presetResult) return reply.status(404).send(failure("run_not_found", "No classification run in memory"));
      return success({ routeName: "admin.openstreetmap.search.get" as const, ...presetResult });
    }

    const parsed = {
      runId: q.runId,
      q: q.q,
      decision: q.decision as "all" | "accepted" | "rejected" | "duplicate" | undefined,
      kind: q.kind as "all" | "spot" | "route" | "raw" | undefined,
      category: q.category,
      activity: q.activity,
      displayPriority: q.displayPriority,
      confidence: q.confidence,
      rejectionReason: q.rejectionReason,
      rawType: q.rawType,
      minScore: q.minScore ? Number(q.minScore) : undefined,
      maxScore: q.maxScore ? Number(q.maxScore) : undefined,
      hasGeometry: q.hasGeometry === "true",
      onlySuspicious: q.onlySuspicious === "true",
      onlyTrails: q.onlyTrails === "true",
      onlyFood: q.onlyFood === "true",
      onlyNature: q.onlyNature === "true",
      limit: q.limit ? Number(q.limit) : 200,
      offset: q.offset ? Number(q.offset) : 0,
    };

    const result = searchOpenStreetMapClassification(parsed);
    if (!result) return reply.status(404).send(failure("run_not_found", "No classification run in memory — run classifier first"));
    return success({ routeName: "admin.openstreetmap.search.get" as const, ...result });
  });
}
