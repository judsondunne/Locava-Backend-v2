import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingMediaMarkUploadedParamsSchema = z.object({
  mediaId: z.string().min(6)
});

export const PostingMediaMarkUploadedBodySchema = z.object({
  uploadedObjectKey: z.string().min(4).max(256).optional()
});

export const PostingMediaMarkUploadedResponseSchema = z.object({
  routeName: z.literal("posting.mediamarkuploaded.post"),
  media: z.object({
    mediaId: z.string(),
    state: z.enum(["registered", "uploaded", "ready", "failed"]),
    uploadedAtMs: z.number().int().positive().nullable(),
    expectedObjectKey: z.string(),
    pollAfterMs: z.number().int().positive()
  }),
  idempotency: z.object({
    replayed: z.boolean()
  })
});

export const postingMediaMarkUploadedContract = defineContract({
  routeName: "posting.mediamarkuploaded.post",
  method: "POST",
  path: "/v2/posting/media/:mediaId/mark-uploaded",
  query: z.object({}).strict(),
  body: PostingMediaMarkUploadedBodySchema,
  response: PostingMediaMarkUploadedResponseSchema
});
