import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingOperationStatusParamsSchema = z.object({
  operationId: z.string().min(6)
});

export const PostingOperationStatusResponseSchema = z.object({
  routeName: z.literal("posting.operationstatus.get"),
  operation: z.object({
    operationId: z.string(),
    sessionId: z.string(),
    postId: z.string(),
    state: z.enum(["processing", "completed", "failed", "cancelled"]),
    terminalReason: z.enum(["processing", "ready", "failed", "cancelled_by_user", "retry_requested"]),
    pollCount: z.number().int().nonnegative(),
    pollAfterMs: z.number().int().positive(),
    retryCount: z.number().int().nonnegative(),
    completionInvalidatedAtMs: z.number().int().positive().nullable(),
    updatedAtMs: z.number().int().positive()
  }),
  polling: z.object({
    shouldPoll: z.boolean(),
    recommendedIntervalMs: z.number().int().positive()
  }),
  invalidation: z.object({
    applied: z.boolean(),
    invalidationTypes: z.array(z.string())
  })
});

export const postingOperationStatusContract = defineContract({
  routeName: "posting.operationstatus.get",
  method: "GET",
  path: "/v2/posting/operations/:operationId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostingOperationStatusResponseSchema
});
