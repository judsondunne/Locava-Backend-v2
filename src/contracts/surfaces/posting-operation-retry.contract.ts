import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingOperationRetryParamsSchema = z.object({
  operationId: z.string().min(6)
});

export const PostingOperationRetryResponseSchema = z.object({
  routeName: z.literal("posting.operationretry.post"),
  operation: z.object({
    operationId: z.string(),
    postId: z.string(),
    state: z.enum(["processing", "completed", "failed", "cancelled"]),
    terminalReason: z.enum(["processing", "ready", "failed", "cancelled_by_user", "retry_requested"]),
    pollAfterMs: z.number().int().positive(),
    retryCount: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().positive()
  }),
  idempotency: z.object({
    replayed: z.boolean()
  })
});

export const postingOperationRetryContract = defineContract({
  routeName: "posting.operationretry.post",
  method: "POST",
  path: "/v2/posting/operations/:operationId/retry",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostingOperationRetryResponseSchema
});
