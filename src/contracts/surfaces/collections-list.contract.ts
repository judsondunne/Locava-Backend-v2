import { z } from "zod";
import { defineContract } from "../conventions.js";

const CollectionEntitySchema = z.object({
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

export const CollectionsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export const CollectionsListResponseSchema = z.object({
  routeName: z.literal("collections.list.get"),
  page: z.object({
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
  items: z.array(CollectionEntitySchema),
});

export const collectionsListContract = defineContract({
  routeName: "collections.list.get",
  method: "GET",
  path: "/v2/collections",
  query: CollectionsListQuerySchema,
  body: z.object({}).strict(),
  response: CollectionsListResponseSchema,
});
