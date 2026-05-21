import { z } from "zod";
import { defineContract } from "../conventions.js";
import { InventorySpotSchema } from "../entities/inventory-entities.contract.js";

export const InventorySpotDetailResponseSchema = z.object({
  routeName: z.literal("inventory.spot.detail.get"),
  spot: InventorySpotSchema,
});

export const inventorySpotDetailContract = defineContract({
  routeName: "inventory.spot.detail.get",
  method: "GET",
  path: "/v2/inventory/spots/:id",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: InventorySpotDetailResponseSchema,
});

export type InventorySpotDetailResponse = z.infer<typeof InventorySpotDetailResponseSchema>;
