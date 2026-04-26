import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingMediaRegisterBodySchema = z.object({
  sessionId: z.string().min(6),
  assetIndex: z.coerce.number().int().min(0).max(79),
  assetType: z.enum(["photo", "video"]),
  clientMediaKey: z.string().min(8).max(128).optional()
});

export const PostingMediaRegisterResponseSchema = z.object({
  routeName: z.literal("posting.mediaregister.post"),
  media: z.object({
    mediaId: z.string(),
    sessionId: z.string(),
    assetIndex: z.number().int().nonnegative(),
    assetType: z.enum(["photo", "video"]),
    expectedObjectKey: z.string(),
    state: z.enum(["registered", "uploaded", "ready", "failed"]),
    pollAfterMs: z.number().int().positive()
  }),
  upload: z.object({
    strategy: z.literal("direct_object_store"),
    binaryUploadThroughApi: z.literal(false)
  }),
  idempotency: z.object({
    replayed: z.boolean()
  })
});

// invalidation: media-register advances posting draft asset state and invalidates posting operation/media polling lookups.
export const postingMediaRegisterContract = defineContract({
  routeName: "posting.mediaregister.post",
  method: "POST",
  path: "/v2/posting/media/register",
  query: z.object({}).strict(),
  body: PostingMediaRegisterBodySchema,
  response: PostingMediaRegisterResponseSchema
});
