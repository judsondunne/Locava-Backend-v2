import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyViewerAuthHeader, hasAdminAccess } from "../../auth/admin-access.js";
import type { AppEnv } from "../../config/env.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../../lib/inventory/inventoryBbox.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  InventoryAdminBuildTilesBodySchema,
  InventoryAdminCommitBodySchema,
  InventoryAdminDryRunBodySchema,
  InventoryAdminOsmDebugBodySchema,
} from "../../contracts/surfaces/inventory-admin.contract.js";
import {
  commitInventoryRun,
  getInventoryRun,
  getLatestInventoryRun,
  listInventoryRuns,
  processInventorySource,
} from "./inventoryImport.service.js";
import { getInventoryRunArtifacts, clearInventorySession } from "./inventoryImportRunStore.js";
import { buildInventoryTilesForRun } from "./inventoryTileBuilder.service.js";
import {
  isFirestoreEmulatorActive,
  isInventoryProductionWriteUnlocked,
} from "./inventoryWriteGuard.js";
import { runOsmDebugBbox } from "./inventoryOsmDebug.service.js";

const base = "/admin/inventory/api";

async function requireInventoryAdmin(request: FastifyRequest, reply: FastifyReply, env: AppEnv): Promise<boolean> {
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return true;
  }
  try {
    const auth = await verifyViewerAuthHeader(request.headers.authorization);
    if (!auth || !hasAdminAccess(auth)) {
      reply.status(403).send(failure("admin_required", "Admin access required for inventory operations"));
      return false;
    }
    return true;
  } catch {
    reply.status(401).send(failure("auth_required", "Authorization required for inventory admin"));
    return false;
  }
}

export async function registerInventoryAdminRoutes(app: FastifyInstance): Promise<void> {
  const env = app.config as AppEnv;

  app.get(`${base}/health`, async (request, reply) => {
    setRouteName("admin.inventory.health.get");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    return success({
      routeName: "admin.inventory.health.get" as const,
      ok: true,
      enabled: true,
      defaultViewport: INVENTORY_MVP_DEFAULT_VIEWPORT,
      productionWritesBlocked: !isInventoryProductionWriteUnlocked(),
      emulatorActive: isFirestoreEmulatorActive(),
      dryRunWriteRunDoc: env.INVENTORY_DRY_RUN_WRITE_RUN_DOC === true || isFirestoreEmulatorActive(),
    });
  });

  app.get(`${base}/runs`, async (request, reply) => {
    setRouteName("admin.inventory.runs.list");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const limit = z.coerce.number().int().min(1).max(100).optional().parse((request.query as { limit?: string }).limit ?? 50);
    const runs = await listInventoryRuns(limit);
    return success({ routeName: "admin.inventory.runs.list" as const, runs });
  });

  app.get(`${base}/runs/:runId`, async (request, reply) => {
    setRouteName("admin.inventory.run.detail");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string().min(1) }).parse(request.params).runId;
    const run = await getInventoryRun(runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Import run not found", { runId }));
    return success({ routeName: "admin.inventory.run.detail" as const, run });
  });

  app.post(`${base}/runs/dry-run`, async (request, reply) => {
    setRouteName("admin.inventory.runs.dry_run");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const body = InventoryAdminDryRunBodySchema.parse(request.body ?? {});
    const result = await processInventorySource(body);
    return success({ routeName: "admin.inventory.runs.dry_run" as const, result });
  });

  app.post(`${base}/runs/:runId/commit`, async (request, reply) => {
    setRouteName("admin.inventory.runs.commit");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string().min(1) }).parse(request.params).runId;
    const body = InventoryAdminCommitBodySchema.parse(request.body ?? {});
    try {
      const result = await commitInventoryRun({ runId, ...body, dryRun: false });
      return success({ routeName: "admin.inventory.runs.commit" as const, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("inventory_commit_failed", message));
    }
  });

  app.post(`${base}/runs/:runId/build-tiles`, async (request, reply) => {
    setRouteName("admin.inventory.runs.build_tiles");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string().min(1) }).parse(request.params).runId;
    const body = InventoryAdminBuildTilesBodySchema.parse(request.body ?? {});
    try {
      const result = await buildInventoryTilesForRun({ runId, ...body });
      return success({ routeName: "admin.inventory.runs.build_tiles" as const, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("inventory_tile_build_failed", message));
    }
  });

  app.get(`${base}/runs/:runId/artifacts`, async (request, reply) => {
    setRouteName("admin.inventory.run.artifacts");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const runId = z.object({ runId: z.string().min(1) }).parse(request.params).runId;
    const run = await getInventoryRun(runId);
    if (!run) return reply.status(404).send(failure("run_not_found", "Import run not found", { runId }));
    const artifacts = getInventoryRunArtifacts(runId);
    return success({
      routeName: "admin.inventory.run.artifacts" as const,
      run,
      stagedSpots: artifacts?.stagedSpots ?? [],
      stagedRoutes: artifacts?.stagedRoutes ?? [],
      tilePreview: artifacts?.tilePreview ?? [],
    });
  });

  app.post(`${base}/session/reset`, async (request, reply) => {
    setRouteName("admin.inventory.session.reset");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    clearInventorySession();
    return success({ routeName: "admin.inventory.session.reset" as const, ok: true });
  });

  app.post(`${base}/osm-debug/bbox`, async (request, reply) => {
    setRouteName("admin.inventory.osm_debug.bbox");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const body = InventoryAdminOsmDebugBodySchema.parse(request.body ?? {});
    const result = await runOsmDebugBbox(body);
    return success({ routeName: "admin.inventory.osm_debug.bbox" as const, result });
  });

  app.get(`${base}/preview/latest`, async (request, reply) => {
    setRouteName("admin.inventory.preview.latest");
    if (!(await requireInventoryAdmin(request, reply, env))) return;
    const run = getLatestInventoryRun();
    const artifacts = run ? getInventoryRunArtifacts(run.runId) : null;
    return success({
      routeName: "admin.inventory.preview.latest" as const,
      run,
      stagedSpots: artifacts?.stagedSpots ?? [],
      stagedRoutes: artifacts?.stagedRoutes ?? [],
      tilePreview: artifacts?.tilePreview ?? [],
    });
  });
}
