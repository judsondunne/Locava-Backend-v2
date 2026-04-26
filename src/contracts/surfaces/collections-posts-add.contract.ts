import { z } from "zod";
import { defineContract } from "../conventions.js";

export const CollectionsPostsAddParamsSchema = z.object({
  collectionId: z.string().trim().min(1),
});

export const CollectionsPostsAddBodySchema = z.object({
  postId: z.string().trim().min(1),
});

export const CollectionsPostsAddResponseSchema = z.object({
  routeName: z.literal("collections.posts.add.post"),
  collectionId: z.string().trim().min(1),
  postId: z.string().trim().min(1),
  added: z.boolean(),
});

export const collectionsPostsAddContract = defineContract({
  routeName: "collections.posts.add.post",
  method: "POST",
  path: "/v2/collections/:collectionId/posts",
  query: z.object({}).strict(),
  body: CollectionsPostsAddBodySchema,
  response: CollectionsPostsAddResponseSchema,
});
