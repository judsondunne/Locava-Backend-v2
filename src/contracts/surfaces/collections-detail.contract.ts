import { z } from "zod";
import { defineContract } from "../conventions.js";

const CollectionEntityDetailSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  privacy: z.enum(["private", "friends", "public"]),
  coverUri: z.string().url().optional(),
  collaborators: z.array(z.string().min(1)),
  items: z.array(z.string().min(1)),
  itemsCount: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  kind: z.literal("backend"),
});

export const CollectionsDetailParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const CollectionsDetailResponseSchema = z.object({
  routeName: z.literal("collections.detail.get"),
  item: CollectionEntityDetailSchema,
});

export const collectionsDetailContract = defineContract({
  routeName: "collections.detail.get",
  method: "GET",
  path: "/v2/collections/:id",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: CollectionsDetailResponseSchema,
});
