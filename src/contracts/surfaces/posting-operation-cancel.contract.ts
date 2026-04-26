import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingOperationCancelParamsSchema = z.object({
  operationId: z.string().min(6)
});

export const PostingOperationCancelResponseSchema = z.object({
  routeName: z.literal("posting.operationcancel.post"),
  operation: z.object({
    operationId: z.string(),
    state: z.enum(["processing", "completed", "failed", "cancelled"]),
    terminalReason: z.enum(["processing", "ready", "failed", "cancelled_by_user", "retry_requested"]),
    retryCount: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().positive()
  }),
  idempotency: z.object({
    replayed: z.boolean()
  })
});

export const postingOperationCancelContract = defineContract({
  routeName: "posting.operationcancel.post",
  method: "POST",
  path: "/v2/posting/operations/:operationId/cancel",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostingOperationCancelResponseSchema
});
