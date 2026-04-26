import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

export const PostsCardParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostsCardResponseSchema = z.object({
  routeName: z.literal("posts.card.get"),
  card: PostCardSummarySchema
});

export const postsCardContract = defineContract({
  routeName: "posts.card.get",
  method: "GET",
  path: "/v2/posts/:postId/card",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostsCardResponseSchema
});
