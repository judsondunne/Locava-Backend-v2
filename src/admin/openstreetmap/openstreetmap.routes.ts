import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../auth/admin-access.js";
import type { AppEnv } from "../../config/env.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT, INVENTORY_MVP_DEFAULT_RADIUS_KM } from "../../lib/inventory/inventoryBbox.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { loadHartlandOpenStreetMapFeatures, classifyHartlandOpenStreetMapFeatures } from "./openstreetmap.service.js";
import { searchOpenStreetMapClassification, buildPresetSearch } from "./openstreetmap.search.service.js";
import {
  getOrRefreshExistingMediaBundle,
  searchExistingMedia,
} from "../inventory/inventoryExistingMedia.service.js";
import { registerOpenStreetMapOffroadRoutes } from "./openstreetmap.offroad.routes.js";
import { registerVermontOffroadImportRoutes } from "./openstreetmap.vermont-offroad-import.routes.js";
import { registerOpenStreetMapNationalRoutes } from "./national/openstreetmap.national.routes.js";
import { registerOsmNationalCopierRoutes } from "./national/copier/osmNationalCopier.routes.js";
import { registerPbfCopierRoutes } from "./national/pbfCopier/pbfCopier.routes.js";
import { registerPbfCopierV2Routes } from "./national/pbfCopier/pbfCopierV2.routes.js";

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
      defaultRadiusKm: INVENTORY_MVP_DEFAULT_RADIUS_KM,
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
        centerLat: z.coerce.number().min(-90).max(90).optional(),
        centerLng: z.coerce.number().min(-180).max(180).optional(),
        radiusKm: z.coerce.number().min(2).max(80).optional(),
        offroadSource: z.enum(["osm", "vtrans", "osm_vtrans"]).optional(),
        includeClass4: z.enum(["true", "false"]).optional(),
        includeLegalTrails: z.enum(["true", "false"]).optional(),
        includeClass6: z.enum(["true", "false"]).optional(),
      })
      .parse(request.query ?? {});

    const viewport = {
      centerLat: query.centerLat,
      centerLng: query.centerLng,
      radiusKm: query.radiusKm,
    };

    try {
      if (query.mode === "classify") {
        const result = await classifyHartlandOpenStreetMapFeatures({
          source: query.source,
          viewport,
          offroadSource: query.offroadSource,
        includeClass4: query.includeClass4 !== "false",
        includeLegalTrails: query.includeLegalTrails !== "false",
        includeClass6: query.includeClass6 !== "false",
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

      const result = await loadHartlandOpenStreetMapFeatures({ source: query.source, viewport });
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
    const preset = q.preset as
    | "trail_debug"
    | "suspicious_accepted"
    | "possible_misses"
    | "swimming_beaches"
    | "weak_names"
    | "anchored_parents"
    | "name_only_rejections"
    | "private_rejections"
    | "viewpoints_waterfalls"
    | "remaining_concerns"
    | "offroading"
    | "offroad_class4"
    | "offroad_legal_trail"
    | "offroad_class6"
    | "offroad_candidates"
    | "offroad_private_rejected"
    | "missing_parking"
    | "parent_places"
    | "activity_qa"
    | "weak_activity"
    | "niche_ready"
    | "bad_titles"
    | "generated_titles"
    | "natural_feature_fixes"
    | "ready_low_confidence"
    | "hidden_niche"
    | "search_alias_preview"
    | undefined;
    if (preset) {
      const limit = q.limit ? Number(q.limit) : undefined;
      const presetResult = buildPresetSearch(preset, q.runId, limit);
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
      onlySwimmingBeach: q.onlySwimmingBeach === "true",
      onlyWeakNames: q.onlyWeakNames === "true",
      onlyAnchoredParents: q.onlyAnchoredParents === "true",
      offroadCategory: q.offroadCategory,
      offroadConfidence: q.offroadConfidence,
      accessStatus: q.accessStatus,
      hasParking: q.hasParking === "true",
      missingParking: q.missingParking === "true",
      placeKind: q.placeKind,
      limit: q.limit ? Number(q.limit) : 200,
      offset: q.offset ? Number(q.offset) : 0,
    };

    const result = searchOpenStreetMapClassification(parsed);
    if (!result) return reply.status(404).send(failure("run_not_found", "No classification run in memory — run classifier first"));
    return success({ routeName: "admin.openstreetmap.search.get" as const, ...result });
  });

  app.get(`${base}/media/existing`, async (request, reply) => {
    setRouteName("admin.openstreetmap.media.existing.get");
    if (!(await requireOpenStreetMapAdmin(request, reply, env))) return;
    const q = request.query as Record<string, string | undefined>;
    const result = searchExistingMedia({
      runId: q.runId,
      q: q.q,
      decision: q.decision as "all" | "accepted" | "rejected" | undefined,
      kind: q.kind as "all" | "spot" | "route" | "raw" | undefined,
      hasMediaRef: q.hasMediaRef === "true" ? true : q.hasMediaRef === "false" ? false : undefined,
      canPreview: q.canPreview === "true" ? true : q.canPreview === "false" ? false : undefined,
      mediaKind: q.mediaKind,
      mediaTagKey: q.mediaTagKey,
      includeRejected: q.includeRejected !== "false",
      limit: q.limit ? Number(q.limit) : 200,
      offset: q.offset ? Number(q.offset) : 0,
    });
    if (!result) return reply.status(404).send(failure("run_not_found", "No classification run in memory — run classifier first"));
    return success({
      routeName: "admin.openstreetmap.media.existing.get" as const,
      runId: result.runId,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      summary: result.summary,
      results: result.results.map((item) => ({ item, existingMediaRefs: item.existingMediaRefs })),
    });
  });

  await registerOpenStreetMapOffroadRoutes(app, requireOpenStreetMapAdmin);
  await registerVermontOffroadImportRoutes(app, requireOpenStreetMapAdmin);
  await registerOpenStreetMapNationalRoutes(app);
  await registerOsmNationalCopierRoutes(app);
  await registerPbfCopierRoutes(app);
  await registerPbfCopierV2Routes(app);

  app.get(`${base}/media/diagnostics`, async (request, reply) => {
    setRouteName("admin.openstreetmap.media.diagnostics.get");
    if (!(await requireOpenStreetMapAdmin(request, reply, env))) return;
    const runId = (request.query as { runId?: string }).runId;
    const bundle = getOrRefreshExistingMediaBundle(runId);
    if (!bundle) return reply.status(404).send(failure("run_not_found", "No classification run in memory"));
    return success({
      routeName: "admin.openstreetmap.media.diagnostics.get" as const,
      existingMediaDiagnostics: bundle.diagnostics,
    });
  });
}
