import { z } from "zod";
import { defineContract } from "../conventions.js";

const SaveSheetCollectionItemSchema = z.object({
  id: z.string().trim().min(1),
  ownerId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  privacy: z.enum(["private", "friends", "public"]),
  coverUri: z.string().url().optional(),
  collaborators: z.array(z.string().trim().min(1)),
  items: z.array(z.string().trim().min(1)),
  itemsCount: z.number().int().nonnegative(),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  kind: z.literal("backend"),
  containsPost: z.boolean(),
});

export const CollectionsSaveSheetQuerySchema = z.object({
  postId: z.string().trim().min(1),
});

export const CollectionsSaveSheetResponseSchema = z.object({
  routeName: z.literal("collections.save-sheet.get"),
  postId: z.string().trim().min(1),
  saved: z.boolean(),
  collectionIds: z.array(z.string()),
  items: z.array(SaveSheetCollectionItemSchema),
});

export const collectionsSaveSheetContract = defineContract({
  routeName: "collections.save-sheet.get",
  method: "GET",
  path: "/v2/collections/save-sheet",
  query: CollectionsSaveSheetQuerySchema,
  body: z.object({}).strict(),
  response: CollectionsSaveSheetResponseSchema,
});
