import { z } from "zod";
import { defineContract } from "../conventions.js";
import { InventoryTilePayloadSchema } from "../entities/inventory-entities.contract.js";

export const InventoryTilesResponseSchema = z.object({
  routeName: z.literal("inventory.tiles.get"),
  tiles: z.array(InventoryTilePayloadSchema),
  count: z.number().int().nonnegative(),
  generatedAt: z.string(),
  version: z.string(),
});

export const inventoryTilesContract = defineContract({
  routeName: "inventory.tiles.get",
  method: "GET",
  path: "/v2/inventory/tiles",
  query: z.object({
    bbox: z
      .string()
      .regex(
        /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/,
        "bbox must be minLng,minLat,maxLng,maxLat"
      )
      .optional(),
    zoom: z.coerce.number().int().min(0).max(22).optional(),
    z: z.coerce.number().int().min(0).max(22).optional(),
    x: z.coerce.number().int().min(0).optional(),
    y: z.coerce.number().int().min(0).optional(),
  }),
  body: z.object({}).strict(),
  response: InventoryTilesResponseSchema,
});

export type InventoryTilesResponse = z.infer<typeof InventoryTilesResponseSchema>;
