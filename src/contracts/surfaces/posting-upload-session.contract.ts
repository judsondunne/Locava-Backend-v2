import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingUploadSessionBodySchema = z.object({
  clientSessionKey: z.string().min(8).max(128),
  mediaCountHint: z.coerce.number().int().min(1).max(20).default(1)
});

export const PostingUploadSessionResponseSchema = z.object({
  routeName: z.literal("posting.uploadsession.post"),
  uploadSession: z.object({
    sessionId: z.string(),
    state: z.enum(["open", "finalized", "expired"]),
    mediaCountHint: z.number().int().min(1).max(20),
    expiresAtMs: z.number().int().positive()
  }),
  idempotency: z.object({
    replayed: z.boolean()
  }),
  polling: z.object({
    recommendedIntervalMs: z.number().int().positive()
  })
});

// invalidation: upload-session advances posting draft state and invalidates active posting operation lookups.
export const postingUploadSessionContract = defineContract({
  routeName: "posting.uploadsession.post",
  method: "POST",
  path: "/v2/posting/upload-session",
  query: z.object({}).strict(),
  body: PostingUploadSessionBodySchema,
  response: PostingUploadSessionResponseSchema
});
