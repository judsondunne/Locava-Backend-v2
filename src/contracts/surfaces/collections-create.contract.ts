import { z } from "zod";
import { defineContract } from "../conventions.js";

export const CollectionsCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  privacy: z.enum(["public", "private"]),
  collaborators: z.array(z.string().min(1)).max(50).optional(),
  items: z.array(z.string().min(1)).max(200).optional(),
  coverUri: z.string().trim().url().optional()
});

export const CollectionsCreateResponseSchema = z.object({
  routeName: z.literal("collections.create.post"),
  collectionId: z.string().min(1),
  collection: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    ownerId: z.string().min(1),
    collaborators: z.array(z.string().min(1)),
    items: z.array(z.string().min(1)),
    itemsCount: z.number().int().nonnegative(),
    displayPhotoUrl: z.string().url().optional(),
    description: z.string().optional(),
    privacy: z.enum(["public", "private"]),
    color: z.string().optional()
  })
});

export const collectionsCreateContract = defineContract({
  routeName: "collections.create.post",
  method: "POST",
  path: "/v2/collections/create",
  query: z.object({}).strict(),
  body: CollectionsCreateBodySchema,
  response: CollectionsCreateResponseSchema
});
