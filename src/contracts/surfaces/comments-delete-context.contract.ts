import { z } from "zod";
import { defineContract } from "../conventions.js";
import { CommentsDeleteResponseSchema } from "./comments-delete.contract.js";

export const CommentsDeleteContextParamsSchema = z.object({
  postId: z.string().min(6),
  commentId: z.string().min(6),
});

export const commentsDeleteContextContract = defineContract({
  routeName: "comments.delete.delete",
  method: "DELETE",
  path: "/v2/posts/:postId/comments/:commentId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: CommentsDeleteResponseSchema,
});
