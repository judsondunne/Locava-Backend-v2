import { z } from "zod";
import { defineContract } from "../conventions.js";

export const CollectionsPostsRemoveParamsSchema = z.object({
  collectionId: z.string().trim().min(1),
  postId: z.string().trim().min(1),
});

export const CollectionsPostsRemoveResponseSchema = z.object({
  routeName: z.literal("collections.posts.remove.delete"),
  collectionId: z.string().trim().min(1),
  postId: z.string().trim().min(1),
  removed: z.boolean(),
});

export const collectionsPostsRemoveContract = defineContract({
  routeName: "collections.posts.remove.delete",
  method: "DELETE",
  path: "/v2/collections/:collectionId/posts/:postId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: CollectionsPostsRemoveResponseSchema,
});
