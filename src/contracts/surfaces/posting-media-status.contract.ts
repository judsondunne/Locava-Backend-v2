import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingMediaStatusParamsSchema = z.object({
  mediaId: z.string().min(6)
});

export const PostingMediaStatusResponseSchema = z.object({
  routeName: z.literal("posting.mediastatus.get"),
  media: z.object({
    mediaId: z.string(),
    sessionId: z.string(),
    assetIndex: z.number().int().nonnegative(),
    assetType: z.enum(["photo", "video"]),
    state: z.enum(["registered", "uploaded", "ready", "failed"]),
    expectedObjectKey: z.string(),
    uploadedAtMs: z.number().int().positive().nullable(),
    readyAtMs: z.number().int().positive().nullable(),
    pollCount: z.number().int().nonnegative(),
    pollAfterMs: z.number().int().positive(),
    failureReason: z.string().nullable()
  }),
  polling: z.object({
    shouldPoll: z.boolean(),
    recommendedIntervalMs: z.number().int().positive()
  })
});

export const postingMediaStatusContract = defineContract({
  routeName: "posting.mediastatus.get",
  method: "GET",
  path: "/v2/posting/media/:mediaId/status",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostingMediaStatusResponseSchema
});
