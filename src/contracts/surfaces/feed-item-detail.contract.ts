import { z } from "zod";
import { defineContract } from "../conventions.js";
import {
  AuthorSummarySchema,
  PostDetailSchema,
  SocialSummarySchema,
  ViewerPostStateSchema
} from "../entities/post-entities.contract.js";

export const FeedItemDetailParamsSchema = z.object({
  postId: z.string().min(6)
});

export const FeedItemDetailQuerySchema = z.object({
  debugSlowDeferredMs: z.coerce.number().int().min(0).max(2000).default(0)
});

export const FeedItemDetailResponseSchema = z.object({
  routeName: z.literal("feed.itemdetail.get"),
  firstRender: z.object({
    post: PostDetailSchema,
    author: AuthorSummarySchema,
    social: SocialSummarySchema,
    viewer: ViewerPostStateSchema
  }),
  deferred: z.object({
    commentsPreview: z
      .array(
        z.object({
          commentId: z.string(),
          userId: z.string(),
          text: z.string(),
          createdAtMs: z.number().int().nonnegative()
        })
      )
      .nullable()
  }),
  background: z.object({
    prefetchHints: z.array(z.string())
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const feedItemDetailContract = defineContract({
  routeName: "feed.itemdetail.get",
  method: "GET",
  path: "/v2/feed/items/:postId/detail",
  query: FeedItemDetailQuerySchema,
  body: z.object({}).strict(),
  response: FeedItemDetailResponseSchema
});

export type FeedItemDetailResponse = z.infer<typeof FeedItemDetailResponseSchema>;
