import { z } from "zod";
import { defineContract } from "../conventions.js";

export const CollectionsDeleteParamsSchema = z.object({
  collectionId: z.string().trim().min(1),
});

export const CollectionsDeleteResponseSchema = z.object({
  routeName: z.literal("collections.delete.post"),
  collectionId: z.string().trim().min(1),
  removed: z.boolean(),
});

export const collectionsDeleteContract = defineContract({
  routeName: "collections.delete.post",
  method: "DELETE",
  path: "/v2/collections/:collectionId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: CollectionsDeleteResponseSchema,
});
