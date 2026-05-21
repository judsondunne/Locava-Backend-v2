import { z } from "zod";
import { defineContract } from "../conventions.js";
import { InventoryRouteSchema } from "../entities/inventory-entities.contract.js";

export const InventoryRouteDetailResponseSchema = z.object({
  routeName: z.literal("inventory.route.detail.get"),
  route: InventoryRouteSchema,
});

export const inventoryRouteDetailContract = defineContract({
  routeName: "inventory.route.detail.get",
  method: "GET",
  path: "/v2/inventory/routes/:id",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: InventoryRouteDetailResponseSchema,
});

export type InventoryRouteDetailResponse = z.infer<typeof InventoryRouteDetailResponseSchema>;
