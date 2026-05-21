import { z } from "zod";
import { defineContract } from "../conventions.js";
import {
  InventoryBboxSchema,
  InventoryCommitResultSchema,
  InventoryCommitTargetSchema,
  InventoryImportDryRunResultSchema,
  InventoryImportRunSchema,
  InventoryTileBuildResultSchema,
} from "../entities/inventory-entities.contract.js";

export const InventoryAdminHealthResponseSchema = z.object({
  routeName: z.literal("admin.inventory.health.get"),
  ok: z.boolean(),
  enabled: z.boolean(),
  defaultViewport: z.object({
    label: z.string(),
    regionKey: z.string(),
    center: z.object({ lat: z.number(), lng: z.number() }),
    bbox: InventoryBboxSchema,
  }),
  productionWritesBlocked: z.boolean(),
  emulatorActive: z.boolean(),
  dryRunWriteRunDoc: z.boolean(),
});

export const InventoryAdminRunsListResponseSchema = z.object({
  routeName: z.literal("admin.inventory.runs.list"),
  runs: z.array(InventoryImportRunSchema),
});

export const InventoryAdminRunDetailResponseSchema = z.object({
  routeName: z.literal("admin.inventory.run.detail"),
  run: InventoryImportRunSchema,
});

export const InventoryAdminDryRunBodySchema = z.object({
  source: z.enum(["fixture", "geojson", "overpass_json_file"]).default("fixture"),
  regionKey: z.string().optional(),
  geojsonPath: z.string().optional(),
  overpassJsonPath: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
  writeRunDoc: z.boolean().optional(),
});

export const InventoryAdminOsmDebugBodySchema = z.object({
  bbox: InventoryBboxSchema.optional(),
  source: z.enum(["fixture", "geojson", "overpass_json_file"]).default("fixture"),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
  geojsonPath: z.string().optional(),
  overpassJsonPath: z.string().optional(),
  regionKey: z.string().optional(),
});

export const InventoryAdminDryRunResponseSchema = z.object({
  routeName: z.literal("admin.inventory.runs.dry_run"),
  result: InventoryImportDryRunResultSchema,
});

export const InventoryAdminCommitBodySchema = z.object({
  commitTarget: InventoryCommitTargetSchema.default("emulator"),
  dryRun: z.boolean().default(false),
  confirmProductionWrite: z.string().optional(),
});

export const InventoryAdminCommitResponseSchema = z.object({
  routeName: z.literal("admin.inventory.runs.commit"),
  result: InventoryCommitResultSchema,
});

export const InventoryAdminBuildTilesBodySchema = z.object({
  dryRun: z.boolean().default(true),
  commitTarget: InventoryCommitTargetSchema.default("none"),
  minZoom: z.coerce.number().int().min(0).max(22).optional(),
  maxZoom: z.coerce.number().int().min(0).max(22).optional(),
  confirmProductionWrite: z.string().optional(),
});

export const InventoryAdminBuildTilesResponseSchema = z.object({
  routeName: z.literal("admin.inventory.runs.build_tiles"),
  result: InventoryTileBuildResultSchema,
});

export const InventoryAdminPreviewLatestResponseSchema = z.object({
  routeName: z.literal("admin.inventory.preview.latest"),
  run: InventoryImportRunSchema.nullable(),
  tilePreview: z.array(z.unknown()),
});

export const inventoryAdminHealthContract = defineContract({
  routeName: "admin.inventory.health.get",
  method: "GET",
  path: "/admin/inventory/api/health",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: InventoryAdminHealthResponseSchema,
});

export type InventoryAdminHealthResponse = z.infer<typeof InventoryAdminHealthResponseSchema>;
