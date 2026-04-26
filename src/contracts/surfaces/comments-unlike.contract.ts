import { z } from "zod";
import { defineContract } from "../conventions.js";
import { CommentsLikeResponseSchema } from "./comments-like.contract.js";

export const CommentsUnlikeParamsSchema = z.object({
  postId: z.string().min(6),
  commentId: z.string().min(6),
});

export const commentsUnlikeContract = defineContract({
  routeName: "comments.like.post",
  method: "POST",
  path: "/v2/posts/:postId/comments/:commentId/unlike",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: CommentsLikeResponseSchema,
});
